import { Pressable, StyleSheet, View } from 'react-native';
import { BriefingView as Briefing, Fact, formatTime, TOPIC_IDS, TopicId } from '../briefing/types';
import { TOPICS } from '../content/topics';
import { useStyles, useTheme } from '../theme/theme';
import { Palette, tokens as t } from '../theme/tokens';
import { Divider, FadeIn, Icon, NewTag, StateLine, Txt } from './ui';

/** "Southwark, updated 2:05pm", then the one fact on opening, then the line under it. */
export function BriefingHeader({ briefing }: { briefing: Briefing }) {
  const { c } = useTheme();
  const icon = briefing.kind === 'fixed' ? <Icon name="check-circle" color={c.green} size={28} label="Fixed" />
    : <Icon name={briefing.kind === 'no-signal' ? 'signal-cellular-off' : 'power-off'} size={28}
      label={briefing.kind === 'no-signal' ? 'No phone signal' : 'Power cut'} />;
  return <View style={local.header} accessibilityRole="header">
    <View style={local.updated}>{icon}<Txt variant="callout" color={c.ink2} style={{ fontSize: 17 }}>{briefing.area}, updated {formatTime(briefing.updatedAt)}</Txt></View>
    <FadeIn key={`${briefing.headline}|${briefing.subline}`}>
      <Txt variant="display">{briefing.headline}</Txt>
      <Txt variant="title1" color={c.ink2} style={{ fontSize: 34, lineHeight: 40 }}>{briefing.subline}</Txt>
    </FadeIn>
  </View>;
}

export function TopicGrid({ briefing, onOpen }: { briefing: Briefing; onOpen: (topic: TopicId) => void }) {
  const s = useStyles(makeStyles);
  return <View style={{ gap: t.space.s4 }}>
    <Txt variant="title2" accessibilityRole="header" style={{ fontSize: 26, lineHeight: 32 }}>What you can find</Txt>
    <View style={s.grid}>
      {TOPIC_IDS.map(id => {
        const topic = TOPICS[id];
        const count = briefing.places[id]?.length ?? 0;
        const line = id === 'firstAid' ? { kind: 'found' as const, text: 'On your phone' }
          : id === 'family' ? { kind: 'send' as const, text: 'Send a message' }
            : count > 0 ? { kind: 'found' as const, text: `${count} ${count === 1 ? 'place' : 'places'}` }
              : { kind: 'waiting' as const, text: 'Nothing yet' };
        return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${topic.name}, ${line.text}`} onPress={() => onOpen(id)}
          style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]}>
          <Icon name={topic.icon} size={40} />
          <View style={{ gap: t.space.s1 }}>
            <Txt variant="title2" numberOfLines={2}>{topic.name}</Txt>
            <StateLine kind={line.kind} variant="body" muted={line.kind !== 'found'}>{line.text}</StateLine>
          </View>
        </Pressable>;
      })}
    </View>
  </View>;
}

/** Three questions. Every answer is a fact with its source, or "Not known yet". */
export function BriefingFacts({ briefing }: { briefing: Briefing }) {
  const rows: { key: 'happened' | 'why' | 'fixed'; question: string; fact: Fact | null }[] = [
    { key: 'happened', question: 'What happened?', fact: briefing.happened },
    { key: 'why', question: 'Why?', fact: briefing.why },
    { key: 'fixed', question: 'When will it be fixed?', fact: briefing.fixed },
  ];
  const { c } = useTheme();
  return <View>
    {rows.map(row => <View key={row.key}>
      <Divider />
      <View style={local.fact} accessible accessibilityLabel={`${row.question} ${row.fact ? `${row.fact.text} From ${row.fact.source}, ${formatTime(row.fact.at)}` : 'Not known yet'}`}>
        <View style={local.question}>
          <Txt variant="bodyStrong" color={c.ink2}>{row.question}</Txt>
          {row.fact && briefing.changed.has(row.key) && <NewTag />}
        </View>
        {row.fact ? <FadeIn key={row.fact.text}>
          <Txt style={{ fontSize: 19, lineHeight: 27 }}>{row.fact.text}</Txt>
          <Txt variant="caption" style={{ fontSize: 15, lineHeight: 22 }}>From {row.fact.source}, {formatTime(row.fact.at)}</Txt>
        </FadeIn> : <StateLine kind="waiting" strong>Not known yet</StateLine>}
      </View>
    </View>)}
    <Divider />
  </View>;
}

const local = StyleSheet.create({
  header: { gap: t.space.s4, paddingTop: t.space.s6 },
  updated: { flexDirection: 'row', alignItems: 'center', gap: t.space.s3 },
  fact: { paddingVertical: t.space.s5, gap: t.space.s2 },
  question: { flexDirection: 'row', alignItems: 'center', gap: t.space.s2 },
});

const makeStyles = (c: Palette) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.s3 },
  tile: {
    flexBasis: '46%', flexGrow: 1, minHeight: 108, borderWidth: 1, borderColor: c.line, borderRadius: t.radius.m,
    padding: t.space.s4, gap: t.space.s3, backgroundColor: c.surface,
  },
});
