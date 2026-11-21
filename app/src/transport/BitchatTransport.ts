import { requireOptionalNativeModule } from 'expo-modules-core';
import { InboundMessage, LinkState, Peer, PeerId, peerId, Transport, TransportEvent } from './types';

type NativePeer = Omit<Peer, 'id'> & { id: string };
type NativeMessage = Omit<InboundMessage, 'from'> & { from: string };
type NativeEvents = {
  onPeers: { peers: NativePeer[] };
  onMessage: NativeMessage;
  onState: { state: LinkState; detail?: string };
};
export interface NativeMesh {
  start(nickname: string): Promise<void>;
  stop(): Promise<void>;
  getPeers(): Promise<NativePeer[]>;
  sendPublic(text: string): Promise<void>;
  sendPrivate(peerId: string, text: string): Promise<void>;
  addListener<K extends keyof NativeEvents>(event: K, listener: (value: NativeEvents[K]) => void): { remove(): void };
}

export function loadNativeMesh(): NativeMesh | null {
  return requireOptionalNativeModule<NativeMesh>('BitchatMesh');
}

export class BitchatTransport implements Transport {
  readonly kind = 'bitchat';
  private listeners = new Set<(event: TransportEvent) => void>();
  constructor(private readonly module: NativeMesh) {}
  async start(nickname: string): Promise<void> {
    await this.module.start(nickname);
    const peers = (await this.module.getPeers()).map(peer => ({ ...peer, id: peerId(peer.id) }));
    this.listeners.forEach(listener => listener({ type: 'peers', peers }));
  }
  stop(): Promise<void> { return this.module.stop(); }
  sendPublic(text: string): Promise<void> { return this.module.sendPublic(text); }
  sendPrivate(to: PeerId, text: string): Promise<void> { return this.module.sendPrivate(to, text); }
  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    const subscriptions = [
      this.module.addListener('onPeers', ({ peers }) => listener({ type: 'peers', peers: peers.map(peer => ({ ...peer, id: peerId(peer.id) })) })),
      this.module.addListener('onMessage', message => listener({ type: 'message', message: { ...message, from: peerId(message.from) } })),
      this.module.addListener('onState', state => listener({ type: 'state', ...state })),
    ];
    return () => { this.listeners.delete(listener); subscriptions.forEach(subscription => subscription.remove()); };
  }
}
