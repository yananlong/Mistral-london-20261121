import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { PositionState, SimulatedPositionOptions, usePosition } from './usePosition';

const PositionContext = createContext<PositionState | null>(null);

/** One shared position source for the Locate and Ask screens. */
export function PositionProvider({
  options,
  children,
}: {
  options?: SimulatedPositionOptions;
  children: ReactNode;
}) {
  const position = usePosition(options);
  return <PositionContext.Provider value={position}>{children}</PositionContext.Provider>;
}

export function usePositionContext(): PositionState {
  const position = useContext(PositionContext);
  if (!position) throw new Error('usePositionContext must be used inside PositionProvider');
  return position;
}
