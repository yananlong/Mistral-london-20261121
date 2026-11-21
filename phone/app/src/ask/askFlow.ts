/**
 * The Ask flow's non-UI logic: which questions go to the hub, when, and which
 * hub reply belongs to which question. Kept framework-free so jest can drive
 * it exactly like the screen does (PR #10 review, majors 1 and 2).
 *
 * Two rules make hub replies attributable without a correlation id on the
 * wire (the blueprint's reply strings are fixed):
 *
 * 1. One question in flight at a time. Questions asked while another is
 *    awaiting the hub are queued and sent in order once the in-flight one is
 *    answered or times out, so the hub's in-order reply stream maps 1:1 onto
 *    the phone's questions.
 * 2. A hub reply goes to the oldest question that is not answered yet —
 *    `sent`, `receivedByHub` or `hubNotReachable`. The last one matters on a
 *    lossy mesh: a reply can arrive after the timeout, and it is applied to
 *    the timed-out question (late ack -> Received by hub, late answer ->
 *    Answered) instead of being dropped.
 */

import {
  AskMachine,
  AskRecord,
  AskStatus,
  ClearTimeoutFn,
  DEFAULT_HUB_TIMEOUT_MS,
  SetTimeoutFn,
} from './askStateMachine';

export interface AskFlowItem extends AskRecord {
  machine: AskMachine;
}

export interface AskFlowSnapshot {
  items: AskFlowItem[];
  queuedCount: number;
}

export interface AskFlowOptions {
  /** Sends one question payload to the hub over the mesh. */
  sendToHub: (payload: string) => void;
  onChange?: (snapshot: AskFlowSnapshot) => void;
  timeoutMs?: number;
  now?: () => number;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
}

interface PendingAsk {
  id: string;
  question: string;
  payload: string;
}

/** Statuses that mean the hub has not answered this question yet. */
const UNANSWERED: ReadonlySet<AskStatus> = new Set(['sent', 'receivedByHub', 'hubNotReachable']);

/** Statuses that occupy the single in-flight slot. */
const IN_FLIGHT: ReadonlySet<AskStatus> = new Set(['sent', 'receivedByHub']);

export class AskFlow {
  private queue: PendingAsk[] = [];
  private items: AskFlowItem[] = [];
  private readonly machines = new Map<string, AskMachine>();
  private counter = 0;
  private readonly timeoutMs: number;
  private readonly sendToHub: (payload: string) => void;
  private readonly onChange?: (snapshot: AskFlowSnapshot) => void;
  private readonly now: () => number;
  private readonly setTimeoutFn?: SetTimeoutFn;
  private readonly clearTimeoutFn?: ClearTimeoutFn;

  constructor(options: AskFlowOptions) {
    this.sendToHub = options.sendToHub;
    this.onChange = options.onChange;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HUB_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn;
    this.clearTimeoutFn = options.clearTimeoutFn;
  }

  /** Ask a question. Queued if another one is still in flight. */
  ask(question: string, payload: string): void {
    this.counter += 1;
    this.enqueue({ id: `ask-${this.counter}`, question, payload });
  }

  /** Retry a question that is in Hub not reachable. */
  retry(id: string): void {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || item.status !== 'hubNotReachable') return;
    this.enqueue({ id: item.id, question: item.question, payload: item.payload });
  }

  /**
   * Handle one hub message. `isAck` is true for the hub's first reply
   * ("Received. Working on an answer."), false for the answer.
   */
  handleHubMessage(text: string, isAck: boolean): void {
    const id = this.oldestUnansweredId();
    if (id === null) return; // no question waiting: nothing to attach it to
    const machine = this.machines.get(id);
    if (!machine) return;
    if (isAck) {
      machine.dispatch({ type: 'hubAck' });
      return;
    }
    machine.dispatch({ type: 'answer' });
    this.updateItem(id, { answer: text });
  }

  dispose(): void {
    for (const machine of this.machines.values()) machine.dispose();
  }

  private enqueue(pending: PendingAsk): void {
    this.queue.push(pending);
    this.pump();
    this.emit();
  }

  /** Send the next queued question if the in-flight slot is free. */
  private pump(): void {
    if (this.hasInFlight()) return;
    const next = this.queue.shift();
    if (!next) return;
    this.sendNow(next);
  }

  private sendNow(pending: PendingAsk): void {
    const existing = this.machines.get(pending.id);
    if (existing) {
      // Retry of a question that timed out: back to Sent and re-sent.
      if (existing.current === 'hubNotReachable') existing.dispatch({ type: 'retry' });
    } else {
      const machine = new AskMachine({
        timeoutMs: this.timeoutMs,
        onChange: (status) => {
          this.updateItem(pending.id, { status });
          // Answered or Hub not reachable frees the slot for the next question.
          this.pump();
        },
        setTimeoutFn: this.setTimeoutFn,
        clearTimeoutFn: this.clearTimeoutFn,
      });
      this.machines.set(pending.id, machine);
      this.items.push({
        id: pending.id,
        question: pending.question,
        payload: pending.payload,
        status: machine.current,
        answer: null,
        sentAt: this.now(),
        machine,
      });
      this.emit();
    }
    this.sendToHub(pending.payload);
  }

  private hasInFlight(): boolean {
    for (const machine of this.machines.values()) {
      if (IN_FLIGHT.has(machine.current)) return true;
    }
    return false;
  }

  /** The oldest question the hub has not answered yet, if any. */
  private oldestUnansweredId(): string | null {
    for (const [id, machine] of this.machines) {
      if (UNANSWERED.has(machine.current)) return id;
    }
    return null;
  }

  private updateItem(id: string, patch: Partial<AskRecord>): void {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    this.emit();
  }

  private emit(): void {
    this.onChange?.({
      items: this.items.map((item) => ({ ...item })),
      queuedCount: this.queue.length,
    });
  }
}
