import { useEffect, useState } from 'react';
import type { LatLon } from './locLine';

export type PositionStatus = 'pending' | 'denied' | 'fix';

export interface PositionState {
  status: PositionStatus;
  coords: LatLon | null;
}

export interface SimulatedPositionOptions {
  /** Which state to exercise: a fix (default), a denied permission, or stuck pending. */
  simulate?: 'fix' | 'denied' | 'pending';
  fixDelayMs?: number;
  coords?: LatLon;
}

/** Default simulated fix: central London, matching BLUEPRINT_1.md's example coordinates. */
export const DEFAULT_FIX: LatLon = { lat: 51.5007, lon: -0.1246 };

/**
 * Stand-in for the native satellite-positioning module, which lands with the
 * Xcode wiring in a later PR. Satellite positioning works with no internet,
 * so the real module will behave the same way: pending until the first fix,
 * or denied when the user refuses permission.
 */
export function usePosition(options: SimulatedPositionOptions = {}): PositionState {
  const simulate = options.simulate ?? 'fix';
  const [state, setState] = useState<PositionState>(() => ({
    status: simulate === 'denied' ? 'denied' : 'pending',
    coords: null,
  }));

  useEffect(() => {
    if (simulate !== 'fix') return;
    const timer = setTimeout(() => {
      setState({ status: 'fix', coords: options.coords ?? DEFAULT_FIX });
    }, options.fixDelayMs ?? 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
