import { findLocLine, formatLocLine, LOC_LINE_RE_TS, parseLocLine } from '../src/locate/locLine';

/**
 * Extra loc: line cases. The grammar (LOC_LINE_RE_TS) is kept in lockstep with
 * the hub's LOC_LINE_RE in hub/responder.py — scripts/check_loc_line_compat.py
 * and hub/test_contract_phone.py fail CI on drift.
 */
describe('loc: grammar matches the hub (decimal degrees only)', () => {
  it.each([
    'loc: 51.50070,-0.12460',
    'LOC:  51.50 , -0.12 ',
    'loc:51.5,-0.1',
    'loc: -90,180',
    'loc: 90,180',
  ])('accepts %j', (line) => {
    expect(parseLocLine(line)).not.toBeNull();
  });

  it.each([
    'loc: 0x33,0', // hex
    'loc: 5e1,0', // scientific
    'loc: +51.5,-0.1', // plus sign
    'loc: NaN,0',
    'loc: Infinity,0',
    'loc: 51.5,-0.1junk',
    'myloc: 1,2',
    'loc: 1',
    'hello',
    '',
  ])('rejects %j', (line) => {
    expect(parseLocLine(line)).toBeNull();
  });

  it('rejects out-of-range coordinates even though the grammar matches', () => {
    expect(parseLocLine('loc: 90.00001,-0.1')).toBeNull();
    expect(parseLocLine('loc: 51.5,-180.00001')).toBeNull();
    expect(parseLocLine('loc: 90,180')).toEqual({ lat: 90, lon: 180 });
    expect(parseLocLine('loc: -90,-180')).toEqual({ lat: -90, lon: -180 });
  });

  it('accepts CRLF line endings', () => {
    expect(parseLocLine('loc: 51.5,-0.1\r')).not.toBeNull();
  });
});

describe('findLocLine on multi-line messages', () => {
  it('first loc line wins, and an invalid second line is never used', () => {
    expect(findLocLine('q\nloc: 1,1\nloc: 2,2')).toEqual({ lat: 1, lon: 1 });
    expect(findLocLine('q\nloc: 51.5,-0.1\nloc: 91,0')).toEqual({ lat: 51.5, lon: -0.1 });
  });

  it('"loc:" mid-sentence is not a loc line', () => {
    expect(findLocLine('the loc: 51.5,-0.1 is here')).toBeNull();
  });

  it('round-trips formatLocLine output', () => {
    const line = formatLocLine({ lat: 51.500705, lon: -0.124604 });
    const parsed = parseLocLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.lat).toBeCloseTo(51.5007, 4);
    expect(parsed!.lon).toBeCloseTo(-0.1246, 4);
  });
});

describe('LOC_LINE_RE_TS is exported for the parity checker', () => {
  it('is a case-insensitive anchored regex', () => {
    expect(LOC_LINE_RE_TS.ignoreCase).toBe(true);
    expect(LOC_LINE_RE_TS.source.startsWith('^')).toBe(true);
    expect(LOC_LINE_RE_TS.source.endsWith('$')).toBe(true);
  });
});
