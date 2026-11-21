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

/** One coordinate component: plain decimal only, no hex, exponent or sign tricks. */
const LOC_COMPONENT = /^-?\d+(\.\d+)?$/;

function formatComponent(value: number): string {
  const fixed = value.toFixed(5);
  // toFixed keeps the sign of a tiny negative: -0.0000001 formats as "-0.00000".
  return fixed === '-0.00000' ? '0.00000' : fixed;
}

export function formatLocLine(point: LatLon): string {
  return `${LOC_PREFIX} ${formatComponent(point.lat)},${formatComponent(point.lon)}`;
}

/** Parse one line as a loc: line. Returns null for anything else. */
export function parseLocLine(line: string): LatLon | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(LOC_PREFIX)) return null;
  const rest = trimmed.slice(LOC_PREFIX.length).trim();
  const parts = rest.split(',');
  if (parts.length !== 2) return null;
  const latText = parts[0].trim();
  const lonText = parts[1].trim();
  if (!LOC_COMPONENT.test(latText) || !LOC_COMPONENT.test(lonText)) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
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
