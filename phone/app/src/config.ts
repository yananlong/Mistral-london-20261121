/**
 * One place for runtime configuration, so connecting the real backend or
 * native module is a config change, not a code change in the screens.
 *
 * The MVP is fully offline: phones have no internet and every question goes
 * to the hub over the BitChat mesh (README.md, BLUEPRINT_1.md). The
 * `apiBaseUrl` below is for the post-MVP live-information backend only and
 * stays null in the MVP build — nothing in the MVP calls it.
 */

import { HUB_PEER_ID } from './transport/Transport';

export type TransportMode = 'auto' | 'simulated' | 'native';

export interface AppConfig {
  /**
   * Which mesh transport the app runs on:
   * - 'auto' (default): use the native BitChat module when it is linked,
   *   otherwise fall back to the simulated mesh so every screen still works.
   * - 'simulated': force the in-memory simulated mesh (design, tests, demo).
   * - 'native': require the native module; if it is missing the app throws
   *   at startup instead of silently running on a fake mesh.
   */
  transportMode: TransportMode;
  /** Peer id of the hub on the mesh (BLUEPRINT_1.md: the hub is one more peer). */
  hubPeerId: string;
  /** How long Ask waits for the hub's first reply before "Hub not reachable". */
  hubTimeoutMs: number;
  /**
   * Post-MVP only: base URL of the live-information backend (alerts, flood
   * warnings, "I'm safe" relay). Null in the MVP: the app makes no HTTP
   * calls and no question ever goes to a cloud model API.
   */
  apiBaseUrl: string | null;
  /** Timeout for one HTTP call to that backend, once apiBaseUrl is set. */
  apiTimeoutMs: number;
}

export const config: AppConfig = {
  transportMode: 'auto',
  hubPeerId: HUB_PEER_ID,
  hubTimeoutMs: 30_000,
  apiBaseUrl: null,
  apiTimeoutMs: 10_000,
};
