import { decodeLocationShare, LocationShare, MAX_MESSAGE_BYTES, utf8Bytes } from '../protocol';
import { config } from '../config';
import { InboundMessage, LinkState, Peer, PeerId, peerId, Transport, TransportEvent } from '../transport/types';

export type ThreadKey = 'public' | PeerId;
/** Outgoing messages show what happened to them: sending, then sent (or not sent). */
export type SendStatus = 'sending' | 'sent' | 'failed';
export type ThreadMessage = InboundMessage & { direction: 'in' | 'out'; status?: SendStatus };
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
        const hubId = event.peers.find(peer => peer.nickname === config.hubNickname)?.id ?? this.state.hubId;
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
    if (utf8Bytes(text) > MAX_MESSAGE_BYTES) throw new Error('The message exceeds the mesh byte limit.');
    const message: ThreadMessage = {
      id: `out-${++this.outgoingId}`, from: localPeerId,
      fromNickname: 'You', text, channel: to === 'public' ? 'public' : 'private', receivedAt: Date.now(), direction: 'out', status: 'sending',
    };
    this.update({ ...this.state, conversations: { ...this.state.conversations, [to]: [...(this.state.conversations[to] ?? []), message] } });
    try {
      if (to === 'public') await this.transport.sendPublic(text);
      else await this.transport.sendPrivate(to, text);
      this.setStatus(to, message.id, 'sent');
    } catch (error) {
      this.setStatus(to, message.id, 'failed');
      throw error;
    }
  }

  private setStatus(thread: ThreadKey, id: string, status: SendStatus): void {
    const messages = this.state.conversations[thread] ?? [];
    this.update({ ...this.state, conversations: { ...this.state.conversations, [thread]: messages.map(item => item.id === id ? { ...item, status } : item) } });
  }
}

const localPeerId = peerId('local-phone');

export type FeedMessage = ThreadMessage & { thread: ThreadKey };
/** Every non-hub message, oldest first: the people side of the home-screen thread. */
export function peerMessages(state: MeshState): FeedMessage[] {
  return Object.entries(state.conversations)
    .filter(([key]) => key !== state.hubId)
    .flatMap(([key, messages]) => messages.map(message => ({ ...message, thread: key as ThreadKey })))
    .sort((a, b) => a.receivedAt - b.receivedAt);
}
