import { buildMapStyle, INITIAL_ZOOM, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '../src/map/mapStyle';
import { tokens as t } from '../src/theme/tokens';

// Source layers that exist in the Protomaps basemap PMTiles (verified against
// the build metadata: earth, landcover, landuse, water, boundaries, buildings,
// roads, places, pois).
const KNOWN_SOURCE_LAYERS = ['earth', 'landcover', 'landuse', 'water', 'boundaries', 'buildings', 'roads', 'places', 'pois'];

describe('buildMapStyle', () => {
  const style = buildMapStyle('file:///Documents/london.pmtiles');
  const ids = style.layers.map((layer) => layer.id);

  it('is a valid offline vector style over the pmtiles source, with OSM attribution', () => {
    expect(style.version).toBe(8);
    expect(style.sources.london).toMatchObject({ type: 'vector' });
    const source = style.sources.london as { url: string; attribution: string };
    expect(source.url).toBe('pmtiles://file:///Documents/london.pmtiles');
    expect(source.attribution).toContain('OpenStreetMap');
    // Fully offline: no glyphs/sprite URLs anywhere.
    expect(JSON.stringify(style)).not.toMatch(/https?:\/\//);
  });

  it('has unique layer ids and only uses source layers present in the PMTiles', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const layer of style.layers) {
      if (layer.source) {
        expect(layer.source).toBe('london');
        expect(KNOWN_SOURCE_LAYERS).toContain(layer['source-layer']);
      }
    }
  });

  it('starts with a background and draws land, green space, water and buildings', () => {
    expect(style.layers[0]).toMatchObject({ id: 'background', type: 'background', paint: { 'background-color': t.color.mapEarth } });
    for (const id of ['earth', 'landcover', 'landuse', 'water', 'waterway', 'buildings']) {
      expect(ids).toContain(id);
    }
  });

  it('draws a road hierarchy with casing below the fills', () => {
    expect(ids).toEqual(expect.arrayContaining(['road-casing', 'road-motorway', 'road-trunk', 'road-primary', 'road-secondary', 'road-tertiary', 'road-residential', 'road-track']));
    expect(ids.indexOf('road-casing')).toBeLessThan(ids.indexOf('road-motorway'));
    // Bigger roads are wider at every zoom: motorway beats a residential street.
    const motorway = style.layers.find((layer) => layer.id === 'road-motorway')!;
    const residential = style.layers.find((layer) => layer.id === 'road-residential')!;
    expect(motorway.paint?.['line-color']).toBe(t.color.mapMotorway);
    expect(residential.paint?.['line-color']).toBe(t.color.mapStreet);
    // Widths interpolate with zoom.
    expect(motorway.paint?.['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 4, 2.2, 19, 8]);
  });

  it('has a sane zoom range around the initial zoom', () => {
    expect(MAP_MIN_ZOOM).toBeLessThan(INITIAL_ZOOM);
    expect(INITIAL_ZOOM).toBeLessThan(MAP_MAX_ZOOM);
  });
});
