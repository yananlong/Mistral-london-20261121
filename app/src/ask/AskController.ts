import { AnswerPart, assembleAnswer, classifyHubReply, Coordinates, encodeQuestion, MAX_MESSAGE_BYTES, MAX_QUESTION_BYTES, normalize, trim, utf8Bytes } from '../protocol';
import { config } from '../config';
import { MeshStore } from '../store/MeshStore';
import { InboundMessage, PeerId } from '../transport/types';
import { AskEvent, askReducer } from './machine';

/** `askedAt` is when the person asked (fixed); `startedAt` restarts on every retry. */
interface Attempt { id: number; question: string; wire: string; to: PeerId; askedAt: number; startedAt: number }
interface AnswerProgress { received: number; total: number }
interface ActiveAttempt { attempt: Attempt; progress: AnswerProgress | null }
export type AskSession =
  | { state: 'idle' }
  /** Not sent yet: no hub has been seen. It goes by itself as soon as one is. */
  | { state: 'queued'; id: number; question: string; location: Coordinates | null; queuedAt: number }
  | ({ state: 'sent' | 'received' } & ActiveAttempt)
  | ({ state: 'unreachable' | 'failed'; finishedAt: number } & ActiveAttempt)
  | ({ state: 'answered'; finishedAt: number; body: string } & ActiveAttempt);
export type FinishedAsk = ({ state: 'failed'; finishedAt: number } & ActiveAttempt) | ({ state: 'answered'; finishedAt: number; body: string } & ActiveAttempt);

/**
 * One question at a time travels to the hub (the wire protocol has no question
 * id, so answers can only be matched to the question in flight). Finished
 * questions move to `history`, so the home screen reads as one thread.
 *
 * The app keeps trying by itself (design/PRINCIPLES.md): a question with no hub
 * yet waits as `queued`; an unacknowledged one is retried every
 * `config.retryIntervalMs`, and at once when the hub comes back in range.
 */
