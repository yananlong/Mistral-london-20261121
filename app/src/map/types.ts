import { Coordinates } from '../protocol';

export interface MapFocus { position: Coordinates; label: string }
/**
 * self  = you (a dot)
 * place = a numbered pin that matches the list under the map
 * peer  = someone who shared where they are
 * focus = a location opened from a message
 */
export interface MapPoint { id: string; label: string; position: Coordinates; kind: 'self' | 'peer' | 'focus' | 'place'; number?: number; danger?: boolean }
export interface OfflineMapProps { points: MapPoint[]; focus: MapFocus | null; height?: number }

export function isInLondon({ lat, lon }: Coordinates): boolean {
  return lat >= 51.2868 && lat <= 51.6919 && lon >= -0.5104 && lon <= 0.3340;
}
