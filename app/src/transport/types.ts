export type PeerId = string & { readonly __brand: 'PeerId' };
export interface Peer { id: PeerId; nickname: string; reachable: boolean }
export interface InboundMessage {
  id: string; from: PeerId; fromNickname: string; text: string;
  channel: 'public' | 'private'; receivedAt: number;
}
export type LinkState = 'starting' | 'running' | 'bluetooth_off' | 'unauthorized' | 'unsupported' | 'stopped';
export type TransportEvent =
  | { type: 'peers'; peers: Peer[] }
  | { type: 'message'; message: InboundMessage }
  | { type: 'state'; state: LinkState; detail?: string };
export interface Transport {
  readonly kind: 'simulated' | 'bitchat' | 'hublink';
  start(nickname: string): Promise<void>;
  stop(): Promise<void>;
  sendPublic(text: string): Promise<void>;
  sendPrivate(to: PeerId, text: string): Promise<void>;
  subscribe(listener: (event: TransportEvent) => void): () => void;
}

export function isPeerId(value: unknown): value is PeerId {
  return typeof value === 'string' && value.trim().length > 0;
}

export function peerId(value: string): PeerId {
  if (!isPeerId(value)) throw new Error('A peer needs a non-empty id.');
  return value;
}

export type HubMode = 'online' | 'offline' | 'error';
export interface SimulationControls {
  getHubMode(): HubMode;
  setHubMode(mode: HubMode): void;
  sendPhoneMessage(channel: 'public' | 'private'): void;
  sendPhoneLocation(): void;
  setPhoneNearby(nearby: boolean): void;
}