export class AskController {
  private session: AskSession = { state: 'idle' };
  private history: FinishedAsk[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private parts: AnswerPart[] = [];
  private serial = 0;
  private hubWasReachable = false;
  constructor(private readonly mesh: MeshStore) {}
  getSnapshot = (): AskSession => this.session;
  getHistory = (): FinishedAsk[] => this.history;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private notify(): void { this.listeners.forEach(listener => listener()); }
  private publish(session: AskSession): void {
    clearTimeout(this.timer);
    this.session = session;
    if (session.state === 'sent') this.timer = setTimeout(() => this.transition('ack_timeout'), config.ackTimeoutMs);
    if (session.state === 'received') this.timer = setTimeout(() => this.transition('answer_timeout'), config.answerTimeoutMs);
    if (session.state === 'unreachable') this.timer = setTimeout(() => this.retry(), config.retryIntervalMs);
    this.notify();
  }
  private transition(event: AskEvent, body = ''): void {
    const previous = this.session;
    if (previous.state === 'queued') return;
    const state = askReducer(previous.state, event);
    if (state === previous.state) return;
    if (state === 'idle') { this.publish({ state }); return; }
    if (previous.state === 'idle') return;
    const active = { attempt: previous.attempt, progress: previous.progress };
    if (state === 'answered') this.publish({ state, ...active, body, finishedAt: Date.now() });
    else if (state === 'unreachable' || state === 'failed') this.publish({ state, ...active, finishedAt: Date.now() });
    else this.publish({ state, ...active });
  }

  /** True while a question is still on its way, so a new one has to wait. */
  get busy(): boolean { return ['queued', 'sent', 'received', 'unreachable'].includes(this.session.state); }

  /**
   * Ask from the home screen: files the last finished question in the thread,
   * then sends this one, or queues it if no hub has been seen yet.
   * Returns false if the question is empty, too long, or another is on its way.
   */
  ask(text: string, location: Coordinates | null): boolean {
    const question = trim(normalize(text));
    if (!question || utf8Bytes(question) > MAX_QUESTION_BYTES || this.busy) return false;
    if (utf8Bytes(encodeQuestion(question, location)) > MAX_MESSAGE_BYTES) return false;
    const done = this.session;
    if (done.state === 'answered') this.history = [...this.history, done];
    else if (done.state === 'failed') this.history = [...this.history, { ...done, state: 'failed' }];
    this.parts = [];
    this.session = { state: 'idle' };
    const to = this.mesh.getSnapshot().hubId;
    if (!to) { this.publish({ state: 'queued', id: ++this.serial, question, location, queuedAt: Date.now() }); return true; }
    this.start(question, location, to, ++this.serial);
    return true;
  }

  /** Low-level send used by tests and the protocol contract: needs a known hub and an idle session. */
  submit(text: string, location: Coordinates | null): void {
    const to = this.mesh.getSnapshot().hubId;
    const question = trim(normalize(text));
    if (!to || !question || utf8Bytes(question) > MAX_QUESTION_BYTES || this.session.state !== 'idle') return;
    this.start(question, location, to, ++this.serial);
  }

  private start(question: string, location: Coordinates | null, to: PeerId, id: number, askedAt = Date.now()): void {
    const wire = encodeQuestion(question, location);
    if (utf8Bytes(wire) > MAX_MESSAGE_BYTES) return;
    const attempt: Attempt = { id, question, wire, to, askedAt, startedAt: Date.now() };
    this.parts = [];
    this.publish({ state: 'sent', attempt, progress: null });
    this.send(attempt);
  }
  private send(attempt: Attempt): void {
    void this.mesh.send(attempt.to, attempt.wire).catch(() => {
      if (this.session.state === 'sent' && this.session.attempt === attempt) this.transition('ack_timeout');
    });
  }
  retry(): void {
    const previous = this.session;
    if (previous.state === 'idle' || previous.state === 'queued' || askReducer(previous.state, 'retry') !== 'sent' || (previous.state !== 'unreachable' && previous.state !== 'failed')) return;
    const attempt = { ...previous.attempt, startedAt: Date.now() };
    this.parts = [];
    this.publish({ state: 'sent', attempt, progress: null });
    this.send(attempt);
  }
  /** Take back a question that has not got through. The user stays in control. */
  cancel(): void {
    if (this.session.state === 'queued' || this.session.state === 'unreachable') { this.parts = []; this.publish({ state: 'idle' }); }
  }
  reset(): void {
    if (this.session.state === 'queued') { this.cancel(); return; }
    if (askReducer(this.session.state, 'reset') === 'idle') this.parts = [];
    this.transition('reset');
  }
  /** Called after every mesh change: sends a queued question once a hub is known, and retries when the hub comes back. */
  flush(): void {
    const mesh = this.mesh.getSnapshot();
    const session = this.session;
    const hubId = session.state === 'idle' || session.state === 'queued' ? mesh.hubId : session.attempt.to;
    const reachable = mesh.link === 'running' && mesh.peers.some(peer => peer.id === hubId && peer.reachable);
    const cameBack = reachable && !this.hubWasReachable;
    this.hubWasReachable = reachable;
    if (session.state === 'queued' && mesh.hubId && mesh.link === 'running') this.start(session.question, session.location, mesh.hubId, session.id, session.queuedAt);
    else if (session.state === 'unreachable' && cameBack) this.retry();
  }
  receive(message: InboundMessage): void {
    const session = this.session;
    if (session.state === 'idle' || session.state === 'queued' || session.state === 'answered' || message.from !== session.attempt.to || message.channel !== 'private') return;
    const reply = classifyHubReply(message.text);
    if (reply.kind === 'answer_part') {
      this.parts = this.parts.filter(part => part.index !== reply.index || part.total !== reply.total);
      this.parts.push({ index: reply.index, total: reply.total, text: reply.text });
      const body = assembleAnswer(this.parts);
      if (body !== null) { this.transition('answer', body); return; }
      const received = this.parts.filter(part => part.total === reply.total).length;
      this.session = { ...session, progress: { received, total: reply.total } };
      this.notify();
    } else if (reply.kind !== 'other') this.transition(reply.kind);
  }
  dispose(): void { clearTimeout(this.timer); }
}
