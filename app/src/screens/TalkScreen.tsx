import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Body, Button, Card, Heading, Notice, styles } from '../components/ui';
import { decodeLocationShare, HUB_NICKNAME } from '../protocol';
import { MapFocus } from '../map/types';
import { ThreadKey } from '../store/MeshStore';
import { useAsk, useMesh, useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';

export function TalkScreen({ openPin, openAsk }: { openPin: (focus: MapFocus) => void; openAsk: () => void }) {
  const runtime = useRuntime();
  const mesh = useMesh();
  const ask = useAsk();
  const [thread, setThread] = useState<ThreadKey>('public');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending'>('idle');
  const nearby = mesh.peers.filter(peer => peer.reachable);
  const otherThreads = Object.values(mesh.knownPeers).filter(peer => !nearby.some(near => near.id === peer.id) && mesh.conversations[peer.id]?.length);
  const isHub = thread !== 'public' && (thread === mesh.hubId || mesh.knownPeers[thread]?.nickname === HUB_NICKNAME);
  const hubBusy = ask.state === 'sent' || ask.state === 'received';
  const send = async () => {
    if (!text.trim() || sendState === 'sending') return;
    if (isHub) {
      if (hubBusy) return;
      runtime.ask.reset();
      runtime.ask.submit(text, null);
      setText('');
      openAsk();
      return;
    }
    setSendState('sending');
    setError('');
    try { await runtime.mesh.send(thread, text.trim()); setText(''); }
    catch { setError('The message could not be sent. Check the link and try again.'); }
    finally { setSendState('idle'); }
  };
  const selectThread = (key: ThreadKey) => { setThread(key); setError(''); setText(''); };

  return <View style={styles.stack}>
    <View><Heading>Talk nearby</Heading><Body>Stay in touch with people around you.</Body></View>
    <Card>
      <Text accessibilityRole="header" style={styles.subheading}>Nearby peers · {nearby.length}</Text>
      {nearby.length === 0 && <Body>No one nearby</Body>}
      {nearby.map(peer => <Button key={peer.id} secondary selected={thread === peer.id}
        title={`${peer.nickname}${peer.nickname === HUB_NICKNAME ? ' · offline AI' : ''}`} label={`Open private thread with ${peer.nickname}`} onPress={() => selectThread(peer.id)} />)}
    </Card>
    {otherThreads.length > 0 && <Card><Text style={styles.subheading}>Earlier conversations</Text>
      {otherThreads.map(peer => <Button key={peer.id} secondary selected={thread === peer.id} title={`${peer.nickname} · not nearby`} label={`Open private thread with ${peer.nickname}`} onPress={() => selectThread(peer.id)} />)}
    </Card>}
    <Button secondary selected={thread === 'public'} title="Public channel" onPress={() => selectThread('public')} />
    <Text accessibilityRole="header" style={styles.subheading}>{thread === 'public' ? 'Everyone on the mesh' : `Private · ${mesh.knownPeers[thread]?.nickname ?? 'Peer'}`}</Text>
    <Body style={styles.small}>{thread === 'public' ? 'Public messages can be read by everyone on the mesh.' : 'Only this peer is the recipient. Messages may be relayed by other phones.'}</Body>
    {(mesh.conversations[thread] ?? []).length === 0 && <Notice>No messages yet. Say where you are or ask if someone needs help.</Notice>}
    {(mesh.conversations[thread] ?? []).map(message => {
      const share = decodeLocationShare(message.text);
      return <View key={message.id} style={[local.message, message.direction === 'out' ? local.outgoing : local.incoming]}>
        <Body style={styles.small}>{message.fromNickname} · {new Date(message.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Body>
        {share ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${message.fromNickname} location in Locate`}
          onPress={() => openPin({ position: { lat: share.lat, lon: share.lon }, label: message.fromNickname })} style={local.location}>
          <Body style={{ fontWeight: t.weight.bold }}>Location · {share.note || 'Shared location'}</Body>
          <Body>{share.lat.toFixed(5)}, {share.lon.toFixed(5)}</Body>
          <Body style={styles.small}>Open in Locate →</Body>
        </Pressable> : <Body selectable>{message.text}</Body>}
      </View>;
    })}
    {isHub && <Notice>{hubBusy ? 'A question is already on its way. Follow its status in Ask.' : 'Questions to the hub share the Ask screen’s status and timer.'}</Notice>}
    <Card>
      <TextInput accessibilityLabel="Message" multiline value={text} onChangeText={setText} style={styles.input}
        placeholder="Write a short message" placeholderTextColor={t.color.muted} maxLength={isHub ? 500 : 1000} />
      {error !== '' && <Body accessibilityRole="alert">{error}</Body>}
      <Button title={isHub ? 'Ask hub' : sendState === 'sending' ? 'Sending…' : 'Send message'}
        disabled={!text.trim() || sendState === 'sending' || (isHub && hubBusy) || mesh.link !== 'running'} onPress={() => { void send(); }} />
    </Card>
  </View>;
}

const local = StyleSheet.create({
  message: { padding: t.space.md, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, gap: t.space.xs },
  outgoing: { marginLeft: t.space.lg, backgroundColor: t.color.ownMessage },
  incoming: { marginRight: t.space.lg, backgroundColor: t.color.peerMessage },
  location: { minHeight: t.target, justifyContent: 'center', gap: t.space.xs, paddingVertical: t.space.sm },
});
