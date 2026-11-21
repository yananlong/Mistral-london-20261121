import { StyleSheet, View } from 'react-native';
import { tokens as t } from '../theme/tokens';
import { Icon, Txt } from './ui';

/**
 * What happened to a message: three bars and a few words (design/components.html,
 * "Did my message get through?"). Bars fill green as it goes; a yellow clock
 * means "Not sent yet"; a green check means delivered or answered.
 */
export function Delivery({ bars, text, tone }: { bars: 0 | 1 | 2 | 3; text: string; tone?: 'ok' | 'wait' }) {
  return <View style={d.box} accessibilityLiveRegion="polite" accessibilityLabel={text}>
    <View style={d.bars}>{[0, 1, 2].map(i => <View key={i} style={[d.bar, i < bars && d.on]} />)}</View>
    <View style={d.status}>
      {tone === 'ok' && <Icon name="check-circle" size={18} color={t.color.green} />}
      {tone === 'wait' && <Icon name="schedule" size={18} color={t.color.yellow} />}
      <Txt variant="caption" style={{ lineHeight: 20, color: tone ? t.color.ink : t.color.ink2, textAlign: 'right' }}>{text}</Txt>
    </View>
  </View>;
}

const d = StyleSheet.create({
  box: { width: 200, gap: 6, alignSelf: 'flex-end' },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: t.color.line },
  on: { backgroundColor: t.color.green },
  status: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
});
