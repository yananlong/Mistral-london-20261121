/**
 * The one small interface the UI sits on (PLAN.md section 4).
 *
 * The native BitChat module will implement this interface; until it lands,
 * SimulatedTransport implements it in memory so every screen and state can
 * be built first. How messages move can change without redoing the design.
 */

export type PeerId = string;

/** The public mesh channel. Messages sent to it are broadcast to every peer. */
export const PUBLIC_CHANNEL = 'public';

/** Peer id used for messages this phone sends itself. */
export const SELF_PEER_ID = 'me';

/** Peer id of the hub (BLUEPRINT_1.md: the hub joins the mesh as one more peer). */
export const HUB_PEER_ID = 'hub';

/** A peer on the mesh. The hub is a peer too (BLUEPRINT_1.md). */
export interface Peer {
  id: PeerId;
  name: string;
  kind: 'phone' | 'hub';
}

/** One message on the mesh. */
export interface MeshMessage {
  id: string;
  from: PeerId;
  to: PeerId | typeof PUBLIC_CHANNEL;
  text: string;
  timestamp: number;
}

export type IncomingMessageHandler = (message: MeshMessage) => void;

export interface Transport {
  /** Send a message to one peer or to the public channel. Returns the sent message. */
  send(to: PeerId | typeof PUBLIC_CHANNEL, text: string): MeshMessage;
  /** Subscribe to incoming messages. Returns an unsubscribe function. */
  subscribe(handler: IncomingMessageHandler): () => void;
  /** The current view of nearby peers. */
  peers(): Peer[];
}
