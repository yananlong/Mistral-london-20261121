import {
  DEMO_CENTER,
  LONDON_TILE_BOUNDS,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_PATH_TEMPLATE,
  bundledTilesCover,
  deltaForZoom,
  latToTileY,
  lonToTileX,
  tilesForBounds,
} from '../src/locate/tiles';

describe('Web-Mercator tile math matches scripts/fetch_map_tiles.py', () => {
  it('z0 maps the whole world to tile 0,0', () => {
    expect(lonToTileX(-180, 0)).toBe(0);
    expect(lonToTileX(0, 0)).toBe(0);
    expect(latToTileY(0, 0)).toBe(0);
    expect(latToTileY(85, 0)).toBe(0);
  });

  it('maps the demo center to the known z12 tile', () => {
    // Verified against the fetch script and the downloaded files.
    expect(lonToTileX(DEMO_CENTER.lon, 12)).toBe(2046);
    expect(latToTileY(DEMO_CENTER.lat, 12)).toBe(1362);
  });

  it('doubles tile indices per zoom level', () => {
    expect(lonToTileX(DEMO_CENTER.lon, 13)).toBe(lonToTileX(DEMO_CENTER.lon, 12) * 2 + 1);
    expect(latToTileY(DEMO_CENTER.lat, 15)).toBeGreaterThanOrEqual(latToTileY(DEMO_CENTER.lat, 12) * 8);
  });
});

describe('tilesForBounds covers the full demo bounds at z11', () => {
  const range = tilesForBounds(
    [LONDON_TILE_BOUNDS.minLon, LONDON_TILE_BOUNDS.minLat, LONDON_TILE_BOUNDS.maxLon, LONDON_TILE_BOUNDS.maxLat],
    11,
  );
  it('returns the expected inclusive range and count', () => {
    expect(range).toEqual({ z: 11, x0: 1021, x1: 1025, y0: 679, y1: 683, count: 25 });
  });
  it('count matches (x1-x0+1)*(y1-y0+1)', () => {
    expect(range.count).toBe((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1));
  });
});

describe('zoom pyramid constants', () => {
  it('has a sane zoom range and a LocalTile template', () => {
    expect(MIN_ZOOM).toBeLessThan(MAX_ZOOM);
    expect(TILE_PATH_TEMPLATE).toContain('{z}');
    expect(TILE_PATH_TEMPLATE).toContain('{x}');
    expect(TILE_PATH_TEMPLATE).toContain('{y}');
    expect(TILE_PATH_TEMPLATE).toMatch(/maptiles\/london\/.*\.jpg$/);
  });

  it('deltaForZoom shrinks with zoom and is small enough at MAX_ZOOM to be street level', () => {
    const z11 = deltaForZoom(11, DEMO_CENTER.lat);
    const z16 = deltaForZoom(16, DEMO_CENTER.lat);
    expect(z16).toBeLessThan(z11);
    expect(z11).toBeCloseTo(0.109, 2);
    expect(z16).toBeLessThan(0.01);
  });
});

describe('bundledTilesCover', () => {
  it('covers the demo center and rejects points outside the download', () => {
    expect(bundledTilesCover(DEMO_CENTER)).toBe(true);
    expect(bundledTilesCover({ lat: 51.9, lon: -0.1 })).toBe(false);
    expect(bundledTilesCover({ lat: 0, lon: 0 })).toBe(false);
  });
});
