import type { IncomingMessageHandler, MeshMessage, Peer, Transport } from './Transport';
import type { AppConfig } from '../config';
import { SimulatedTransport } from './SimulatedTransport';

/**
 * Adapter that makes the native BitChat module look like a `Transport`, so
 * the screens do not care whether messages move over the real mesh or the
 * simulator. This file stays free of react-native imports on purpose: the
 * module is injected, which keeps the adapter unit-testable in plain node.
 */

/** Event names the native module emits. Keep in sync with the native side. */
export const NATIVE_EVENT_MESSAGE = 'bitchatMessage';
export const NATIVE_EVENT_PEERS = 'bitchatPeers';

/**
 * The contract the native BitChat module (Xcode wiring in a later PR) must
 * satisfy. Shapes mirror `MeshMessage` / `Peer` from Transport.ts.
 */
export interface BitChatNativeModule {
  /** Send a message; returns the id the native side assigned. */
  send(to: string, text: string): string;
  /** Current view of nearby peers. */
  peers(): Peer[];
  /** Subscribe to a native event. Returns an unsubscribe function. */
  addListener(event: string, handler: (payload: unknown) => void): () => void;
}

interface NativeMeshMessage {
  id?: string;
  from?: string;
  to?: string;
  text?: string;
  timestamp?: number;
}

export class NativeTransport implements Transport {
  private readonly module: BitChatNativeModule;
  private readonly handlers = new Set<IncomingMessageHandler>();
  private counter = 0;
  private readonly offMessage: () => void;

  constructor(module: BitChatNativeModule) {
    this.module = module;
    this.offMessage = module.addListener(NATIVE_EVENT_MESSAGE, (payload) => {
      const message = this.toMeshMessage(payload as NativeMeshMessage);
      if (!message) return;
      for (const handler of [...this.handlers]) handler(message);
    });
  }

  send(to: MeshMessage['to'], text: string): MeshMessage {
    const id = this.module.send(to, text);
    // The native side owns the id; keep a local fallback for messages the
    // native layer accepted without one.
    const messageId = id || `native-${++this.counter}`;
    return { id: messageId, from: 'me', to, text, timestamp: Date.now() };
  }

  subscribe(handler: IncomingMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  peers(): Peer[] {
    try {
      return this.module.peers().map((peer) => ({ ...peer }));
    } catch {
      return [];
    }
  }

  /** Detach from the native event stream. */
  dispose(): void {
    this.offMessage();
    this.handlers.clear();
  }

  private toMeshMessage(raw: NativeMeshMessage): MeshMessage | null {
    if (!raw || typeof raw.text !== 'string') return null;
    this.counter += 1;
    return {
      id: raw.id ?? `native-in-${this.counter}`,
      from: raw.from ?? 'unknown',
      to: raw.to ?? 'public',
      text: raw.text,
      timestamp: raw.timestamp ?? Date.now(),
    };
  }
}

/**
 * Pure selection logic, kept separate from the react-native lookup so it is
 * testable without the native runtime. 'auto' uses the native module when it
 * is linked and falls back to the simulator otherwise; 'native' demands it.
 */
export function pickTransport(
  nativeModule: BitChatNativeModule | null,
  cfg: Pick<AppConfig, 'transportMode'>,
): Transport {
  if (cfg.transportMode === 'native') {
    if (!nativeModule) {
      throw new Error(
        'transportMode is "native" but the BitChat native module is not linked. ' +
          'Link the native module or set transportMode to "auto"/"simulated" in src/config.ts.',
      );
    }
    return new NativeTransport(nativeModule);
  }
  if (cfg.transportMode === 'simulated' || !nativeModule) {
    return new SimulatedTransport({});
  }
  return new NativeTransport(nativeModule);
}
