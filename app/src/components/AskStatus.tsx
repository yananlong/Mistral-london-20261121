import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AskSession } from '../ask/AskController';
import { tokens as t } from '../theme/tokens';
import { Body } from './ui';

const labels = { sent: 'Sent', received: 'Received by hub', answered: 'Answered', unreachable: 'Hub not reachable', failed: 'Hub could not answer' };
const details = {
  sent: 'Waiting for the hub to receive your question.', received: 'The hub has your question. The answer is coming.',
  answered: 'Read the answer below. Take care and seek help if you can.',
  unreachable: 'No receipt from the hub. You can retry the same question.',
  failed: 'No answer this time. You can retry the same question.',
};

export function AskStatus({ session }: { session: Exclude<AskSession, { state: 'idle' }> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (session.state !== 'sent' && session.state !== 'received') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);
  const end = 'finishedAt' in session ? session.finishedAt : now;
  const seconds = Math.max(0, Math.floor((end - session.attempt.startedAt) / 1000));
  return <View accessibilityLiveRegion="polite" style={[local.status, (session.state === 'failed' || session.state === 'unreachable') && local.warning]}>
    <Text style={local.eyebrow}>QUESTION STATUS</Text>
    <Text accessibilityRole="header" style={local.title}>{labels[session.state]}</Text>
    <Body>{details[session.state]}</Body>
    <Text style={local.time}>{seconds}s elapsed</Text>
  </View>;
}
const local = StyleSheet.create({
  status: { padding: t.space.lg, borderRadius: t.radius.md, backgroundColor: t.color.primarySoft, gap: t.space.sm, borderWidth: 2, borderColor: t.color.primary },
  warning: { backgroundColor: t.color.warningSoft, borderColor: t.color.warning },
  eyebrow: { color: t.color.ink, fontSize: t.font.small, fontWeight: t.weight.bold, letterSpacing: 1 },
  title: { fontSize: t.font.status, fontWeight: t.weight.bold, color: t.color.ink },
  time: { fontSize: t.font.label, fontWeight: t.weight.bold, color: t.color.ink, fontVariant: ['tabular-nums'] },
});
