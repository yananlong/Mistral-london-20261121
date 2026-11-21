import { ACK_TEXT, Coordinates, HUB_EMPTY_TEXT, HUB_ERROR_TEXT } from '../protocol';
import { composeAnswer, parseQuestion } from './simulatedHub';
import { HUB_ID, SimulatedTransport } from './SimulatedTransport';
import { PeerId } from './types';

// Dev-only Android fallback: when no native BitChat mesh exists, Ask questions go
// over plain HTTP to the hub's Ollama-compatible /api/chat (via adb reverse or the
// emulator's 10.0.2.2 -> Mac localhost -> SSH tunnel -> DGX Spark). This is NOT a
// mesh. Talk/Locate stay simulated.
export const DEFAULT_HUB_URL = 'http://127.0.0.1:8081';
export const HUB_MODEL = 'ministral-3:14b-instruct-2512-fp16';
export const HUB_HTTP_TIMEOUT_MS = 110_000;
export const HUB_LINK_ERROR_PREFIX = 'Hub link error:';

export function hubUrl(): string {
  let configured: string | undefined;
  try {
    // Inlined at bundle time by babel-preset-expo; keep the literal member expression.
    // @ts-ignore process is not in this project's type roots.
    configured = process.env.EXPO_PUBLIC_HUB_URL;
  } catch { configured = undefined; }
  return (configured && configured.trim() ? configured.trim() : DEFAULT_HUB_URL).replace(/\/+$/, '');
}

export function buildChatRequest(question: string, loc: Coordinates | null) {
  const location = loc ? `\nThe person's approximate location: ${loc.lat}, ${loc.lon} (London, UK).` : '';
  return {
    model: HUB_MODEL,
    stream: false,
    // The hub shim replaces the system prompt and adds its knowledge base.
    messages: [{ role: 'system', content: 'x' }, { role: 'user', content: `${question}${location}` }],
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class HubLinkTransport extends SimulatedTransport {
  override readonly kind = 'hublink';
  readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private inflight = new Set<AbortController>();

  constructor(options: { baseUrl?: string; fetcher?: FetchLike; timeoutMs?: number } = {}) {
    super({ hubMode: 'online' });
    this.baseUrl = (options.baseUrl ?? hubUrl()).replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? HUB_HTTP_TIMEOUT_MS;
  }

  override async stop(): Promise<void> {
    this.inflight.forEach(controller => controller.abort());
    this.inflight.clear();
    await super.stop();
  }

  override async sendPrivate(to: PeerId, text: string): Promise<void> {
    if (to !== HUB_ID) return super.sendPrivate(to, text);
    this.checkRunning();
    this.checkMessage(text);
    this.sent.push({ to, text });
    const question = parseQuestion(text);
    if (question.kind === 'empty') { this.inbound(this.hubPeer, HUB_EMPTY_TEXT, 'private'); return; }
    this.inbound(this.hubPeer, ACK_TEXT, 'private');
    void this.ask(question.body, question.loc);
  }

  private async ask(question: string, loc: Coordinates | null): Promise<void> {
    const controller = new AbortController();
    this.inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}/api/chat`;
    let failure: string | null = null;
    let answer: string[] | null = null;
    try {
      const response = await this.fetcher(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildChatRequest(question, loc)), signal: controller.signal,
      });
      if (!response.ok) {
        failure = response.status === 503 ? 'HTTP 503, the hub is busy or the model is unavailable.'
          : response.status === 504 ? 'HTTP 504, the hub model timed out.'
          : `HTTP ${response.status} from the hub.`;
      } else {
        const data = await response.json() as { message?: { content?: unknown } };
        const content = typeof data?.message?.content === 'string' ? data.message.content : '';
        answer = composeAnswer(content);
        if (!answer) failure = 'the hub returned an empty answer.';
      }
    } catch {
      failure = controller.signal.aborted
        ? `no answer within ${Math.round(this.timeoutMs / 1000)} s.`
        : `cannot reach ${url}. Check adb reverse and the SSH tunnel on the Mac.`;
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
    if (!this.isRunning()) return;
    if (failure) {
      this.inbound(this.hubPeer, `${HUB_LINK_ERROR_PREFIX} ${failure}`, 'private');
      this.inbound(this.hubPeer, HUB_ERROR_TEXT, 'private');
      return;
    }
    answer!.forEach(part => this.inbound(this.hubPeer, part, 'private'));
  }
}
