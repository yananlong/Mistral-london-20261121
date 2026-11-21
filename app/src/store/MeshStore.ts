import { decodeLocationShare, HUB_NICKNAME, LocationShare } from '../protocol';
import { InboundMessage, LinkState, Peer, PeerId, peerId, Transport, TransportEvent } from '../transport/types';

export type ThreadKey = 'public' | PeerId;
export type ThreadMessage = InboundMessage & { direction: 'in' | 'out' };
export type PeerPin = LocationShare & { peerId: PeerId; nickname: string; receivedAt: number };
export interface MeshState {
  link: LinkState;
  detail: string | undefined;
  peers: Peer[];
  knownPeers: Record<string, Peer>;
  hubId: PeerId | null;
  conversations: Record<string, ThreadMessage[]>;
  pins: Record<string, PeerPin>;
}

export class MeshStore {
  private state: MeshState = { link: 'starting', detail: undefined, peers: [], knownPeers: {}, hubId: null, conversations: {}, pins: {} };
  private listeners = new Set<() => void>();
  private outgoingId = 0;
  constructor(private readonly transport: Transport) {}
  getSnapshot = (): MeshState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(state: MeshState): void { this.state = state; this.listeners.forEach(listener => listener()); }

  receive(event: TransportEvent): void {
    switch (event.type) {
      case 'state': this.update({ ...this.state, link: event.state, detail: event.detail }); return;
      case 'peers': {
        const knownPeers = { ...this.state.knownPeers };
        event.peers.forEach(peer => { knownPeers[peer.id] = peer; });
        const hubId = event.peers.find(peer => peer.nickname === HUB_NICKNAME)?.id ?? this.state.hubId;
        this.update({ ...this.state, peers: event.peers, knownPeers, hubId });
        return;
      }
      case 'message': {
        const message = event.message;
        const key = message.channel === 'public' ? 'public' : message.from;
        const thread = this.state.conversations[key] ?? [];
        if (thread.some(existing => existing.id === message.id)) return;
        const share = decodeLocationShare(message.text);
        const priorPin = this.state.pins[message.from];
        const pins = share && (!priorPin || priorPin.receivedAt <= message.receivedAt)
          ? { ...this.state.pins, [message.from]: { ...share, peerId: message.from, nickname: message.fromNickname, receivedAt: message.receivedAt } }
          : this.state.pins;
        this.update({
          ...this.state, pins,
          knownPeers: { ...this.state.knownPeers, [message.from]: { id: message.from, nickname: message.fromNickname, reachable: this.state.peers.some(peer => peer.id === message.from && peer.reachable) } },
          conversations: { ...this.state.conversations, [key]: [...thread, { ...message, direction: 'in' }] },
        });
      }
    }
  }

  async send(to: ThreadKey, text: string): Promise<void> {
    if (to === 'public') await this.transport.sendPublic(text);
    else await this.transport.sendPrivate(to, text);
    const message: ThreadMessage = {
      id: `out-${++this.outgoingId}`, from: localPeerId,
      fromNickname: 'You', text, channel: to === 'public' ? 'public' : 'private', receivedAt: Date.now(), direction: 'out',
    };
    this.update({ ...this.state, conversations: { ...this.state.conversations, [to]: [...(this.state.conversations[to] ?? []), message] } });
  }
}

const localPeerId = peerId('local-phone');
