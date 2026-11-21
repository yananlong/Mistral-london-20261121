/*
 * design/test-transport.mjs — Node smoke test for design/transport.js.
 *
 * Run with no server:  node design/test-transport.mjs
 * Drives HubTransport through a mock fetch + mock EventSource:
 *   sent → ack → received → answer → answered
 *   no ack within HUB_ACK_TIMEOUT → unreachable → retry(id) re-POSTs → answered
 *   loc attach on send, loc/talk SSE events, peers, health, EventSource
 *   reconnect with backoff, and SimulatedTransport keyword routing.
 * Exits non-zero if any check fails.
 */
import tk from './transport.js';

const { HubTransport, SimulatedTransport, createTransport, HUB_ACK_TIMEOUT, DISCLAIMER, stripDisclaimer } = tk;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ok  ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------ mocks ------------------------------ */
const calls = [];
let failNextPost = false;
async function mockFetch(url, init) {
  calls.push({ url: String(url), init });
  const u = new URL(String(url));
  if (init && init.method === 'POST') {
    if (failNextPost) { failNextPost = false; throw new TypeError('fetch failed'); }
    return { ok: true, status: 202, json: async () => ({ status: 'accepted' }) };
  }
  if (u.pathname === '/v1/peers') return { ok: true, status: 200, json: async () => ({ peers: ['hub', 'phone-b'], hub: true }) };
  if (u.pathname === '/v1/health') return { ok: true, status: 200, json: async () => ({ ok: true, model: 'ministral-8b', inference: 'up' }) };
  return { ok: false, status: 404, json: async () => ({}) };
}
class MockEventSource {
  constructor(url) {
    this.url = String(url);
    this.handlers = {};
    this.closed = false;
    this.onopen = null; this.onerror = null;
    MockEventSource.instances.push(this);
  }
  addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); }
  emit(name, data) { (this.handlers[name] || []).forEach(fn => fn({ data: JSON.stringify(data) })); }
  close() { this.closed = true; }
}
MockEventSource.instances = [];
const es = () => MockEventSource.instances[MockEventSource.instances.length - 1];
const posts = () => calls.filter(c => c.init && c.init.method === 'POST');
const postBody = i => JSON.parse(posts()[i].init.body);

