import { ACK_TIMEOUT_MS, ANSWER_TIMEOUT_MS, classifyHubReply, Coordinates, encodeQuestion, MAX_QUESTION_UNITS, prefixUnits } from '../protocol';
import { MeshStore } from '../store/MeshStore';
import { InboundMessage, PeerId } from '../transport/types';
import { AskEvent, askReducer } from './machine';

interface Attempt { question: string; wire: string; to: PeerId; startedAt: number }
export type AskSession =
  | { state: 'idle' }
  | { state: 'sent' | 'received'; attempt: Attempt }
  | { state: 'unreachable' | 'failed'; attempt: Attempt; finishedAt: number }
  | { state: 'answered'; attempt: Attempt; finishedAt: number; body: string };

export class AskController {
  private session: AskSession = { state: 'idle' };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly mesh: MeshStore) {}
  getSnapshot = (): AskSession => this.session;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(session: AskSession): void {
    clearTimeout(this.timer);
    this.session = session;
    if (session.state === 'sent') this.timer = setTimeout(() => this.transition('ack_timeout'), ACK_TIMEOUT_MS);
    if (session.state === 'received') this.timer = setTimeout(() => this.transition('answer_timeout'), ANSWER_TIMEOUT_MS);
    this.listeners.forEach(listener => listener());
  }
  private transition(event: AskEvent, body = ''): void {
    const previous = this.session;
    const state = askReducer(previous.state, event);
    if (state === previous.state) return;
    if (state === 'idle') { this.publish({ state }); return; }
    if (previous.state === 'idle') return;
    if (state === 'answered') this.publish({ state, attempt: previous.attempt, body, finishedAt: Date.now() });
    else if (state === 'unreachable' || state === 'failed') this.publish({ state, attempt: previous.attempt, finishedAt: Date.now() });
    else this.publish({ state, attempt: previous.attempt });
  }
  submit(text: string, location: Coordinates | null): void {
    const to = this.mesh.getSnapshot().hubId;
    const question = prefixUnits(text.trim(), MAX_QUESTION_UNITS);
    if (!to || !question || askReducer(this.session.state, 'submit') !== 'sent' || this.session.state !== 'idle') return;
    const attempt: Attempt = { question, wire: encodeQuestion(question, location), to, startedAt: Date.now() };
    this.publish({ state: 'sent', attempt });
    this.send(attempt);
  }
  private send(attempt: Attempt): void {
    void this.mesh.send(attempt.to, attempt.wire).catch(() => {
      if (this.session.state === 'sent' && this.session.attempt === attempt) this.transition('ack_timeout');
    });
  }
  retry(): void {
    const previous = this.session;
    if (previous.state === 'idle' || askReducer(previous.state, 'retry') !== 'sent' || (previous.state !== 'unreachable' && previous.state !== 'failed')) return;
    const attempt = { ...previous.attempt, startedAt: Date.now() };
    this.publish({ state: 'sent', attempt });
    this.send(attempt);
  }
  reset(): void { this.transition('reset'); }
  receive(message: InboundMessage): void {
    const session = this.session;
    if (session.state === 'idle' || message.from !== session.attempt.to || message.channel !== 'private') return;
    const reply = classifyHubReply(message.text);
    if (reply.kind !== 'other') this.transition(reply.kind, reply.kind === 'answer' ? reply.body : '');
  }
  dispose(): void { clearTimeout(this.timer); }
}
