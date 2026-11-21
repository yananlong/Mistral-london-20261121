/**
 * Design tokens (PLAN.md section 6): calm palette rather than an alarming one,
 * big tap targets, high contrast in sunlight, scalable text.
 */

export const colors = {
  background: '#0D1F2B',
  surface: '#15303F',
  surfaceRaised: '#1C3D4E',
  border: '#2A4E61',
  text: '#F3F8FB',
  textMuted: '#A9C6D3',
  accent: '#8AD8C6',
  accentText: '#062730',
  warning: '#F2C66D',
  danger: '#F2927F',
  statusSent: '#8AD8C6',
  statusReceived: '#7FB8F0',
  statusAnswered: '#8AD8C6',
  statusUnreachable: '#F2C66D',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const layout = {
  /** Every tappable control is at least this tall (PLAN.md: big tap targets). */
  minTapTarget: 56,
  radiusSm: 8,
  radiusMd: 14,
  radiusLg: 22,
  borderWidth: 1,
  screenPadding: spacing.lg,
} as const;

export const fontSize = {
  caption: 14,
  body: 17,
  title: 22,
  heading: 28,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '600',
  bold: '700',
} as const;

/** iOS text sizes above this scale stop growing, so layouts do not break. */
export const MAX_TEXT_SCALE = 1.6;

/** Scale a font size by the system text scale, clamped to [1, MAX_TEXT_SCALE]. */
export function scaledFontSize(base: number, textScale = 1): number {
  const clamped = Math.min(Math.max(textScale, 1), MAX_TEXT_SCALE);
  return Math.round(base * clamped);
}
