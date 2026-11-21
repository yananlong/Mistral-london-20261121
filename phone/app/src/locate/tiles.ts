import type { LatLon } from './locLine';

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Demo region: Greater London (BLUEPRINT_1.md decisions: "Map region: London"). */
export const LONDON_REGION: Region = {
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

/**
 * Path template for the locally bundled tiles inside the app bundle.
 * react-native-maps' LocalTile resolves it against the bundle; the actual
 * tile download lands with the map feature in a later PR.
 */
export const TILE_PATH_TEMPLATE = 'london/{z}/{x}/{y}.png';

/** Bounding box of the London tile download, as a stand-in for querying the on-device tile store. */
const LONDON_TILE_BOUNDS = {
  minLat: 51.28,
  maxLat: 51.72,
  minLon: -0.52,
  maxLon: 0.34,
};

/** True when the bundled download covers this point; false means "map not downloaded for this area". */
export function bundledTilesCover(point: LatLon): boolean {
  return (
    point.lat >= LONDON_TILE_BOUNDS.minLat &&
    point.lat <= LONDON_TILE_BOUNDS.maxLat &&
    point.lon >= LONDON_TILE_BOUNDS.minLon &&
    point.lon <= LONDON_TILE_BOUNDS.maxLon
  );
}
