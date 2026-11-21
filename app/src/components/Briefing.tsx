import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Answer, BRIEFING_QUESTIONS, NEWS, NewsKey } from '../content/scenario';
import { tokens as t } from '../theme/tokens';
import { Arrive, Icon, NotKnownYet, Txt } from './ui';

/**
 * "What's going on?" One big line, one fact under it, then three questions.
 * Every answer is a fact with its source, or "Not known yet". When news turns
 * a "Not known yet" into a fact, a small "New" tag marks what changed.
 */
export function Briefing({ news }: { news: NewsKey }) {
  const brief = NEWS[news];
  // Remember the briefing shown before this one, so "New" marks only the change just made.
  const [shown, setShown] = useState({ current: news, previous: news });
  if (shown.current !== news) setShown({ current: news, previous: shown.current });
  const before = NEWS[shown.previous];
  const isNew = (i: number) => shown.previous !== news && brief.rows[i] !== null && before.rows[i] === null;

  return <View accessibilityLabel="What's going on">
    <Arrive key={`place-${news}`} style={b.place}>
      <Icon name={brief.icon} size={22} color={brief.done ? t.color.green : t.color.ink} />
      <Txt variant="callout" muted>Across the UK, updated {brief.updated}</Txt>
    </Arrive>
    <Arrive key={`head-${news}`}>
      <Txt variant="display" accessibilityRole="header" style={{ marginTop: 10 }}>{brief.display}</Txt>
      <Txt variant="title1" muted style={{ marginTop: 2 }}>{brief.sub}</Txt>
    </Arrive>
    <View style={b.qa}>
      {BRIEFING_QUESTIONS.map((question, i) => <View key={question} style={[b.row, i === BRIEFING_QUESTIONS.length - 1 && { borderBottomWidth: 0 }]}>
        <View style={b.q}>
          <Txt variant="callout" muted>{question}</Txt>
          {isNew(i) && <View style={b.newTag}><Txt variant="caption" strong>New</Txt></View>}
        </View>
        <Arrive key={`${question}-${brief.rows[i]?.text ?? 'unknown'}`}><AnswerView answer={brief.rows[i]} /></Arrive>
      </View>)}
    </View>
  </View>;
}

function AnswerView({ answer }: { answer: Answer }) {
  if (!answer) return <NotKnownYet />;
  return <View><Txt>{answer.text}</Txt><Txt variant="caption" muted style={{ marginTop: 2 }}>{answer.source}</Txt></View>;
}

const b = StyleSheet.create({
  place: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs },
  qa: { marginTop: 28, borderTopWidth: 1, borderColor: t.color.line },
  row: { paddingTop: t.space.sm, paddingBottom: 14, borderBottomWidth: 1, borderColor: t.color.line },
  q: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, marginBottom: t.space.xxs },
  newTag: { borderWidth: 1, borderColor: t.color.lineStrong, borderRadius: t.radius.xs, paddingHorizontal: 5 },
});
