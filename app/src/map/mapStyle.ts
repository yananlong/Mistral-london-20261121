import { tokens as t } from '../theme/tokens';

/**
 * The offline basemap style for MapCanvas, drawn from the Protomaps vector
 * layers inside london.pmtiles (source layers verified against the PMTiles
 * metadata: earth, landcover, landuse, water, boundaries, buildings, roads,
 * places, pois; roads/landcover/landuse/water carry a `kind` attribute).
 *
 * It stays fully offline: no remote tiles, sprites, fonts or glyphs, so there
 * are no text label layers (street/place names would need bundled glyph PBFs
 * — a deliberate follow-up). Pins are native markers with device text, so the
 * map itself needs no fonts. What makes it read as a real map instead of a
 * schematic: land cover and land use fills, water bodies and waterways,
 * building footprints with outlines, admin boundaries, and a road hierarchy
 * (motorway → street) with casing and zoom-scaled widths.
 */

export const MAP_MIN_ZOOM = 10;
export const MAP_MAX_ZOOM = 18;
export const INITIAL_ZOOM = 14;
/** Demo position fallback: Westminster (matches the app's demo coordinates). */
export const LONDON_CENTER = { lat: 51.5007, lon: -0.1246 };

export interface StyleLayer {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
  filter?: unknown[];
  minzoom?: number;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

export interface MapStyleJSON {
  version: 8;
  name: string;
  sources: Record<string, unknown>;
  layers: StyleLayer[];
}

const SOURCE = 'london';
const TRANSPARENT = 'rgba(0,0,0,0)';

/** Zoom-interpolated line width. */
function width(minzoom: number, wAtMin: number, wAtMax: number): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], minzoom, wAtMin, 19, wAtMax];
}

function fillLayer(id: string, sourceLayer: string, color: unknown, minzoom: number, filter?: unknown[]): StyleLayer {
  const layer: StyleLayer = {
    id,
    type: 'fill',
    source: SOURCE,
    'source-layer': sourceLayer,
    minzoom,
    paint: { 'fill-color': color },
  };
  if (filter) layer.filter = filter;
  return layer;
}

function lineLayer(
  id: string,
  sourceLayer: string,
  color: string,
  lineWidth: unknown[],
  minzoom: number,
  filter?: unknown[],
  extraPaint: Record<string, unknown> = {},
): StyleLayer {
  const layer: StyleLayer = {
    id,
    type: 'line',
    source: SOURCE,
    'source-layer': sourceLayer,
    minzoom,
    paint: { 'line-color': color, 'line-width': lineWidth, ...extraPaint },
  };
  if (filter) layer.filter = filter;
  return layer;
}

/** Road classes from biggest to smallest; smaller roads draw on top. */
const ROAD_CLASSES: { kinds: string[]; color: string; minzoom: number; wAtMin: number; wAtMax: number }[] = [
  { kinds: ['motorway'], color: t.color.mapMotorway, minzoom: 4, wAtMin: 2.2, wAtMax: 8 },
  { kinds: ['trunk'], color: t.color.mapTrunk, minzoom: 6, wAtMin: 2, wAtMax: 7 },
  { kinds: ['primary'], color: t.color.mapPrimary, minzoom: 7, wAtMin: 1.8, wAtMax: 6 },
  { kinds: ['secondary'], color: t.color.mapSecondary, minzoom: 8, wAtMin: 1.6, wAtMax: 5 },
  { kinds: ['tertiary', 'unclassified'], color: t.color.mapTertiary, minzoom: 9, wAtMin: 1.4, wAtMax: 4.5 },
  { kinds: ['residential', 'service', 'street'], color: t.color.mapStreet, minzoom: 11, wAtMin: 1.1, wAtMax: 3.2 },
  { kinds: ['track', 'path', 'pedestrian', 'steps'], color: t.color.mapPath, minzoom: 13, wAtMin: 0.7, wAtMax: 1.6 },
];

const VEHICULAR_KINDS = ROAD_CLASSES.slice(0, 6).flatMap((rc) => rc.kinds);

/** Build the map style for a local pmtiles URI (e.g. file://…/london.pmtiles). */
export function buildMapStyle(uri: string): MapStyleJSON {
  const c = t.color;
  const layers: StyleLayer[] = [
    { id: 'background', type: 'background', paint: { 'background-color': c.mapEarth } },
    fillLayer('earth', 'earth', c.mapEarth, 0),
    // Land cover: woods, grass, scrub, fields (source-layer `landcover`).
    fillLayer('landcover', 'landcover', [
      'match', ['get', 'kind'],
      'wood', c.mapForest,
      'grass', c.mapGrass,
      ['scrub', 'crop', 'sand'], c.mapScrub,
      TRANSPARENT,
    ], 0),
    // Land use: parks and green space, urban blocks (source-layer `landuse`).
    fillLayer('landuse', 'landuse', [
      'match', ['get', 'kind'],
      ['park', 'nature_reserve', 'cemetery', 'golf_course'], c.mapPark,
      ['residential', 'commercial', 'industrial', 'retail'], c.mapUrban,
      TRANSPARENT,
    ], 0),
    // Water: polygons (oceans, lakes, the Thames) and waterway lines.
    fillLayer('water', 'water', c.mapWater, 0, ['==', ['geometry-type'], 'Polygon']),
    lineLayer('waterway', 'water', c.mapWater, width(8, 0.5, 2.5), 8, ['==', ['geometry-type'], 'LineString']),
    // Admin boundaries, subtle.
    lineLayer('boundaries', 'boundaries', c.mapBoundary, width(5, 0.6, 1.2), 5, undefined, { 'line-opacity': 0.6 }),
    // Building footprints with a thin outline.
    fillLayer('buildings', 'buildings', c.mapBuilding, 13),
    lineLayer('building-outline', 'buildings', c.mapBuildingLine, width(14, 0.5, 0.8), 14),
    // Road casing below all vehicular road fills.
    lineLayer(
      'road-casing', 'roads', c.mapCasing, width(5, 2.8, 9.5), 5,
      ['in', ['get', 'kind'], ['literal', VEHICULAR_KINDS]],
    ),
    // Road hierarchy, biggest class first.
    ...ROAD_CLASSES.map((rc) =>
      lineLayer(
        `road-${rc.kinds[0]}`, 'roads', rc.color, width(rc.minzoom, rc.wAtMin, rc.wAtMax), rc.minzoom,
        ['in', ['get', 'kind'], ['literal', rc.kinds]],
      ),
    ),
  ];
  return {
    version: 8,
    name: 'mesh-help-london-offline',
    sources: {
      [SOURCE]: {
        type: 'vector',
        url: `pmtiles://${uri}`,
        attribution: '© OpenStreetMap contributors · Protomaps',
      },
    },
    layers,
  };
}
