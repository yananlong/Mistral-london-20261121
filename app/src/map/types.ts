import { Coordinates } from '../protocol';

export interface MapFocus { position: Coordinates; label: string }
export interface MapPoint { id: string; label: string; position: Coordinates; kind: 'self' | 'peer' | 'focus' }
export interface OfflineMapProps { points: MapPoint[]; focus: MapFocus | null }

export function isInLondon({ lat, lon }: Coordinates): boolean {
  return lat >= 51.2868 && lat <= 51.6919 && lon >= -0.5104 && lon <= 0.3340;
}
