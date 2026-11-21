import {
  IncomingMessageHandler,
  MeshMessage,
  Peer,
  SELF_PEER_ID,
  Transport,
} from './Transport';

export const HUB_PEER_ID = 'hub';

/** The hub's first reply, word for word per BLUEPRINT_1.md. */
export const HUB_ACK_TEXT = 'Received. Working on an answer.';

/** The label the hub ends every answer with, word for word per BLUEPRINT_1.md. */
export const HUB_ANSWER_LABEL =
  'AI answer from an open-weight model on the hub. Not verified emergency advice.';

export const DEFAULT_PEERS: Peer[] = [
  { id: HUB_PEER_ID, name: 'Hub (DGX Spark)', kind: 'hub' },
  { id: 'ava', name: 'Ava', kind: 'phone' },
  { id: 'noa', name: 'Noa', kind: 'phone' },
];

export type TimerHandle = unknown;
export type SetTimeoutFn = (handler: () => void, ms: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle) => void;

export interface SimulatedTransportOptions {
  peers?: Peer[];
  /** Hub-unreachable mode: the hub never replies (demo step 5). */
  hubOnline?: boolean;
  ackDelayMs?: number;
  answerDelayMs?: number;
  now?: () => number;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
}

/**
 * In-memory simulated mesh with a mock hub, so the whole app can be designed
 * before the real BitChat native module lands (BLUEPRINT_1.md build order:
 * design starts on a simulated link).
 *
 * The mock hub implements the exact two-message protocol: on a question sent
 * to the hub it first replies HUB_ACK_TEXT, then after a delay the answer.
 * With hubOnline: false it sends no reply at all, so the timeout state can be
 * exercised.
 */
export class SimulatedTransport implements Transport {
  private readonly peersList: Peer[];
  private hubOnline: boolean;
  private readonly ackDelayMs: number;
  private readonly answerDelayMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: SetTimeoutFn;
  private readonly clearTimeoutFn: ClearTimeoutFn;
  private readonly handlers = new Set<IncomingMessageHandler>();
  private counter = 0;

  constructor(options: SimulatedTransportOptions = {}) {
    this.peersList = options.peers ?? DEFAULT_PEERS;
    this.hubOnline = options.hubOnline ?? true;
    this.ackDelayMs = options.ackDelayMs ?? 800;
    this.answerDelayMs = options.answerDelayMs ?? 2500;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  send(to: MeshMessage['to'], text: string): MeshMessage {
    this.counter += 1;
    const message: MeshMessage = {
      id: `sim-${this.counter}`,
      from: SELF_PEER_ID,
      to,
      text,
      timestamp: this.now(),
    };
    if (to === HUB_PEER_ID) this.handleQuestion(message);
    return message;
  }

  subscribe(handler: IncomingMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  peers(): Peer[] {
    return this.peersList.map((peer) => ({ ...peer }));
  }

  /** Flip hub reachability at runtime (demo step 5: turn the hub's Bluetooth off). */
  setHubOnline(online: boolean): void {
    this.hubOnline = online;
  }

  private handleQuestion(question: MeshMessage): void {
    if (!this.hubOnline) return; // hub unreachable: no reply at all
    this.later(this.ackDelayMs, () => {
      this.deliver(this.hubMessage(HUB_ACK_TEXT));
      this.later(this.answerDelayMs, () => {
        this.deliver(this.hubMessage(this.answerFor(question.text)));
      });
    });
  }

  /** The mock hub's canned answer: short numbered steps plus the required label. */
  private answerFor(question: string): string {
    const firstLine = question.split('\n')[0].trim();
    return [
      `Short answer to: ${firstLine}`,
      '1. Make the scene safe before you help anyone.',
      '2. Keep the person warm, dry and still.',
      '3. Watch for changes and ask again if anything worsens.',
      HUB_ANSWER_LABEL,
    ].join('\n');
  }

  private hubMessage(text: string): MeshMessage {
    this.counter += 1;
    return {
      id: `sim-${this.counter}`,
      from: HUB_PEER_ID,
      to: SELF_PEER_ID,
      text,
      timestamp: this.now(),
    };
  }

  private deliver(message: MeshMessage): void {
    // One throwing subscriber must not starve the rest (transport contract).
    for (const handler of [...this.handlers]) {
      try {
        handler(message);
      } catch {
        // swallow: a buggy UI handler must not break mesh delivery
      }
    }
  }

  /** Test/demo helper: deliver an inbound message as if it arrived over the mesh. */
  simulateIncoming(text: string, from: PeerId = HUB_PEER_ID): MeshMessage {
    const message = this.hubMessage(text);
    if (from !== HUB_PEER_ID) {
      message.from = from;
    }
    this.deliver(message);
    return message;
  }

  private later(ms: number, fn: () => void): void {
    this.setTimeoutFn(fn, ms);
  }
}
