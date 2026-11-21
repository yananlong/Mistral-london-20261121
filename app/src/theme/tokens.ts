/**
 * Design tokens, copied from design/system.html and design/components.html
 * (the source of truth). Dark is the default: pure black saves battery on
 * OLED screens (design/PRINCIPLES.md §6).
 *
 * Colour means state, never decoration (PRINCIPLES §4):
 *   red    = danger / SOS only
 *   yellow = waiting, not known yet, not sent yet (icons only, never text)
 *   green  = done, delivered, answered
 * Every state also has its own icon and word, so colour is never alone.
 */
export const tokens = {
  color: {
    ink: '#FFFFFF',        // text and primary actions, 21:1 on surface
    ink2: '#9A9A9F',       // secondary text: sources, times, hints
    onInk: '#000000',      // text on white buttons
    surface: '#000000',
    surface2: '#1C1C1E',   // answers, quiet panels, anything raised
    line: '#2C2C2E',       // 1 px outlines
    lineStrong: '#8E8E93',
    red: '#FF6159',        // danger icons and text
    redFill: '#D7000F',    // the SOS button, always
    onFill: '#FFFFFF',
    redTint: '#3A0A0C',    // the SOS bar
    redLine: '#5A1A1C',
    yellow: '#FFD100',
    green: '#30D158',
    scrim: 'rgba(0, 0, 0, 0.7)',

    // Offline basemap (src/map/mapStyle.ts): a quiet dark street map, so the
    // numbered white pins are what stands out.
    mapEarth: '#0B0B0C', mapForest: '#12201A', mapGrass: '#142018', mapScrub: '#151C14',
    mapPark: '#13231A', mapUrban: '#111113', mapWater: '#0F2530', mapBuilding: '#1A1A1D',
    mapBuildingLine: '#26262A', mapCasing: '#000000', mapMotorway: '#5C5C63', mapTrunk: '#4D4D53',
    mapPrimary: '#424248', mapSecondary: '#38383D', mapTertiary: '#313136', mapStreet: '#2A2A2E',
    mapPath: '#232327', mapBoundary: '#3A3A40',
  },
  /** Atkinson Hyperlegible Next, bundled so it works offline. Two weights only. */
  font: {
    regular: 'AtkinsonHyperlegibleNext_400Regular',
    semibold: 'AtkinsonHyperlegibleNext_600SemiBold',
  },
  /** Type scale (PRINCIPLES §3): size / line height. */
  type: {
    display: { fontSize: 44, lineHeight: 46, letterSpacing: -0.44 },
    title1: { fontSize: 28, lineHeight: 32 },
    title2: { fontSize: 22, lineHeight: 28 },
    body: { fontSize: 17, lineHeight: 24 },
    callout: { fontSize: 15, lineHeight: 20 },
    caption: { fontSize: 13, lineHeight: 18 },
    label: { fontSize: 13, lineHeight: 16 },
  },
  /** Spacing in steps of 4; 20 px outer margins. */
  space: { xxs: 4, xs: 8, sm: 12, md: 16, gutter: 20, lg: 24, xl: 32 },
  /** Friendly, not sharp: tags 4, small things 8, cards and buttons 12, sheets 16. No pills. */
  radius: { xs: 4, s: 8, m: 12, l: 16 },
  /** Tap targets: buttons 48, small buttons 44 (Apple minimum). */
  target: 48,
  targetSmall: 44,
  contentWidth: 520,
  motion: { press: 150, change: 200, arrive: 220, sheet: 300 },
} as const;

export type TypeStyle = keyof typeof tokens.type;
