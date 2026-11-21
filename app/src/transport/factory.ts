import { config, TransportMode } from '../config';
import { BitchatTransport, loadNativeMesh, NativeMesh } from './BitchatTransport';
import { SimulatedTransport } from './SimulatedTransport';
import { SimulationControls, Transport } from './types';

export interface TransportSelection { transport: Transport; simulation?: SimulationControls }

/**
 * Picks the mesh transport for `mode` (default: `config.transportMode`).
 * 'auto' uses the native BitchatMesh module when linked and falls back to the
 * simulated mesh; 'native' fails loudly instead of falling back.
 * `loadNative` is injectable for tests.
 */
export function createTransport(
  mode: TransportMode = config.transportMode,
  loadNative: () => NativeMesh | null = loadNativeMesh,
): TransportSelection {
  if (mode !== 'simulated') {
    const module = loadNative();
    if (module) return { transport: new BitchatTransport(module) };
    if (mode === 'native') {
      throw new Error('transportMode is "native" but the BitchatMesh native module is not linked. Use a development build, or set transportMode to "auto".');
    }
  }
  const transport = new SimulatedTransport();
  return { transport, simulation: transport };
}
