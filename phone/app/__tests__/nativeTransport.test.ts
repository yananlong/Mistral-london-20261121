import {
  BitChatNativeModule,
  NATIVE_EVENT_MESSAGE,
  NativeTransport,
  pickTransport,
} from '../src/transport/NativeTransport';
import { SimulatedTransport } from '../src/transport/SimulatedTransport';
import { MeshMessage, PUBLIC_CHANNEL, SELF_PEER_ID } from '../src/transport/Transport';

/** A fake native module that records sends and lets tests emit events. */
function fakeNativeModule(): BitChatNativeModule & {
  sent: { to: string; text: string }[];
  emit(event: string, payload: unknown): void;
} {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const sent: { to: string; text: string }[] = [];
  return {
    sent,
    send(to: string, text: string) {
      sent.push({ to, text });
      return `native-${sent.length}`;
    },
    peers() {
      return [{ id: 'hub', name: 'Hub (DGX Spark)', kind: 'hub' as const }];
    },
    addListener(event: string, handler: (payload: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },
    emit(event: string, payload: unknown) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  };
}

describe('NativeTransport adapts the native module to the Transport interface', () => {
  it('sends through the native module and echoes a MeshMessage', () => {
    const native = fakeNativeModule();
    const transport = new NativeTransport(native);
    const sent = transport.send(PUBLIC_CHANNEL, 'hello mesh');
    expect(native.sent).toEqual([{ to: PUBLIC_CHANNEL, text: 'hello mesh' }]);
    expect(sent).toMatchObject({
      id: 'native-1',
      from: SELF_PEER_ID,
      to: PUBLIC_CHANNEL,
      text: 'hello mesh',
    });
    expect(typeof sent.timestamp).toBe('number');
  });

  it('forwards native message events to subscribers and ignores malformed ones', () => {
    const native = fakeNativeModule();
    const transport = new NativeTransport(native);
    const received: MeshMessage[] = [];
    const unsubscribe = transport.subscribe((message) => received.push(message));

    native.emit(NATIVE_EVENT_MESSAGE, { id: 'm1', from: 'hub', to: 'me', text: 'hi', timestamp: 7 });
    native.emit(NATIVE_EVENT_MESSAGE, { text: 42 }); // malformed: no string text
    native.emit(NATIVE_EVENT_MESSAGE, null);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ id: 'm1', from: 'hub', to: 'me', text: 'hi', timestamp: 7 });
    unsubscribe();
    native.emit(NATIVE_EVENT_MESSAGE, { id: 'm2', from: 'hub', text: 'again' });
    expect(received).toHaveLength(1);
  });

  it('fills in defaults for sparse native messages', () => {
    const native = fakeNativeModule();
    const transport = new NativeTransport(native);
    const received: MeshMessage[] = [];
    transport.subscribe((message) => received.push(message));
    native.emit(NATIVE_EVENT_MESSAGE, { text: 'bare' });
    expect(received[0].from).toBe('unknown');
    expect(received[0].to).toBe(PUBLIC_CHANNEL);
    expect(typeof received[0].timestamp).toBe('number');
  });

  it('exposes the native peer list and survives a throwing peers()', () => {
    const native = fakeNativeModule();
    const transport = new NativeTransport(native);
    expect(transport.peers().some((peer) => peer.id === 'hub' && peer.kind === 'hub')).toBe(true);
    const broken = fakeNativeModule();
    broken.peers = () => {
      throw new Error('not ready');
    };
    expect(new NativeTransport(broken).peers()).toEqual([]);
  });

  it('dispose detaches from the native event stream', () => {
    const native = fakeNativeModule();
    const transport = new NativeTransport(native);
    const received: MeshMessage[] = [];
    transport.subscribe((message) => received.push(message));
    transport.dispose();
    native.emit(NATIVE_EVENT_MESSAGE, { text: 'after dispose' });
    expect(received).toHaveLength(0);
  });
});

describe('pickTransport selection', () => {
  it('auto falls back to the simulated mesh when no native module is linked', () => {
    expect(pickTransport(null, { transportMode: 'auto' })).toBeInstanceOf(SimulatedTransport);
  });

  it('auto uses the native module when it is linked', () => {
    expect(pickTransport(fakeNativeModule(), { transportMode: 'auto' })).toBeInstanceOf(
      NativeTransport,
    );
  });

  it('simulated forces the simulator even when a native module exists', () => {
    expect(pickTransport(fakeNativeModule(), { transportMode: 'simulated' })).toBeInstanceOf(
      SimulatedTransport,
    );
  });

  it('native throws a clear error when the module is missing', () => {
    expect(() => pickTransport(null, { transportMode: 'native' })).toThrow(/native module/);
  });
});
