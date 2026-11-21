import { createContext, PropsWithChildren, useContext, useEffect, useSyncExternalStore } from 'react';
import { AskController } from '../ask/AskController';
import { NewsKey } from '../content/scenario';
import { demoLocation, deviceLocation, LocationSource, LocationStore } from '../location/LocationStore';
import { SosController } from '../sos/SosController';
import { TransportSelection } from '../transport/factory';
import { MeshStore } from './MeshStore';

/** A tiny observable value, for state the screens share. */
export class ValueStore<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  getSnapshot = (): T => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  set(value: T): void { if (value !== this.value) { this.value = value; this.listeners.forEach(listener => listener()); } }
}

export class AppRuntime {
  readonly mesh: MeshStore;
  readonly ask: AskController;
  readonly sos: SosController;
  readonly location = new LocationStore();
  /** Which briefing is showing. Stored on the phone until the hub can broadcast news. */
  readonly news = new ValueStore<NewsKey>('some');
  readonly kind;
  readonly simulation;
  private unsubscribe: (() => void) | undefined;
  constructor(private readonly selection: TransportSelection, private readonly locationSource: LocationSource = selection.transport.kind === 'simulated' ? demoLocation : deviceLocation) {
    this.mesh = new MeshStore(selection.transport);
    this.ask = new AskController(this.mesh);
    this.sos = new SosController(this.mesh, () => {
      const position = this.location.getSnapshot();
      return position.kind === 'ready' ? position.position : null;
    });
    this.kind = selection.transport.kind;
    this.simulation = selection.simulation;
  }
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.selection.transport.subscribe(event => {
      this.mesh.receive(event);
      if (event.type === 'message') this.ask.receive(event.message);
      // Anything waiting to go out gets another chance after every change.
      this.ask.flush();
      this.sos.flush();
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
    this.sos.dispose();
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
export function useAskHistory() {
  const { ask } = useRuntime();
  return useSyncExternalStore(ask.subscribe, ask.getHistory, ask.getHistory);
}
export function useSos() {
  const { sos } = useRuntime();
  return useSyncExternalStore(sos.subscribe, sos.getSnapshot, sos.getSnapshot);
}
export function useNews() {
  const { news } = useRuntime();
  return useSyncExternalStore(news.subscribe, news.getSnapshot, news.getSnapshot);
}
export function useLocation() {
  const { location } = useRuntime();
  return useSyncExternalStore(location.subscribe, location.getSnapshot, location.getSnapshot);
}
