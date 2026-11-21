import { StyleSheet, View } from 'react-native';
import { QuestionItem, QuestionStatus } from '../ask/QuestionThread';
import { formatTime } from '../briefing/types';
import { RelayStatus } from '../relay/RelayStore';
import { useStyles, useTheme } from '../theme/theme';
import { Palette, tokens as t } from '../theme/tokens';
import { FadeIn, SendBars, StateLine, Txt } from './ui';

type Shown = { bars: 0 | 1 | 2 | 3; kind: 'done' | 'waiting' | null; word: string };
const QUESTION: Record<QuestionStatus, Shown> = {
  sending: { bars: 1, kind: null, word: 'Sending' },
  delivered: { bars: 2, kind: 'done', word: 'Delivered' },
  answered: { bars: 3, kind: 'done', word: 'Answered' },
  notSent: { bars: 0, kind: 'waiting', word: 'Not sent yet' },
  noAnswer: { bars: 2, kind: 'waiting', word: 'No answer yet' },
};

/** A message you sent, with what happened to it underneath. Words match the bars. */
export function SentMessage({ text, shown }: { text: string; shown: Shown }) {
  const s = useStyles(makeStyles);
  return <FadeIn style={s.sent}>
    <View style={s.bubble}><Txt color={s.bubbleText.color} style={{ fontSize: 19, lineHeight: 26 }}>{text}</Txt></View>
    <SendBars filled={shown.bars} />
    <View accessibilityLiveRegion="polite" style={{ alignSelf: 'flex-end' }}>
      {shown.kind ? <StateLine kind={shown.kind}>{shown.word}</StateLine> : <Txt variant="caption" style={{ fontSize: 15 }}>{shown.word}</Txt>}
    </View>
  </FadeIn>;
}

export function relayShown(status: RelayStatus, name: string): Shown {
  return status === 'delivered' ? { bars: 3, kind: 'done', word: `Delivered to ${name}` }
    : status === 'sending' ? { bars: 1, kind: null, word: 'Sending' } : { bars: 0, kind: 'waiting', word: 'Not sent yet' };
}

/** The answer appears under the question, with where it came from. */
export function Answer({ text, at }: { text: string; at: number }) {
  const s = useStyles(makeStyles);
  return <FadeIn style={s.answer}>
    <Txt selectable style={{ fontSize: 19, lineHeight: 27 }}>{text}</Txt>
    <Txt variant="caption" style={{ fontSize: 15, lineHeight: 21 }}>Computer answer, {formatTime(at)}</Txt>
  </FadeIn>;
}

export function Thread({ items }: { items: QuestionItem[] }) {
  return <View style={{ gap: t.space.s6 }}>
    {items.map(item => <View key={item.id} style={{ gap: t.space.s5 }}>
      <SentMessage text={item.question} shown={QUESTION[item.status]} />
      {item.status === 'answered' && <Answer text={item.answer || 'No answer came back.'} at={item.answeredAt ?? Date.now()} />}
    </View>)}
  </View>;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  sent: { alignItems: 'flex-end', gap: t.space.s3 },
  bubble: {
    backgroundColor: c.ink, maxWidth: '85%', paddingHorizontal: t.space.s6, paddingVertical: t.space.s4,
    borderRadius: t.radius.m, borderBottomRightRadius: t.radius.tail,
  },
  bubbleText: { color: c.onInk },
  answer: {
    backgroundColor: c.surface2, maxWidth: '85%', alignSelf: 'flex-start', padding: t.space.s6, paddingVertical: t.space.s5,
    borderRadius: t.radius.m, borderTopLeftRadius: t.radius.tail, gap: t.space.s2,
  },
});