/* ------------------------------ tests ------------------------------ */
async function main() {
  console.log('transport.js smoke test');

  ok(HUB_ACK_TIMEOUT === 30000, 'HUB_ACK_TIMEOUT is 30 s (CONTRACT §2)');
  ok(/Not verified emergency advice\.$/.test(DISCLAIMER), 'DISCLAIMER matches the contract line');
  ok(stripDisclaimer('1. Boil it.\n' + DISCLAIMER) === '1. Boil it.', 'stripDisclaimer removes the trailing contract line');

  /* --- 1. Ask state machine: sent → ack → received → answer → answered --- */
  console.log('\n[1] HubTransport ask flow (sent → ack → received → answer → answered)');
  const t = new HubTransport('http://127.0.0.1:8787', {
    fetchImpl: mockFetch, EventSourceImpl: MockEventSource, ackTimeout: 60, reconnectMin: 10, reconnectMax: 40
  });
  const states = [], messages = [];
  t.onAskState((id, s) => states.push([id, s]));
  t.onMessage(m => messages.push(m));

  const id = t.send({ type: 'ask', text: 'How do I make river water safe to drink?' });
  ok(typeof id === 'string' && id.length > 0, 'send() returns an id');
  ok(t.askState(id) === 'sent', "state is 'sent' right after send");
  ok(posts().length === 1 && new URL(posts()[0].url).pathname === '/v1/ask', 'POST /v1/ask issued');
  ok(postBody(0).id === id && postBody(0).text === 'How do I make river water safe to drink?', 'POST body carries id + text');
  ok(postBody(0).loc === null, 'loc is null when not opted in (F3)');
  ok(/\/v1\/events/.test(es().url), 'EventSource opened on GET /v1/events');

  es().emit('ack', { ask_id: id, text: 'Received. Working on an answer.' });
  ok(t.askState(id) === 'received', "ack → state 'received'");
  es().emit('answer', { ask_id: id, text: '1. Boil for 1 minute.\n' + DISCLAIMER });
  ok(t.askState(id) === 'answered', "answer → state 'answered'");
  ok(messages.some(m => m.type === 'ack' && m.ask_id === id), 'onMessage delivered the ack');
  ok(messages.some(m => m.type === 'answer' && m.ask_id === id && /Boil/.test(m.text)), 'onMessage delivered the answer');
  ok(states.map(s => s[1]).join(',') === 'sent,received,answered', 'onAskState saw sent,received,answered in order');

  /* --- 2. loc attach + talk/loc posts --- */
  console.log('\n[2] loc attach (F3) and talk/loc endpoints');
  const idLoc = t.send({ type: 'ask', text: 'Is it safe here?', loc: '51.50070,-0.12460' });
  ok(postBody(1).loc === '51.50070,-0.12460', 'loc attached only when passed (opt-in)');
  t.send({ type: 'loc', loc: '51.50070,-0.12460', note: 'home' });
  t.send({ type: 'talk', text: 'hello mesh' });
  const paths = posts().map(c => new URL(c.url).pathname);
  ok(paths.includes('/v1/loc') && postBody(2).loc === '51.50070,-0.12460', 'POST /v1/loc carries loc');
  ok(paths.includes('/v1/talk') && postBody(3).text === 'hello mesh', 'POST /v1/talk carries text');
  es().emit('talk', { from: 'phone-b', text: 'hello back' });
  es().emit('loc', { from: 'phone-b', loc: '51.50100,-0.12500' });
  ok(messages.some(m => m.type === 'talk' && m.from === 'phone-b' && m.text === 'hello back'), 'SSE talk → onMessage talk');
  ok(messages.some(m => m.type === 'loc' && m.loc === '51.50100,-0.12500'), 'SSE loc → onMessage loc (map pin, F4)');
  ok(t.askState(idLoc) === 'sent', 'second ask independent of the first');

  /* --- 3. 30 s timeout → unreachable → retry re-POSTs --- */
  console.log('\n[3] ack timeout → unreachable → retry');
  const id3 = t.send({ type: 'ask', text: 'Anyone there?' });
  const before = posts().length;
  await sleep(120); /* ackTimeout is 60 ms in this test; 30 s in the browser */
  ok(t.askState(id3) === 'unreachable', "no ack within the timeout → 'unreachable'");
  const retried = t.retry(id3);
  ok(retried === id3, 'retry(id) returns the same id');
  ok(posts().length === before + 1, 'retry re-POSTs the same question');
  ok(postBody(before).id === id3 && postBody(before).text === 'Anyone there?', 'retry sends the identical body');
  ok(t.askState(id3) === 'sent', "retry → back to 'sent'");
  es().emit('ack', { ask_id: id3, text: 'Received. Working on an answer.' });
  es().emit('answer', { ask_id: id3, text: 'Yes.\n' + DISCLAIMER });
  ok(t.askState(id3) === 'answered', 'after retry, ack + answer complete the flow');

  /* --- 4. POST failure → unreachable immediately --- */
  console.log('\n[4] POST failure → unreachable');
  failNextPost = true;
  const id4 = t.send({ type: 'ask', text: 'fail case' });
  await sleep(20);
  ok(t.askState(id4) === 'unreachable', 'POST error marks the question unreachable');

  /* --- 5. peers + health --- */
  console.log('\n[5] peers() and health()');
  const peers = await t.peers();
  ok(Array.isArray(peers) && peers.includes('hub') && peers.includes('phone-b'), 'peers() → GET /v1/peers list');
  const h = await t.health();
  ok(h.ok === true && h.model === 'ministral-8b' && h.inference === 'up', 'health() → GET /v1/health payload');

  /* --- 6. EventSource reconnect with backoff --- */
  console.log('\n[6] stream error → reconnect with backoff');
  const nES = MockEventSource.instances.length;
  es().onerror && es().onerror();
  ok(es().closed === true, 'error closes the dead stream');
  await sleep(80); /* reconnectMin 10 ms, backoff 10→20→40… */
  ok(MockEventSource.instances.length > nES, 'a new EventSource was opened after backoff');

  t.close();
  ok(es().closed === true, 'close() closes the stream');

  /* --- 7. SimulatedTransport: keyword routing + timed fake answers --- */
  console.log('\n[7] SimulatedTransport (?transport=sim default)');
  const sim = new SimulatedTransport({ delayScale: 0.01 });
  const simStates = [], simMsgs = [];
  sim.onAskState((id, s) => simStates.push(s));
  sim.onMessage(m => simMsgs.push(m));
  const sid = sim.send({ type: 'ask', text: 'why is the power off?' });
  await sleep(80);
  ok(sim.askState(sid) === 'answered', 'sim ask reaches answered');
  ok(simMsgs.some(m => m.type === 'ack'), 'sim emits an ack like the hub would');
  const ans = simMsgs.find(m => m.type === 'answer');
  ok(ans && /Nobody has said yet\./.test(ans.text), 'keyword routing: "why" → the scripted "Nobody has said yet." answer');
  ok(ans && ans.text.endsWith(DISCLAIMER), 'sim answers end with the disclaimer line');
  ok(simMsgs.filter(m => m.type === 'answer').length === 2, '"why" gets the scripted follow-up answer too');
  const sid2 = sim.send({ type: 'ask', text: 'where can I get water?' });
  await sleep(80);
  ok(/Borough Market/.test((simMsgs.filter(m => m.type === 'answer').pop() || {}).text || ''), 'keyword routing: water → map answer');
  ok((await sim.peers()).length === 2, 'sim peers() resolves');
  sim.close();

  /* --- 8. factory --- */
  console.log('\n[8] createTransport() factory');
  const s = createTransport({ transport: 'sim' });
  ok(s.kind === 'sim' && s instanceof SimulatedTransport, 'default/sim → SimulatedTransport');
  const h2 = createTransport({ transport: 'hub', hub: 'http://127.0.0.1:9999' }, { fetchImpl: mockFetch, EventSourceImpl: MockEventSource, ackTimeout: 60 });
  ok(h2.kind === 'hub' && h2.baseUrl === 'http://127.0.0.1:9999', '?transport=hub&hub=… → HubTransport with that base URL');
  h2.close();
  const d = createTransport({});
  ok(d.kind === 'sim', 'no params → sim (offline design review unchanged)');

  /* ------------------------------ result ------------------------------ */
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error('SMOKE TEST FAILED'); process.exit(1); }
  console.log('SMOKE TEST PASSED');
}

main().catch(e => { console.error('SMOKE TEST CRASHED:', e); process.exit(1); });
