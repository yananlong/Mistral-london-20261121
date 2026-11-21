/**
 * The `loc:` line from BLUEPRINT_1.md's message format:
 *
 *   loc: 51.50070,-0.12460
 *
 * The line is optional on a question, and it is the whole body of a location
 * share. Five decimal places, comma with no space, latitude first.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export const LOC_PREFIX = 'loc:';

/**
 * The loc: line grammar, kept in lockstep with the hub's LOC_LINE_RE in
 * hub/responder.py (decimal degrees only; scripts/check_loc_line_compat.py
 * fails CI on drift). Case-insensitive like the hub.
 */
export const LOC_LINE_RE_TS = /^\s*loc:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i;

export function formatLocLine(point: LatLon): string {
  return `${LOC_PREFIX} ${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
}

/** Parse one line as a loc: line. Returns null for anything else. */
export function parseLocLine(line: string): LatLon | null {
  const m = LOC_LINE_RE_TS.exec(line);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Find the first loc: line anywhere in a (possibly multi-line) message. */
export function findLocLine(text: string): LatLon | null {
  for (const line of text.split('\n')) {
    const parsed = parseLocLine(line);
    if (parsed) return parsed;
  }
  return null;
}
