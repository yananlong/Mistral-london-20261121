import { ReactNode, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AskSession, FinishedAsk } from '../ask/AskController';
import { NewsKey, Place, placesFor, TopicKey } from '../content/scenario';
import { clockLabel } from '../location/distance';
import { MapFocus } from '../map/types';
import { decodeLocationShare, SOS_CANCEL_NOTE, SOS_NOTE } from '../protocol';
import { FeedMessage, MeshState, peerMessages } from '../store/MeshStore';
import { useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';
import { Delivery } from './Delivery';
import { Arrive, Button, Icon, Txt } from './ui';

export const AI_SOURCE = 'AI answer. Not verified emergency advice.';

/** Which place topic a question is about, so its answer can open the same map as the topic. */
const PLACE_TOPICS: [RegExp, TopicKey][] = [
  [/charg|battery/i, 'charge'], [/water|drink/i, 'water'], [/food|eat/i, 'food'], [/shelter|warm|sleep|rest/i, 'shelter'],
];
export function placeTopicFor(question: string): TopicKey | null {
  return PLACE_TOPICS.find(([pattern]) => pattern.test(question))?.[1] ?? null;
}

type Item =
  | { kind: 'ask'; at: number; session: Exclude<AskSession, { state: 'idle' }>; live: boolean }
  | { kind: 'message'; at: number; message: FeedMessage };

export function Thread({ session, history, mesh, news, openTopic, openPin }: {
  session: AskSession; history: FinishedAsk[]; mesh: MeshState; news: NewsKey;
  openTopic: (key: TopicKey) => void; openPin: (focus: MapFocus) => void;
}) {
  const items = useMemo(() => {
    const list: Item[] = history.map(done => ({ kind: 'ask' as const, at: done.attempt.askedAt, session: done, live: false }));
    if (session.state !== 'idle') list.push({ kind: 'ask', at: session.state === 'queued' ? session.queuedAt : session.attempt.askedAt, session, live: true });
    peerMessages(mesh).forEach(message => list.push({ kind: 'message', at: message.receivedAt, message }));
    return list.sort((a, b) => a.at - b.at);
  }, [history, session, mesh]);
  if (!items.length) return null;
  return <View accessibilityLabel="Your messages">
    {items.map(item => item.kind === 'ask'
      ? <AskItem key={`ask-${item.session.state === 'queued' ? item.session.id : item.session.attempt.id}`} session={item.session} live={item.live} news={news} openTopic={openTopic} />
      : <MessageItem key={item.message.id} message={item.message} mesh={mesh} openPin={openPin} />)}
  </View>;
}

function Mine({ text, children }: { text: string; children?: ReactNode }) {
  return <Arrive style={th.me}>
    <View style={th.bubble}><Txt style={{ color: t.color.onInk }} selectable>{text}</Txt></View>
    {children}
  </Arrive>;
}

function Reply({ children, source }: { children: ReactNode; source: string }) {
  return <Arrive style={th.reply}>{children}<Txt variant="caption" muted style={{ marginTop: 4 }}>{source}</Txt></Arrive>;
}

function AskItem({ session, live, news, openTopic }: { session: Exclude<AskSession, { state: 'idle' }>; live: boolean; news: NewsKey; openTopic: (key: TopicKey) => void }) {
  const { ask } = useRuntime();
  const question = session.state === 'queued' ? session.question : session.attempt.question;
  const cancel = live && (session.state === 'queued' || session.state === 'unreachable')
    ? <Button kind="line" small title="Cancel" label="Cancel this question" onPress={() => ask.cancel()} style={{ alignSelf: 'flex-end' }} /> : null;
  // Part of an answer arriving proves the question got through, even after "Not sent yet".
  const state = session.state === 'unreachable' && session.progress ? 'received' : session.state;
  switch (state) {
    case 'queued': return <View><Mine text={question}><Delivery bars={0} text="Not sent yet" tone="wait" />{cancel}</Mine></View>;
    case 'unreachable': return <View><Mine text={question}><Delivery bars={0} text="Not sent yet" tone="wait" />{cancel}</Mine></View>;
    case 'sent': return <View><Mine text={question}><Delivery bars={1} text="Sending" /></Mine></View>;
    case 'received': return <View><Mine text={question}>
      <Delivery bars={2} text="Delivered" tone="ok" />
      {'progress' in session && session.progress && <Txt variant="caption" muted style={{ textAlign: 'right' }}>Answer arriving, {session.progress.received} of {session.progress.total}</Txt>}
    </Mine></View>;
    case 'failed': if (session.state !== 'failed') return null; return <View>
      <Mine text={question}><Delivery bars={2} text="Delivered" tone="ok" /></Mine>
      <Reply source={`No answer, ${clockLabel(session.finishedAt)}`}><Txt>No answer this time.</Txt></Reply>
      {live && <Button kind="line" small title="Ask again" onPress={() => ask.retry()} style={{ alignSelf: 'flex-start', marginTop: t.space.xs }} />}
    </View>;
    case 'answered': {
      if (session.state !== 'answered') return null;
      const topic = placeTopicFor(question);
      const places = topic ? placesFor(topic, news) : null;
      return <View>
        <Mine text={question}><Delivery bars={3} text="Answered" tone="ok" /></Mine>
        <Reply source={`${AI_SOURCE} ${clockLabel(session.finishedAt)}`}><Txt selectable>{session.body || 'The answer was empty.'}</Txt></Reply>
        {topic && places && <MapCard place={places[0]} onOpen={() => openTopic(topic)} />}
      </View>;
    }
  }
}

function MapCard({ place, onOpen }: { place: Place; onOpen: () => void }) {
  return <Arrive style={th.mcard}>
    <View style={{ flex: 1 }}><Txt strong>{place.name}</Txt><Txt variant="callout" muted>{place.text}</Txt></View>
    <Button kind="line" small icon="location-on" title="Open map" label={`Open map of ${place.name}`} onPress={onOpen} />
  </Arrive>;
}

function MessageItem({ message, mesh, openPin }: { message: FeedMessage; mesh: MeshState; openPin: (focus: MapFocus) => void }) {
  const { mesh: store } = useRuntime();
  const share = decodeLocationShare(message.text);
  const note = share ? share.note : message.text;
  const sos = note === SOS_NOTE;
  const to = message.thread === 'public' ? 'everyone nearby' : mesh.knownPeers[message.thread]?.nickname ?? 'them';
  const body = sos ? (message.direction === 'out' ? 'SOS. I need help.' : `${message.fromNickname} needs help.`)
    : note === SOS_CANCEL_NOTE ? `SOS cancelled. ${message.direction === 'out' ? 'You are' : `${message.fromNickname} is`} OK now.` : note;
  const map = share && <Button kind="line" small icon="location-on" title="Open map" label={`Open map: ${message.direction === 'out' ? 'your location' : `${message.fromNickname}'s location`}`}
    onPress={() => openPin({ position: { lat: share.lat, lon: share.lon }, label: message.direction === 'out' ? 'You' : message.fromNickname })} style={{ alignSelf: 'flex-start' }} />;

  if (message.direction === 'out') {
    const status = message.status ?? 'sent';
    return <View>
      <Mine text={share && !sos ? `${body}. Where I am.` : body}>
        {status === 'sending' && <Delivery bars={1} text="Sending" />}
        {status === 'sent' && <Delivery bars={3} text={`Sent to ${to}`} tone="ok" />}
        {status === 'failed' && <>
          <Delivery bars={0} text="Not sent" tone="wait" />
          <Button kind="line" small title="Try again" label={`Send again to ${to}`} style={{ alignSelf: 'flex-end' }}
            onPress={() => { void store.send(message.thread, message.text).catch(() => {}); }} />
        </>}
      </Mine>
    </View>;
  }
  return <Arrive style={[th.reply, sos && th.danger]}>
    {sos && <View style={th.sosHead}><Icon name="warning" size={22} color={t.color.red} /><Txt variant="callout">SOS</Txt></View>}
    <Txt selectable>{body}</Txt>
    <Txt variant="caption" muted style={{ marginTop: 4 }}>From {message.fromNickname}{message.thread === 'public' ? ', to everyone nearby' : ''}, {clockLabel(message.receivedAt)}</Txt>
    {map && <View style={{ marginTop: t.space.xs }}>{map}</View>}
  </Arrive>;
}

const th = StyleSheet.create({
  me: { marginTop: t.space.gutter, alignItems: 'flex-end', gap: t.space.xs },
  bubble: { maxWidth: '85%', backgroundColor: t.color.ink, paddingVertical: 10, paddingHorizontal: 14, borderTopLeftRadius: t.radius.m, borderTopRightRadius: t.radius.m, borderBottomLeftRadius: t.radius.m, borderBottomRightRadius: t.radius.xs },
  reply: { marginTop: t.space.sm, maxWidth: '88%', alignSelf: 'flex-start', backgroundColor: t.color.surface2, paddingVertical: 10, paddingHorizontal: 14, borderTopLeftRadius: t.radius.m, borderTopRightRadius: t.radius.m, borderBottomRightRadius: t.radius.m, borderBottomLeftRadius: t.radius.xs },
  danger: { backgroundColor: t.color.redTint, borderWidth: 1, borderColor: t.color.redLine },
  sosHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  mcard: { marginTop: t.space.sm, borderWidth: 1, borderColor: t.color.line, borderRadius: t.radius.m, padding: t.space.sm, flexDirection: 'row', alignItems: 'center', gap: t.space.xs },
});
