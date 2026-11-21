import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Transport } from './Transport';
import { SimulatedTransport } from './SimulatedTransport';

export const TransportContext = createContext<Transport | null>(null);

/** Until the BitChat native module lands, the app runs on the simulated mesh. */
export function createDefaultTransport(): Transport {
  return new SimulatedTransport({});
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
