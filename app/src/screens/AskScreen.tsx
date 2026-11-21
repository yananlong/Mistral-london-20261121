import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { SUGGESTED_QUESTIONS } from '../ask/questions';
import { AskStatus } from '../components/AskStatus';
import { Body, Button, Card, Heading, Notice, styles } from '../components/ui';
import { ANSWER_LABEL, MAX_QUESTION_BYTES, prefixBytes, trim, utf8Bytes } from '../protocol';
import { useAsk, useLocation, useMesh, useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';

export const DISCLAIMER = 'Answers come from an AI model on the hub and are not verified emergency advice. Call 999 or 112 if you can reach them.';

export function AskScreen({ openLocate }: { openLocate: () => void }) {
  const { ask, kind } = useRuntime();
  const mesh = useMesh();
  const session = useAsk();
  const location = useLocation();
  const [question, setQuestion] = useState('');
  const [attachLocation, setAttachLocation] = useState(false);
  const remaining = MAX_QUESTION_BYTES - utf8Bytes(question);
  const canAsk = mesh.hubId !== null && (!attachLocation || location.kind === 'ready');
  const submit = (text: string) => ask.submit(text, attachLocation && location.kind === 'ready' ? location.position : null);
  const hubNearby = mesh.peers.some(peer => peer.id === mesh.hubId && peer.reachable);

  return <View style={styles.stack}>
    <View><Heading>Ask the hub</Heading><Body>Practical questions. One question at a time.</Body></View>
    {kind === 'simulated' && <Notice>Demo answers are canned. No model is running on this simulated link.</Notice>}
    {mesh.hubId === null ? <Notice>Looking for the hub… Your question can be sent after the hub has been seen.</Notice>
      : <Body style={styles.small}>{hubNearby ? 'Hub is nearby' : 'Hub was seen earlier. It may be out of range.'}</Body>}
    {session.state === 'idle' ? <>
      <Card>
        <View style={[styles.row, { justifyContent: 'space-between', minHeight: t.target }]}>
          <Body style={{ flex: 1 }}>Attach my location</Body>
          <Switch accessibilityLabel="Attach my location" value={attachLocation} onValueChange={setAttachLocation} hitSlop={{ top: t.space.sm, bottom: t.space.sm, left: t.space.sm, right: t.space.sm }}
            trackColor={{ false: t.color.border, true: t.color.primary }} />
        </View>
        <Body style={styles.small}>{attachLocation ? 'Your coordinates will travel with this question.' : 'Off by default. Your position stays on this phone.'}</Body>
        {attachLocation && location.kind !== 'ready' && <>
          <Body>Get a position before attaching it.</Body><Button secondary title="Find my position" onPress={openLocate} />
        </>}
        {attachLocation && location.kind === 'ready' && <Body style={styles.small}>
          {location.source === 'demo' ? 'Demo position' : 'Your position'}: {location.position.lat.toFixed(5)}, {location.position.lon.toFixed(5)}
        </Body>}
      </Card>
      <Text accessibilityRole="header" style={styles.subheading}>Choose a question</Text>
      {SUGGESTED_QUESTIONS.map(item => <Button key={item.topic} secondary title={item.title} label={item.title} disabled={!canAsk} onPress={() => submit(item.text)} />)}
      <Card>
        <Text style={styles.subheading}>Or use your own words</Text>
        <TextInput accessibilityLabel="Your question" multiline value={question} onChangeText={text => setQuestion(prefixBytes(text, MAX_QUESTION_BYTES))}
          maxLength={MAX_QUESTION_BYTES} placeholder="What do you need help with?" placeholderTextColor={t.color.muted} style={[styles.input, { minHeight: 112 }]} />
        {remaining <= 50 && <Body style={styles.small}>{remaining} bytes remaining</Body>}
        <Button title="Send question" disabled={!canAsk || !trim(question)} onPress={() => submit(question)} />
      </Card>
    </> : <>
      <Card><Body style={styles.small}>YOU ASKED</Body><Body>{session.attempt.question}</Body></Card>
      <AskStatus session={session} />
      {session.state === 'answered' && <Card>
        <Text accessibilityRole="header" style={styles.subheading}>From the hub</Text>
        <Body selectable>{session.body || 'The hub returned an empty answer.'}</Body>
        <Notice>{ANSWER_LABEL}</Notice>
      </Card>}
      {(session.state === 'unreachable' || session.state === 'failed') && <Button title="Retry" onPress={() => ask.retry()} />}
      {(session.state === 'answered' || session.state === 'unreachable' || session.state === 'failed') &&
        <Button title="Ask another question" secondary onPress={() => { ask.reset(); setQuestion(''); setAttachLocation(false); }} />}
    </>}
  </View>;
}
