import { ApiClient, ApiUnavailableError } from '../src/api/client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('ApiClient', () => {
  it('is unavailable in the offline MVP build and fails loudly', async () => {
    const client = new ApiClient({ baseUrl: null, timeoutMs: 1000 });
    expect(client.available).toBe(false);
    await expect(client.get('/alerts')).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('GETs JSON from the configured base URL', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { alerts: [] });
    }) as typeof fetch;
    const client = new ApiClient({ baseUrl: 'https://backend.example/', timeoutMs: 1000, fetchFn });
    const result = await client.get<{ alerts: unknown[] }>('/v1/alerts');
    expect(result).toEqual({ alerts: [] });
    expect(calls[0].url).toBe('https://backend.example/v1/alerts');
    expect(calls[0].init?.method).toBe('GET');
  });

  it('POSTs a JSON body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(201, { ok: true });
    }) as typeof fetch;
    const client = new ApiClient({ baseUrl: 'https://backend.example', timeoutMs: 1000, fetchFn });
    await client.post('/v1/safe', { note: "I'm safe" });
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe(JSON.stringify({ note: "I'm safe" }));
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('throws on a non-2xx response', async () => {
    const fetchFn = (async () => jsonResponse(500, {})) as typeof fetch;
    const client = new ApiClient({ baseUrl: 'https://backend.example', timeoutMs: 1000, fetchFn });
    await expect(client.get('/v1/alerts')).rejects.toThrow(/HTTP 500/);
  });

  it('aborts after the configured timeout', async () => {
    const fetchFn = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const client = new ApiClient({ baseUrl: 'https://backend.example', timeoutMs: 50, fetchFn });
    await expect(client.get('/v1/alerts')).rejects.toThrow(/aborted/);
  });
});
