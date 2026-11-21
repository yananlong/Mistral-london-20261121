import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Transport } from './Transport';
import { config } from '../config';
import { getNativeBitChatModule } from './nativeBitChatModule';
import { pickTransport } from './NativeTransport';

export const TransportContext = createContext<Transport | null>(null);

/**
 * Picks the mesh transport per src/config.ts: the native BitChat module when
 * it is linked ('auto'/'native'), otherwise the simulated mesh, so the app
 * always runs — on device before the native wiring lands, and in tests.
 */
export function createDefaultTransport(): Transport {
  return pickTransport(getNativeBitChatModule(), config);
}

export function TransportProvider({
  transport,
  children,
}: {
  transport: Transport;
  children: ReactNode;
}) {
  return <TransportContext.Provider value={transport}>{children}</TransportContext.Provider>;
}

export function useTransport(): Transport {
  const transport = useContext(TransportContext);
  if (!transport) throw new Error('useTransport must be used inside TransportProvider');
  return transport;
}
