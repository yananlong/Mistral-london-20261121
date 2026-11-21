import { MAX_QUESTION_BYTES, normalize, prefixBytes, trim } from '../protocol';
import { MeshStore } from '../store/MeshStore';
import { AskController, AskSession } from './AskController';

/**
 * What happened to each message, in the words people see:
 * Sending (1 bar) → Delivered (2 bars) → Answered (3 bars), or Not sent yet.
 * "noAnswer" means it got through but no answer came; it tries again by itself.
 */
export type QuestionStatus = 'notSent' | 'sending' | 'delivered' | 'answered' | 'noAnswer';
export interface QuestionItem { id: number; question: string; status: QuestionStatus; answer?: string; answeredAt?: number }

/** How long a message that didn't get through waits before trying again by itself. */
export const QUESTION_RETRY_MS = 30_000;

/**
 * The conversation on the home screen. The hub takes one question at a time
 * (AskController), so later questions wait as "Not sent yet" and go by
 * themselves. Nothing here needs a tap to retry.
 */
export class QuestionThread {
  private items: QuestionItem[] = [];
  private listeners = new Set<() => void>();
  private serial = 0;
  /** Thread item currently tied to the AskController's attempt. */
  private active: { itemId: number; attemptId: number } | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void)[] = [];
  constructor(private readonly ask: AskController, private readonly mesh: MeshStore) {}

  getSnapshot = (): QuestionItem[] => this.items;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  start(): void {
    if (this.unsubscribe.length) return;
    let hub = this.mesh.getSnapshot().hubId;
    this.unsubscribe = [
      this.ask.subscribe(() => this.onSession(this.ask.getSnapshot())),
      this.mesh.subscribe(() => {
        const next = this.mesh.getSnapshot().hubId;
        if (next !== hub) { hub = next; this.pump(); }
      }),
    ];
  }

  submit(text: string): boolean {
    const question = trim(prefixBytes(normalize(text), MAX_QUESTION_BYTES));
    if (!question) return false;
    this.publish([...this.items, { id: ++this.serial, question, status: 'notSent' }]);
    this.pump();
    return true;
  }

  private publish(items: QuestionItem[]): void { this.items = items; this.listeners.forEach(listener => listener()); }
  private patch(id: number, patch: Partial<QuestionItem>): void { this.publish(this.items.map(item => item.id === id ? { ...item, ...patch } : item)); }

  /** Sends the oldest waiting question when the hub is free. */
  private pump(): void {
    const session = this.ask.getSnapshot();
    if (session.state === 'sent' || session.state === 'received') return;
    if (this.active && (session.state === 'unreachable' || session.state === 'failed')) return;
    const next = this.items.find(item => item.status === 'notSent' && item.id !== this.active?.itemId);
    if (!next) return;
    if (session.state !== 'idle') this.ask.reset();
    this.ask.submit(next.question, null);
    const now = this.ask.getSnapshot();
    if (now.state === 'sent') {
      this.active = { itemId: next.id, attemptId: now.attempt.id };
      this.patch(next.id, { status: 'sending' });
    } else this.scheduleRetry(() => this.pump());
  }

  private onSession(session: AskSession): void {
    if (!this.active || session.state === 'idle' || session.attempt.id !== this.active.attemptId) return;
    const id = this.active.itemId;
    switch (session.state) {
      case 'sent': this.patch(id, { status: 'sending' }); return;
      case 'received': this.patch(id, { status: 'delivered' }); return;
      case 'answered':
        this.active = null;
        this.patch(id, { status: 'answered', answer: session.body, answeredAt: session.finishedAt });
        this.pump();
        return;
      case 'unreachable':
      case 'failed':
        this.patch(id, { status: session.state === 'unreachable' ? 'notSent' : 'noAnswer' });
        this.scheduleRetry(() => this.ask.retry());
    }
  }

  private scheduleRetry(run: () => void): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(run, QUESTION_RETRY_MS);
  }

  dispose(): void { clearTimeout(this.retryTimer); this.unsubscribe.forEach(stop => stop()); this.unsubscribe = []; }
}
