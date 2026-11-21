import { config } from '../config';

/**
 * Minimal typed HTTP client for the post-MVP backend (live alerts, flood
 * warnings, "I'm safe" relay — README.md "Live information ... come after
 * the MVP").
 *
 * The MVP is offline-first and never calls this: `config.apiBaseUrl` is null
 * in the MVP build and any call fails loudly instead of leaking to a network
 * the demo phones do not have. When the backend team ships an endpoint, set
 * apiBaseUrl in src/config.ts and use this client from the screens.
 */

export class ApiUnavailableError extends Error {
  constructor(message = 'No backend configured: config.apiBaseUrl is null (offline MVP build).') {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

export interface ApiClientOptions {
  baseUrl: string | null;
  timeoutMs: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** Shared client wired to src/config.ts. */
  static fromConfig(): ApiClient {
    return new ApiClient({ baseUrl: config.apiBaseUrl, timeoutMs: config.apiTimeoutMs });
  }

  get available(): boolean {
    return this.baseUrl !== null;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.baseUrl) throw new ApiUnavailableError();
    const url = `${this.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Backend ${method} ${path} failed: HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
