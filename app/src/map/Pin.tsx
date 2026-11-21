import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/ui';
import { tokens as t } from '../theme/tokens';
import { MapPoint } from './types';

/** Map pins from the design: numbered white circles for places, a dot for you, a labelled tag for people. */
export function Pin({ point }: { point: MapPoint }) {
  if (point.kind === 'self') return <View style={pin.selfRing}><View style={pin.selfDot} /></View>;
  if (point.kind === 'place') return <View style={pin.number}><Text style={pin.numberText}>{point.number ?? ''}</Text></View>;
  return <View style={[pin.tag, point.danger && pin.danger]}>
    {point.danger && <Icon name="warning" size={16} color={t.color.red} />}
    <Text numberOfLines={1} style={pin.tagText}>{point.label}</Text>
  </View>;
}

export const pin = StyleSheet.create({
  selfRing: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  selfDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.color.ink },
  number: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.color.ink, alignItems: 'center', justifyContent: 'center' },
  numberText: { color: t.color.onInk, fontFamily: t.font.semibold, fontSize: 13, lineHeight: 16, fontVariant: ['tabular-nums'] },
  tag: { maxWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: t.space.xs, paddingVertical: 2, borderRadius: t.radius.xs, backgroundColor: t.color.surface2, borderWidth: 1, borderColor: t.color.lineStrong },
  danger: { backgroundColor: t.color.redTint, borderColor: t.color.redLine },
  tagText: { color: t.color.ink, fontFamily: t.font.semibold, fontSize: 13, lineHeight: 16 },
});
