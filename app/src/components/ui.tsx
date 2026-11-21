import { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, TextProps, View } from 'react-native';
import { tokens as t } from '../theme/tokens';

export function Body({ children, style, ...props }: TextProps) {
  return <Text {...props} style={[styles.body, style]}>{children}</Text>;
}
export function Heading({ children }: PropsWithChildren) { return <Text accessibilityRole="header" style={styles.heading}>{children}</Text>; }
export function Card({ children }: PropsWithChildren) { return <View style={styles.card}>{children}</View>; }
export function Notice({ children }: PropsWithChildren) { return <View style={styles.notice}><Body>{children}</Body></View>; }
export function Button({ title, onPress, disabled = false, secondary = false, selected = false, label }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; selected?: boolean; label?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, selected && styles.selected, disabled && styles.disabled, pressed && { opacity: 0.8 }]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText, disabled && { color: t.color.muted }]}>{title}</Text>
  </Pressable>;
}

export const styles = StyleSheet.create({
  body: { color: t.color.ink, fontSize: t.font.body, lineHeight: 26 },
  small: { color: t.color.muted, fontSize: t.font.small, lineHeight: 21 },
  heading: { color: t.color.ink, fontSize: t.font.title, fontWeight: t.weight.bold, marginBottom: t.space.xs },
  subheading: { color: t.color.ink, fontSize: t.font.subtitle, fontWeight: t.weight.bold },
  card: { backgroundColor: t.color.surface, borderRadius: t.radius.md, padding: t.space.md, borderWidth: 1, borderColor: t.color.border, gap: t.space.sm },
  notice: { backgroundColor: t.color.primarySoft, padding: t.space.md, borderRadius: t.radius.sm, gap: t.space.xs },
  button: { minHeight: t.target, justifyContent: 'center', alignItems: 'center', backgroundColor: t.color.primary, borderRadius: t.radius.sm, paddingHorizontal: t.space.md, paddingVertical: t.space.md },
  buttonText: { color: t.color.white, fontSize: t.font.body, fontWeight: t.weight.bold, textAlign: 'center' },
  secondary: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border },
  secondaryText: { color: t.color.ink },
  selected: { borderColor: t.color.primary, borderWidth: 2, backgroundColor: t.color.primarySoft },
  disabled: { backgroundColor: t.color.disabled },
  stack: { gap: t.space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' },
  input: { minHeight: t.target, borderWidth: 1, borderColor: t.color.muted, borderRadius: t.radius.sm, color: t.color.ink, backgroundColor: t.color.surface, padding: t.space.md, fontSize: t.font.body, textAlignVertical: 'top' },
});
