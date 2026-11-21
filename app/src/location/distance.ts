import { Coordinates } from '../protocol';

const EARTH_RADIUS_M = 6_371_000;
const WALK_M_PER_MIN = 80;

export function metresBetween(a: Coordinates, b: Coordinates): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** "300 m, 4 min walk" / "1.2 km, 15 min walk" — the design's distance line. */
export function walkLabel(from: Coordinates, to: Coordinates): string {
  const metres = metresBetween(from, to);
  const minutes = Math.max(1, Math.round(metres / WALK_M_PER_MIN));
  const distance = metres < 1000 ? `${Math.max(50, Math.round(metres / 50) * 50)} m` : `${(metres / 1000).toFixed(1)} km`;
  return `${distance}, ${minutes} min walk`;
}

/** "2:31pm", the design's time format. */
export function clockLabel(time: number): string {
  const date = new Date(time);
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours % 12 || 12}:${minutes}${hours < 12 ? 'am' : 'pm'}`;
}
