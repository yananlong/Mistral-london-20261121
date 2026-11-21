import type { LatLon } from './locLine';

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * Offline map tiles: standard OpenStreetMap raster tiles for the London demo
 * region, fetched once by `scripts/fetch_map_tiles.py` into
 * `phone/app/maptiles/london/{z}/{x}/{y}.jpg` and bundled with the app
 * (add `maptiles/` to the Xcode target resources on iOS, copy it into
 * `android/app/src/main/assets/` on Android — see ../TESTFLIGHT.md).
 *
 * Zoom pyramid (see maptiles/manifest.json):
 *   z11-z12  greater London (the full demo bounds)
 *   z13-z15  central London (+/-0.05 deg around the demo point)
 *   z16      the demo core (+/-0.015 deg)
 *
 * Map data (c) OpenStreetMap contributors (ODbL); the map shows the
 * attribution overlay (ATTRIBUTION below) as the licence requires.
 */

/** Demo point: central London, the BLUEPRINT_1.md example coordinates. */
export const DEMO_CENTER: LatLon = { lat: 51.5074, lon: -0.1278 };

/** Initial map view: the demo area at street-map detail, not all of London. */
export const LONDON_REGION: Region = {
  latitude: DEMO_CENTER.lat,
  longitude: DEMO_CENTER.lon,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

/** Template LocalTile resolves against the app bundle root. */
export const TILE_PATH_TEMPLATE = 'maptiles/london/{z}/{x}/{y}.jpg';

/** Zoom levels that have bundled tiles; the map clamps to these. */
export const MIN_ZOOM = 11;
export const MAX_ZOOM = 16;

/** Shown on the map, as OSM's licence requires. */
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors';

/** Bounding box of the full London tile download (z11-z12), in [minLon, minLat, maxLon, maxLat]. */
export const LONDON_TILE_BOUNDS = {
  minLat: 51.28,
  maxLat: 51.72,
  minLon: -0.52,
  maxLon: 0.34,
};

export type Bounds = [minLon: number, minLat: number, maxLon: number, maxLat: number];

// --- Web-Mercator tile math (mirrors scripts/fetch_map_tiles.py) ------------

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export interface TileRange {
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  count: number;
}

/** Inclusive tile range covering a lon/lat bounding box at zoom z. */
export function tilesForBounds(bounds: Bounds, z: number): TileRange {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const x0 = lonToTileX(minLon, z);
  const x1 = lonToTileX(maxLon, z);
  const y0 = latToTileY(maxLat, z);
  const y1 = latToTileY(minLat, z);
  return { z, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** Approximate latitude span (degrees) of the screen at zoom z around lat. */
export function deltaForZoom(z: number, lat: number): number {
  return (360 / 2 ** z) * Math.cos((lat * Math.PI) / 180);
}

/** True when the bundled download covers this point; false means "map not downloaded for this area". */
export function bundledTilesCover(point: LatLon): boolean {
  return (
    point.lat >= LONDON_TILE_BOUNDS.minLat &&
    point.lat <= LONDON_TILE_BOUNDS.maxLat &&
    point.lon >= LONDON_TILE_BOUNDS.minLon &&
    point.lon <= LONDON_TILE_BOUNDS.maxLon
  );
}
