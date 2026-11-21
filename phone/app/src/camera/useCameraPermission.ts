import { useState } from 'react';

export type CameraPermissionStatus = 'pending' | 'granted' | 'denied';

export interface SimulatedCameraPermissionOptions {
  /** Which state to exercise: granted (default), denied, or stuck pending. */
  simulate?: 'granted' | 'denied' | 'pending';
}

/**
 * Stand-in for the native camera permission. The vision model that uses the
 * camera is build-order step 6, but PLAN.md section 6 lists "camera permission
 * denied" as a designed state, so the scaffold can already show it.
 */
export function useCameraPermission(
  options: SimulatedCameraPermissionOptions = {},
): CameraPermissionStatus {
  const simulate = options.simulate ?? 'granted';
  const [status] = useState<CameraPermissionStatus>(() =>
    simulate === 'denied' ? 'denied' : simulate === 'pending' ? 'pending' : 'granted',
  );
  return status;
}
