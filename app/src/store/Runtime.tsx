import { createContext, PropsWithChildren, useContext, useEffect, useSyncExternalStore } from 'react';
import { AskController } from '../ask/AskController';
import { demoLocation, deviceLocation, LocationSource, LocationStore } from '../location/LocationStore';
import { TransportSelection } from '../transport/factory';
import { MeshStore } from './MeshStore';

export class AppRuntime {
  readonly mesh: MeshStore;
  readonly ask: AskController;
  readonly location = new LocationStore();
  readonly kind;
  readonly simulation;
  private unsubscribe: (() => void) | undefined;
  constructor(private readonly selection: TransportSelection, private readonly locationSource: LocationSource = selection.transport.kind === 'simulated' ? demoLocation : deviceLocation) {
    this.mesh = new MeshStore(selection.transport);
    this.ask = new AskController(this.mesh);
    this.kind = selection.transport.kind;
    this.simulation = selection.simulation;
  }
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.selection.transport.subscribe(event => {
      this.mesh.receive(event);
      if (event.type === 'message') this.ask.receive(event.message);
    });
    void this.location.start(this.locationSource);
    void this.selection.transport.start('Phone A').catch(() => {
      this.mesh.receive({ type: 'state', state: 'stopped', detail: 'The link could not start. Close and reopen the app to try again.' });
    });
  }
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.ask.dispose();
    this.location.dispose();
    void this.selection.transport.stop().catch(() => {});
  }
  useDevicePosition(): void { void this.location.start(deviceLocation); }
  useDemoPosition(): void { void this.location.start(demoLocation); }
}

const RuntimeContext = createContext<AppRuntime | null>(null);
export function RuntimeProvider({ runtime, children }: PropsWithChildren<{ runtime: AppRuntime }>) {
  useEffect(() => { runtime.start(); return () => runtime.stop(); }, [runtime]);
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}
export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('Screens must be inside RuntimeProvider.');
  return runtime;
}
export function useMesh() {
  const { mesh } = useRuntime();
  return useSyncExternalStore(mesh.subscribe, mesh.getSnapshot, mesh.getSnapshot);
}
export function useAsk() {
  const { ask } = useRuntime();
  return useSyncExternalStore(ask.subscribe, ask.getSnapshot, ask.getSnapshot);
}
export function useLocation() {
  const { location } = useRuntime();
  return useSyncExternalStore(location.subscribe, location.getSnapshot, location.getSnapshot);
}
