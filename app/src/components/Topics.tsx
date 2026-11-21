import { Pressable, StyleSheet, View } from 'react-native';
import { NewsKey, placesFor, TopicKey, TOPICS } from '../content/scenario';
import { tokens as t } from '../theme/tokens';
import { Icon, Txt } from './ui';

/**
 * "What you can find": six topics with a picture each (hint, then reveal).
 * The line under each says whether there is anything to find yet.
 */
export function availability(key: TopicKey, news: NewsKey): { tone: 'has' | 'wait' | 'plain'; icon: 'check' | 'schedule' | 'arrow-upward'; text: string } {
  if (key === 'firstaid') return { tone: 'has', icon: 'check', text: 'On your phone' };
  if (key === 'family') return { tone: 'plain', icon: 'arrow-upward', text: 'Send a message' };
  const places = placesFor(key, news);
  return places ? { tone: 'has', icon: 'check', text: `${places.length} ${places.length === 1 ? 'place' : 'places'}` } : { tone: 'wait', icon: 'schedule', text: 'Nothing yet' };
}

export function Topics({ news, onOpen }: { news: NewsKey; onOpen: (key: TopicKey) => void }) {
  return <View>
    <View style={s.head}><Txt variant="title2" accessibilityRole="header">What you can find</Txt></View>
    <View style={s.grid}>
      {TOPICS.map(topic => {
        const a = availability(topic.key, news);
        return <Pressable key={topic.key} accessibilityRole="button" accessibilityLabel={`${topic.label}. ${a.text}`} onPress={() => onOpen(topic.key)}
          style={({ pressed }) => [s.tile, pressed && s.pressed]}>
          <Icon name={topic.icon} size={36} />
          <Txt strong style={{ lineHeight: 22 }}>{topic.label}</Txt>
          <View style={s.av}>
            <Icon name={a.icon} size={18} color={a.tone === 'has' ? t.color.green : a.tone === 'wait' ? t.color.yellow : t.color.ink2} />
            <Txt variant="caption" style={{ lineHeight: 20, color: a.tone === 'has' ? t.color.ink : t.color.ink2 }}>{a.text}</Txt>
          </View>
        </Pressable>;
      })}
    </View>
  </View>;
}

const s = StyleSheet.create({
  head: { marginTop: t.space.xl, paddingTop: t.space.lg, borderTopWidth: 1, borderColor: t.color.line },
  grid: { marginTop: t.space.sm, flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs },
  tile: { flexBasis: '48%', flexGrow: 1, minHeight: 104, borderWidth: 1, borderColor: t.color.line, borderRadius: t.radius.m, padding: t.space.sm, gap: 6 },
  pressed: { borderColor: t.color.lineStrong, transform: [{ scale: 0.97 }] },
  av: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
