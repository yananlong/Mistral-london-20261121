import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { PropsWithChildren, ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleProp, StyleSheet, Text, TextProps, TextStyle, View, ViewStyle } from 'react-native';
import type { IconName } from '../content/scenario';
import { tokens as t, TypeStyle } from '../theme/tokens';

/** The small card kit from design/components.html. Every screen is built from these. */

export function Txt({ variant = 'body', strong, muted, style, children, ...props }: TextProps & {
  variant?: TypeStyle; strong?: boolean; muted?: boolean;
}) {
  const semibold = strong ?? (variant !== 'body' && variant !== 'caption');
  return <Text {...props} style={[t.type[variant], { fontFamily: semibold ? t.font.semibold : t.font.regular, color: muted ? t.color.ink2 : t.color.ink }, style]}>{children}</Text>;
}

export function Icon({ name, size = 24, color = t.color.ink, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  return <MaterialIcons name={name} size={size} color={color} style={style} accessibilityElementsHidden importantForAccessibility="no" />;
}

/** A state is a coloured icon and a plain word. No badge, no fill (PRINCIPLES §3, §4). */
export type Tone = 'wait' | 'done' | 'danger' | 'plain';
export const toneColor: Record<Tone, string> = { wait: t.color.yellow, done: t.color.green, danger: t.color.red, plain: t.color.ink };
export function Status({ tone, icon, children, size = 22 }: PropsWithChildren<{ tone: Tone; icon: IconName; size?: number }>) {
  return <View style={ui.status}><Icon name={icon} size={size} color={toneColor[tone]} /><Txt variant="callout">{children}</Txt></View>;
}
export const NotKnownYet = () => <Status tone="wait" icon="schedule">Not known yet</Status>;

type ButtonKind = 'primary' | 'line' | 'red';
export function Button({ title, onPress, kind = 'primary', small, icon, label, disabled, style }: {
  title: string; onPress: () => void; kind?: ButtonKind; small?: boolean; icon?: IconName; label?: string; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const fg = kind === 'primary' ? t.color.onInk : kind === 'red' ? t.color.onFill : t.color.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.button, small && ui.buttonSmall, ui[kind], disabled && ui.disabled, pressed && ui.pressed, style]}>
    {icon && <Icon name={icon} size={20} color={fg} />}
    <Txt variant="callout" style={{ color: fg }}>{title}</Txt>
  </Pressable>;
}

/** A toggle button: white fill when pressed. Used for choices and demo controls. */
export function Toggle({ title, selected, onPress, icon }: { title: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => [ui.toggle, selected && ui.toggleOn, pressed && ui.pressed]}>
    {icon && <Icon name={icon} size={20} color={selected ? t.color.onInk : t.color.ink} />}
    <Txt variant="callout" style={{ color: selected ? t.color.onInk : t.color.ink }}>{title}</Txt>
  </Pressable>;
}

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduce(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduce;
}

/** Motion: things fade in. Only for a real change. Nothing loops (PRINCIPLES §5). */
export function Arrive({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(value, { toValue: 1, duration: reduce ? 0 : t.motion.arrive, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [reduce, value]);
  return <Animated.View style={[style, { opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }]}>{children}</Animated.View>;
}

export const ui = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: { minHeight: t.target, paddingHorizontal: 18, borderRadius: t.radius.m, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.space.xs },
  buttonSmall: { minHeight: t.targetSmall, paddingHorizontal: 14 },
  primary: { backgroundColor: t.color.ink },
  line: { borderWidth: 1, borderColor: t.color.lineStrong },
  red: { backgroundColor: t.color.redFill },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  toggle: { minHeight: t.targetSmall, paddingHorizontal: t.space.md, borderRadius: t.radius.m, borderWidth: 1, borderColor: t.color.line, flexDirection: 'row', alignItems: 'center', gap: t.space.xs },
  toggleOn: { backgroundColor: t.color.ink, borderColor: t.color.ink },
  rule: { height: 1, backgroundColor: t.color.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, flexWrap: 'wrap' },
});
