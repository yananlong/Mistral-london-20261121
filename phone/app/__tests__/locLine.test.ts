import { findLocLine, formatLocLine, parseLocLine } from '../src/locate/locLine';

describe('formatLocLine matches the BLUEPRINT_1.md message format exactly', () => {
  it('formats the blueprint example', () => {
    expect(formatLocLine({ lat: 51.5007, lon: -0.1246 })).toBe('loc: 51.50070,-0.12460');
  });

  it('always uses five decimal places and no space after the comma', () => {
    expect(formatLocLine({ lat: 0, lon: 0 })).toBe('loc: 0.00000,0.00000');
    expect(formatLocLine({ lat: -33.8688, lon: 151.2093 })).toBe('loc: -33.86880,151.20930');
  });

  it('never emits a negative zero', () => {
    expect(formatLocLine({ lat: -0, lon: -0 })).toBe('loc: 0.00000,0.00000');
    expect(formatLocLine({ lat: -0.0000001, lon: -0.0000001 })).toBe('loc: 0.00000,0.00000');
    expect(formatLocLine({ lat: -0.000009, lon: 0.000009 })).toBe('loc: -0.00001,0.00001');
  });
});

describe('parseLocLine round trip', () => {
  it.each([
    { lat: 51.5007, lon: -0.1246 },
    { lat: 0, lon: 0 },
    { lat: -33.8688, lon: 151.2093 },
    { lat: 90, lon: 180 },
    { lat: -90, lon: -180 },
  ])('round-trips %j within 1e-5', (point) => {
    const parsed = parseLocLine(formatLocLine(point));
    expect(parsed).not.toBeNull();
    expect(parsed!.lat).toBeCloseTo(point.lat, 5);
    expect(parsed!.lon).toBeCloseTo(point.lon, 5);
  });

  it('parses the loc: line out of a multi-line question', () => {
    const message = 'How do I make river water safe to drink?\nloc: 51.50070,-0.12460';
    expect(findLocLine(message)).toEqual({ lat: 51.5007, lon: -0.1246 });
  });

  it('returns null when there is no loc: line', () => {
    expect(findLocLine('How do I stop heavy bleeding?')).toBeNull();
  });
});

describe('parseLocLine rejects malformed lines', () => {
  it.each([
    'hello',
    'loc:',
    'loc: 1',
    'loc: ,',
    'loc: abc,def',
    'loc: 91,0',
    'loc: 0,181',
    'loc: 51.5, -0.1, extra',
    'location: 51.5,-0.1',
    // Number() would accept these; the strict regex must not.
    'loc: 0x33,0',
    'loc: 5e1,1e1',
    'loc: Infinity,0',
    'loc: .5,1',
    'loc: 1.,1',
    'loc: +1,1',
    'loc: NaN,0',
    'loc: 1,0x10',
  ])('rejects %j', (line) => {
    expect(parseLocLine(line)).toBeNull();
  });
});
