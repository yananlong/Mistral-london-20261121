import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ComponentProps, PropsWithChildren, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, Text, TextProps, TextStyle, View, ViewStyle } from 'react-native';
import { useStyles, useTheme } from '../theme/theme';
import { fonts, Palette, tokens as t, type, TypeStyle } from '../theme/tokens';

/** Material Symbols (Rounded, filled) names, as published by @expo/vector-icons. */
export type IconName = ComponentProps<typeof MaterialIcons>['name'];

export function Icon({ name, size = 24, color, label }: { name: IconName; size?: number; color?: string; label?: string }) {
  const { c } = useTheme();
  return <MaterialIcons name={name} size={size} color={color ?? c.ink}
    accessible={label !== undefined} accessibilityLabel={label} importantForAccessibility={label ? 'yes' : 'no-hide-descendants'} />;
}

export function textStyle(variant: TypeStyle): TextStyle {
  const s = type[variant];
  return { fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, fontFamily: s.weight === 'semibold' ? fonts.semibold : fonts.regular };
}

/** One typeface, eight styles. Text is always flush left. */
export function Txt({ variant = 'body', color, style, children, ...props }: TextProps & { variant?: TypeStyle; color?: string }) {
  const { c } = useTheme();
  const fallback = variant === 'caption' ? c.ink2 : c.ink;
  return <Text {...props} style={[textStyle(variant), { color: color ?? fallback }, style]}>{children}</Text>;
}

/**
 * A state is a coloured icon and a word, never colour alone.
 * waiting: yellow clock (yellow is never text); done: green check in a circle;
 * found: green tick; send: grey arrow.
 */
export type StateKind = 'waiting' | 'done' | 'found' | 'send';
export function StateLine({ kind, children, variant = 'caption', strong = false, muted = false }: PropsWithChildren<{ kind: StateKind; variant?: TypeStyle; strong?: boolean; muted?: boolean }>) {
  const { c } = useTheme();
  const size = variant === 'caption' || variant === 'label' ? 18 : 24;
  return <View style={local.state}>
    <StateIcon kind={kind} size={size} />
    <Txt variant={strong ? 'bodyStrong' : variant} color={muted ? c.ink2 : c.ink} style={{ flexShrink: 1, fontSize: variant === 'caption' ? 15 : undefined }}>{children}</Txt>
  </View>;
}

/** The icon half of a state. Material's filled clock is drawn as a yellow disc with a dark hand, as in the design. */
export function StateIcon({ kind, size = 24 }: { kind: StateKind; size?: number }) {
  const { c } = useTheme();
  const icon: Record<StateKind, { name: IconName; color: string }> = {
    waiting: { name: 'schedule', color: c.yellow }, done: { name: 'check-circle', color: c.green },
    found: { name: 'check', color: c.green }, send: { name: 'arrow-upward', color: c.ink2 },
  };
  return <View style={[local.stateIcon, { width: size, height: size }]}>
    {kind === 'waiting' ? <View style={[local.clockDisc, { width: size - 2, height: size - 2, borderRadius: size, backgroundColor: c.yellow }]}>
      <MaterialIcons name="schedule" size={size} color={c.onYellow} style={{ margin: -1 }} />
    </View> : <Icon name={icon[kind].name} size={size} color={icon[kind].color} />}
  </View>;
}

export function Card({ children, style, tone = 'plain' }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; tone?: 'plain' | 'quiet' | 'danger' }>) {
  const s = useStyles(makeStyles);
  return <View style={[s.card, tone === "quiet" && s.cardQuiet, tone === "danger" && s.cardDanger, style]}>{children}</View>;
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: c.line }} />;
}

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'quiet';
export function Button({ title, onPress, variant = 'primary', icon, label, disabled = false, style, height = t.action }: {
  title: string; onPress: () => void; variant?: ButtonVariant; icon?: IconName; label?: string; disabled?: boolean;
  style?: StyleProp<ViewStyle>; height?: number;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const color = variant === 'primary' ? c.onInk : variant === 'danger' ? c.onFill : c.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, { minHeight: height }, s[variant], disabled && { opacity: 0.4 }, pressed && { opacity: 0.7 }, style]}>
    {icon && <Icon name={icon} size={22} color={color} />}
    <Txt variant="callout" color={color} style={{ fontSize: 17 }}>{title}</Txt>
  </Pressable>;
}

/**
 * Three delivery bars: one fills when sending starts, two when delivered,
 * three when answered. Bars fill over 250 ms and never loop.
 */
export function SendBars({ filled }: { filled: 0 | 1 | 2 | 3 }) {
  const { c } = useTheme();
  return <View style={local.bars} importantForAccessibility="no-hide-descendants">
    {[1, 2, 3].map(index => <Bar key={index} on={filled >= index} track={c.line} fill={c.green} />)}
  </View>;
}
function Bar({ on, track, fill }: { on: boolean; track: string; fill: string }) {
  const { reduceMotion } = useTheme();
  const value = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { value.setValue(on ? 1 : 0); return; }
    Animated.timing(value, { toValue: on ? 1 : 0, duration: t.motion.expand, useNativeDriver: false }).start();
  }, [on, reduceMotion, value]);
  return <View style={[local.bar, { backgroundColor: track }]}>
    <Animated.View style={{ height: '100%', backgroundColor: fill, borderRadius: 2, width: value.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
  </View>;
}

/** Fades content in once, over 250 ms, when it first appears. */
export function FadeIn({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { reduceMotion } = useTheme();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => { if (!reduceMotion) Animated.timing(opacity, { toValue: 1, duration: t.motion.expand, useNativeDriver: true }).start(); }, [opacity, reduceMotion]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}

/** The small "New" tag that marks what changed in a briefing. */
export function NewTag() {
  const { c } = useTheme();
  return <View style={[local.tag, { borderColor: c.ink }]}><Txt variant="label">New</Txt></View>;
}

const local = StyleSheet.create({
  state: { flexDirection: 'row', alignItems: 'center', gap: t.space.s2 },
  stateIcon: { alignItems: 'center', justifyContent: 'center' },
  clockDisc: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bars: { flexDirection: 'row', gap: t.space.s2, width: 200, alignSelf: 'flex-end' },
  bar: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  tag: { borderWidth: 1.5, borderRadius: t.radius.tail, paddingHorizontal: t.space.s1, paddingVertical: 1 },
});

const makeStyles = (c: Palette) => StyleSheet.create({
  card: { borderWidth: 1, borderColor: c.line, borderRadius: t.radius.m, padding: t.space.s4, gap: t.space.s3, backgroundColor: c.surface },
  cardQuiet: { backgroundColor: c.surface2, borderColor: c.surface2 },
  cardDanger: { backgroundColor: c.redTint, borderColor: "#5A1418" },
  button: { flexDirection: 'row', gap: t.space.s2, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.m, paddingHorizontal: t.space.s4, borderWidth: 1 },
  primary: { backgroundColor: c.ink, borderColor: c.ink },
  outline: { backgroundColor: 'transparent', borderColor: c.lineStrong },
  danger: { backgroundColor: c.redFill, borderColor: c.redFill },
  quiet: { backgroundColor: c.surface2, borderColor: c.surface2 },
});
