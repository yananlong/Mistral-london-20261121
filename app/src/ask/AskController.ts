import { ACK_TIMEOUT_MS, ANSWER_TIMEOUT_MS, AnswerPart, assembleAnswer, classifyHubReply, Coordinates, encodeQuestion, MAX_MESSAGE_BYTES, MAX_QUESTION_BYTES, normalize, utf8Bytes } from '../protocol';
import { MeshStore } from '../store/MeshStore';
import { InboundMessage, PeerId } from '../transport/types';
import { AskEvent, askReducer } from './machine';

interface Attempt { question: string; wire: string; to: PeerId; startedAt: number }
interface AnswerProgress { received: number; total: number }
interface ActiveAttempt { attempt: Attempt; progress: AnswerProgress | null }
export type AskSession =
  | { state: 'idle' }
  | ({ state: 'sent' | 'received' } & ActiveAttempt)
  | ({ state: 'unreachable' | 'failed'; finishedAt: number } & ActiveAttempt)
  | ({ state: 'answered'; finishedAt: number; body: string } & ActiveAttempt);

export class AskController {
  private session: AskSession = { state: 'idle' };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private parts: AnswerPart[] = [];
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
    const active = { attempt: previous.attempt, progress: previous.progress };
    if (state === 'answered') this.publish({ state, ...active, body, finishedAt: Date.now() });
    else if (state === 'unreachable' || state === 'failed') this.publish({ state, ...active, finishedAt: Date.now() });
    else this.publish({ state, ...active });
  }
  submit(text: string, location: Coordinates | null): void {
    const to = this.mesh.getSnapshot().hubId;
    const question = normalize(text).trim();
    if (!to || !question || utf8Bytes(question) > MAX_QUESTION_BYTES || askReducer(this.session.state, 'submit') !== 'sent' || this.session.state !== 'idle') return;
    const wire = encodeQuestion(question, location);
    if (utf8Bytes(wire) > MAX_MESSAGE_BYTES) return;
    const attempt: Attempt = { question, wire, to, startedAt: Date.now() };
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
    if (previous.state === 'idle' || askReducer(previous.state, 'retry') !== 'sent' || (previous.state !== 'unreachable' && previous.state !== 'failed')) return;
    const attempt = { ...previous.attempt, startedAt: Date.now() };
    this.parts = [];
    this.publish({ state: 'sent', attempt, progress: null });
    this.send(attempt);
  }
  reset(): void {
    if (askReducer(this.session.state, 'reset') === 'idle') this.parts = [];
    this.transition('reset');
  }
  receive(message: InboundMessage): void {
    const session = this.session;
    if (session.state === 'idle' || session.state === 'answered' || message.from !== session.attempt.to || message.channel !== 'private') return;
    const reply = classifyHubReply(message.text);
    if (reply.kind === 'answer_part') {
      this.parts = this.parts.filter(part => part.index !== reply.index || part.total !== reply.total);
      this.parts.push({ index: reply.index, total: reply.total, text: reply.text });
      const body = assembleAnswer(this.parts);
      if (body !== null) { this.transition('answer', body); return; }
      const received = this.parts.filter(part => part.total === reply.total).length;
      this.session = { ...session, progress: { received, total: reply.total } };
      this.listeners.forEach(listener => listener());
    } else if (reply.kind !== 'other') this.transition(reply.kind);
  }
  dispose(): void { clearTimeout(this.timer); }
}
