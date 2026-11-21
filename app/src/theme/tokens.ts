/**
 * Design tokens from design/system.html and design/PRINCIPLES.md.
 * Dark is the default (black pixels are off on OLED); the light palette is for
 * bright sun and follows the phone's appearance setting.
 * Colour means state, never decoration: red = danger, yellow = waiting
 * (icons and fills only, never text), green = done.
 */
export interface Palette {
  ink: string; ink2: string; surface: string; surface2: string; line: string; lineStrong: string;
  onInk: string; onFill: string; onYellow: string;
  red: string; redFill: string; redTint: string; yellow: string; green: string; greenTint: string;
  scrim: string;
}

export const dark: Palette = {
  ink: '#FFFFFF', ink2: '#9A9A9F', surface: '#000000', surface2: '#1C1C1E', line: '#2C2C2E', lineStrong: '#8E8E93',
  onInk: '#000000', onFill: '#FFFFFF', onYellow: '#000000',
  red: '#FF6159', redFill: '#D7000F', redTint: '#3A0A0C', yellow: '#FFD100', green: '#30D158', greenTint: '#0B2A18',
  scrim: 'rgba(0,0,0,0.6)',
};

export const light: Palette = {
  ink: '#000000', ink2: '#6B6B6B', surface: '#FFFFFF', surface2: '#F2F2F3', line: '#D1D1D6', lineStrong: '#6B6B6B',
  onInk: '#FFFFFF', onFill: '#FFFFFF', onYellow: '#000000',
  red: '#D7000F', redFill: '#D7000F', redTint: '#FDE7E8', yellow: '#9A5B00', green: '#007A3D', greenTint: '#E3F4EA',
  scrim: 'rgba(0,0,0,0.4)',
};

/** Atkinson Hyperlegible Next, bundled so it works offline. One family, two weights. */
export const fonts = { regular: 'AtkinsonHyperlegibleNext_400Regular', semibold: 'AtkinsonHyperlegibleNext_600SemiBold' } as const;

/** Eight text styles, nothing in between. Sizes in points, each scales with the phone's text size. */
export const type = {
  display: { fontSize: 44, lineHeight: 46, weight: 'semibold', letterSpacing: -0.44 },
  title1: { fontSize: 28, lineHeight: 32, weight: 'semibold', letterSpacing: 0 },
  title2: { fontSize: 22, lineHeight: 28, weight: 'semibold', letterSpacing: 0 },
  body: { fontSize: 17, lineHeight: 24, weight: 'regular', letterSpacing: 0 },
  bodyStrong: { fontSize: 17, lineHeight: 24, weight: 'semibold', letterSpacing: 0 },
  callout: { fontSize: 15, lineHeight: 20, weight: 'semibold', letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 18, weight: 'regular', letterSpacing: 0 },
  label: { fontSize: 13, lineHeight: 16, weight: 'semibold', letterSpacing: 0 },
} as const;
export type TypeStyle = keyof typeof type;

export const tokens = {
  /** 4 px steps, 20 px outer margins. */
  space: { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s12: 48 },
  /** Small, friendly corners. No pills. */
  radius: { tail: 4, s: 8, m: 12, l: 16 },
  /** 44 pt to tap; main actions are 48 pt high. */
  target: 44,
  action: 48,
  motion: { press: 150, expand: 250, sheet: 320 },
  contentWidth: 680,
  color: {
    // Basemap palette for the offline Protomaps style (src/map/mapStyle.ts):
    // a calm, muted street-map look that still reads as a real map.
    mapLand: '#E7E9DC', mapWater: '#B8D8DD', mapRoad: '#A3AEA2', mapBuilding: '#CDD2C5',
    mapEarth: '#EDEFE2', mapForest: '#C7DDB4', mapGrass: '#DCE7C6', mapScrub: '#E4E9CF',
    mapPark: '#BFDDB0', mapUrban: '#E6E3D8', mapBuildingLine: '#BDB9AA',
    mapCasing: '#B5B1A2', mapMotorway: '#E59A6B', mapTrunk: '#EDBE7C', mapPrimary: '#F4D98E',
    mapSecondary: '#F8E6A8', mapTertiary: '#F9EDBE', mapStreet: '#FFFFFF', mapPath: '#EFEDE4',
    mapBoundary: '#B9B4A4',
    pin: '#D7000F', position: '#0A84FF', ink: '#000000', white: '#FFFFFF', border: '#2C2C2E',
  },
} as const;
