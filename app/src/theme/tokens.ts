export const tokens = {
  color: {
    background: '#F4F5EF', surface: '#FFFFFF', ink: '#162F32', muted: '#475D5F',
    primary: '#175E52', primarySoft: '#E0EEE6', border: '#BBCBC4',
    warning: '#75521C', warningSoft: '#FFF1D4', white: '#FFFFFF',
    navy: '#122F35', ownMessage: '#E3EFE8', peerMessage: '#FFFFFF',
    mapLand: '#E7E9DC', mapWater: '#B8D8DD', mapRoad: '#A3AEA2', mapBuilding: '#CDD2C5',
    // Basemap palette for the offline Protomaps style (src/map/mapStyle.ts):
    // a calm, muted street-map look that still reads as a real map.
    mapEarth: '#EDEFE2', mapForest: '#C7DDB4', mapGrass: '#DCE7C6', mapScrub: '#E4E9CF',
    mapPark: '#BFDDB0', mapUrban: '#E6E3D8', mapBuildingLine: '#BDB9AA',
    mapCasing: '#B5B1A2', mapMotorway: '#E59A6B', mapTrunk: '#EDBE7C', mapPrimary: '#F4D98E',
    mapSecondary: '#F8E6A8', mapTertiary: '#F9EDBE', mapStreet: '#FFFFFF', mapPath: '#EFEDE4',
    mapBoundary: '#B9B4A4',
    pin: '#334B87', position: '#175E52', disabled: '#DDE3DE',
  },
  font: { small: 14, body: 17, label: 18, subtitle: 23, title: 34, status: 31 },
  weight: { normal: '400', medium: '600', bold: '700' },
  space: { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 },
  radius: { sm: 10, md: 18, lg: 26, pill: 100 },
  target: 52,
  contentWidth: 680,
} as const;
