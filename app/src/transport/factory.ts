import { BitchatTransport, loadNativeMesh } from './BitchatTransport';
import { SimulatedTransport } from './SimulatedTransport';
import { SimulationControls, Transport } from './types';

export interface TransportSelection { transport: Transport; simulation?: SimulationControls }

export function createTransport(): TransportSelection {
  const module = loadNativeMesh();
  if (module) return { transport: new BitchatTransport(module) };
  const transport = new SimulatedTransport();
  return { transport, simulation: transport };
}
