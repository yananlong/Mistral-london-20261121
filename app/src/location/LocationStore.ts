import * as ExpoLocation from 'expo-location';
import { Coordinates } from '../protocol';

export type LocationState =
  | { kind: 'locating' }
  | { kind: 'denied' }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'ready'; position: Coordinates; source: 'device' | 'demo'; accuracy: number | null };
export type LocationSource = (emit: (state: LocationState) => void) => Promise<() => void>;

export const deviceLocation: LocationSource = async emit => {
  const permission = await ExpoLocation.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    emit({ kind: 'denied' });
    return () => {};
  }
  emit({ kind: 'locating' });
  const subscription = await ExpoLocation.watchPositionAsync(
    { accuracy: ExpoLocation.Accuracy.Balanced, distanceInterval: 10 },
    ({ coords }) => emit({ kind: 'ready', position: { lat: coords.latitude, lon: coords.longitude }, source: 'device', accuracy: coords.accuracy }),
    reason => emit({ kind: 'unavailable', detail: reason }),
  );
  return () => subscription.remove();
};

export function fixedLocation(state: LocationState): LocationSource {
  return async emit => { emit(state); return () => {}; };
}
export const demoLocation = fixedLocation({ kind: 'ready', position: { lat: 51.5007, lon: -0.1246 }, source: 'demo', accuracy: null });

export class LocationStore {
  private state: LocationState = { kind: 'locating' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private stopWatching: (() => void) | undefined;
  getSnapshot = (): LocationState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  async start(source: LocationSource): Promise<void> {
    this.stopWatching?.();
    const generation = ++this.generation;
    this.set({ kind: 'locating' });
    try {
      const stop = await source(state => { if (generation === this.generation) this.set(state); });
      if (generation === this.generation) this.stopWatching = stop;
      else stop();
    } catch {
      if (generation === this.generation) this.set({ kind: 'unavailable', detail: 'Your position is unavailable. Try again with a clear view of the sky.' });
    }
  }
  private set(state: LocationState): void { this.state = state; this.listeners.forEach(listener => listener()); }
  dispose(): void { ++this.generation; this.stopWatching?.(); }
}
