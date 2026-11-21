/**
 * Per-question Ask state machine, as pure testable code.
 *
 * The four states are exactly the ones in BLUEPRINT_1.md:
 *   Sent -> Received by hub -> Answered
 *   Sent -> Hub not reachable (timeout) -> retry -> Sent
 *
 * A hub reply can arrive after the timeout on a lossy mesh, so
 * `hubNotReachable` still accepts a late `hubAck` (-> Received by hub) and a
 * late `answer` (-> Answered) instead of dropping them.
 */

export type AskStatus = 'sent' | 'receivedByHub' | 'answered' | 'hubNotReachable';

export const ASK_STATUS_LABEL: Record<AskStatus, string> = {
  sent: 'Sent',
  receivedByHub: 'Received by hub',
  answered: 'Answered',
  hubNotReachable: 'Hub not reachable',
};

export type AskEvent =
  | { type: 'hubAck' } // the hub's first reply arrived
  | { type: 'answer' } // the hub's second reply arrived
  | { type: 'timeout' } // no first reply within the timeout
  | { type: 'retry' }; // user taps Retry

export function transition(status: AskStatus, event: AskEvent): AskStatus {
  switch (event.type) {
    case 'hubAck':
      // A late ack still counts: the question did reach the hub after all.
      return status === 'sent' || status === 'hubNotReachable' ? 'receivedByHub' : status;
    case 'answer':
      // Tolerate an answer that arrives without the ack, or after the timeout.
      return status === 'sent' || status === 'receivedByHub' || status === 'hubNotReachable'
        ? 'answered'
        : status;
    case 'timeout':
      // The timeout only guards the first reply; once the hub has it, the
      // question is simply "answer still coming".
      return status === 'sent' ? 'hubNotReachable' : status;
    case 'retry':
      return status === 'hubNotReachable' ? 'sent' : status;
  }
}

/** How long the phone waits for the hub's first reply before showing "Hub not reachable". */
export const DEFAULT_HUB_TIMEOUT_MS = 30_000;

export type SetTimeoutFn = (handler: () => void, ms: number) => unknown;
export type ClearTimeoutFn = (handle: unknown) => void;

export interface AskMachineOptions {
  timeoutMs: number;
  onChange?: (status: AskStatus) => void;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
}

/** One question's lifecycle. Starts in `sent` and arms the timeout immediately. */
export class AskMachine {
  private status: AskStatus = 'sent';
  private timer: unknown = null;
  private readonly timeoutMs: number;
  private readonly onChange?: (status: AskStatus) => void;
  private readonly setTimeoutFn: SetTimeoutFn;
  private readonly clearTimeoutFn: ClearTimeoutFn;

  constructor(options: AskMachineOptions) {
    this.timeoutMs = options.timeoutMs;
    this.onChange = options.onChange;
    this.setTimeoutFn = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.arm();
  }

  get current(): AskStatus {
    return this.status;
  }

  dispatch(event: AskEvent): AskStatus {
    this.status = transition(this.status, event);
    // The timeout is armed exactly while the question is in `sent`.
    if (this.status === 'sent') this.arm();
    else this.clearTimer();
    this.onChange?.(this.status);
    return this.status;
  }

  dispose(): void {
    this.clearTimer();
  }

  private arm(): void {
    this.clearTimer();
    this.timer = this.setTimeoutFn(() => this.dispatch({ type: 'timeout' }), this.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }
}

/** One asked question as the UI holds it. */
export interface AskRecord {
  id: string;
  question: string;
  /** Exactly what went on the mesh (question, plus the loc: line if attached). */
  payload: string;
  status: AskStatus;
  answer: string | null;
  sentAt: number;
}
