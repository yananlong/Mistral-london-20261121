import { ACK_TEXT, HUB_ERROR_TEXT } from '../src/protocol';
import { buildChatRequest, HUB_LINK_ERROR_PREFIX, HubLinkTransport } from '../src/transport/HubLinkTransport';
import { HUB_ID } from '../src/transport/SimulatedTransport';
import { TransportEvent } from '../src/transport/types';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function collect(transport: HubLinkTransport): string[] {
  const texts: string[] = [];
  transport.subscribe((event: TransportEvent) => { if (event.type === 'message') texts.push(event.message.text); });
  return texts;
}

test('the chat request matches the hub shape, with and without a location', () => {
  expect(buildChatRequest('Q?', { lat: 51.5, lon: -0.12 })).toEqual({
    model: 'ministral-3:14b-instruct-2512-fp16', stream: false,
    messages: [{ role: 'system', content: 'x' }, { role: 'user', content: "Q?\nThe person's approximate location: 51.5, -0.12 (London, UK)." }],
  });
  expect(buildChatRequest('Q?', null).messages[1].content).toBe('Q?');
});

test('a hub answer is posted to /api/chat and comes back as labelled parts', async () => {
  const calls: { url: string; body: string }[] = [];
  const transport = new HubLinkTransport({
    baseUrl: 'http://127.0.0.1:8081/',
    fetcher: async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, status: 200, json: async () => ({ message: { content: '1. Boil water.' } }) }; },
  });
  const texts = collect(transport);
  await transport.start('Phone A');
  await transport.sendPrivate(HUB_ID, 'How do I make water safe?');
  await flush();
  expect(calls[0].url).toBe('http://127.0.0.1:8081/api/chat');
  expect(JSON.parse(calls[0].body).messages[1].content).toBe('How do I make water safe?');
  expect(texts[0]).toBe(ACK_TEXT);
  expect(texts[1]).toBe('(1/2) 1. Boil water.');
  expect(texts).toHaveLength(3);
});

test('an HTTP 504 shows a clear error and the hub error text', async () => {
  const transport = new HubLinkTransport({ baseUrl: 'http://h', fetcher: async () => ({ ok: false, status: 504, json: async () => ({}) }) });
  const texts = collect(transport);
  await transport.start('Phone A');
  await transport.sendPrivate(HUB_ID, 'Help');
  await flush();
  expect(texts[1].startsWith(HUB_LINK_ERROR_PREFIX)).toBe(true);
  expect(texts[1]).toContain('504');
  expect(texts[2]).toBe(HUB_ERROR_TEXT);
});

test('a network failure is reported as unreachable', async () => {
  const transport = new HubLinkTransport({ baseUrl: 'http://h', fetcher: async () => { throw new Error('Network request failed'); } });
  const texts = collect(transport);
  await transport.start('Phone A');
  await transport.sendPrivate(HUB_ID, 'Help');
  await flush();
  expect(texts[1]).toContain('cannot reach http://h/api/chat');
  expect(texts[2]).toBe(HUB_ERROR_TEXT);
});
