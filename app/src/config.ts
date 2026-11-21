/**
 * One place for runtime configuration, so connecting the real backend or the
 * native mesh is a config change, not a code change in the screens.
 * Ported from phone/app/src/config.ts (PR #18).
 *
 * The MVP is fully offline: phones have no internet and every question goes
 * to the hub over the BitChat mesh (README.md, BLUEPRINT_1.md). `apiBaseUrl`
 * is for the post-MVP live-information backend only and stays null here, so
 * nothing in the MVP makes an HTTP call.
 */

import { ACK_TIMEOUT_MS, ANSWER_TIMEOUT_MS, HUB_NICKNAME } from './protocol';

export type TransportMode = 'auto' | 'simulated' | 'native';

export interface AppConfig {
  /**
   * Which mesh transport the app runs on:
   * - 'auto' (default): the native BitChat module when it is linked, otherwise
   *   the simulated mesh, so Expo Go, web and Android still run every screen.
   * - 'simulated': always the in-memory simulated mesh (design, tests, demo).
   * - 'native': require the native module; if it is missing the app throws at
   *   startup instead of silently running on a fake mesh.
   */
  transportMode: TransportMode;
  /** Nickname the hub announces on the mesh; MeshStore finds the hub by it. */
  hubNickname: string;
  /** How long Ask waits for the hub's acknowledgement before "Hub not reachable". */
  ackTimeoutMs: number;
  /** How long Ask waits for the whole answer once the hub has acknowledged. */
  answerTimeoutMs: number;
  /** "The app keeps trying": how often an unacknowledged question or SOS is sent again. */
  retryIntervalMs: number;
  /**
   * Post-MVP only: base URL of the live-information backend (alerts, flood
   * warnings, "I'm safe" relay). Null in the MVP: no question ever goes to a
   * cloud API.
   */
  apiBaseUrl: string | null;
  /** Timeout for one HTTP call to that backend, once apiBaseUrl is set. */
  apiTimeoutMs: number;
}

export const config: AppConfig = {
  transportMode: 'auto',
  hubNickname: HUB_NICKNAME,
  ackTimeoutMs: ACK_TIMEOUT_MS,
  answerTimeoutMs: ANSWER_TIMEOUT_MS,
  retryIntervalMs: 20_000,
  apiBaseUrl: null,
  apiTimeoutMs: 10_000,
};
