import * as fs from 'fs';
import * as path from 'path';
import {
  HUB_ACK_TEXT,
  HUB_ANSWER_LABEL,
  HUB_PEER_ID,
  SimulatedTransport,
} from '../src/transport/SimulatedTransport';
import { LOC_LINE_RE_TS } from '../src/locate/locLine';
import { AskMachine } from '../src/ask/askStateMachine';
import { MeshMessage, SELF_PEER_ID } from '../src/transport/Transport';
import { assembleAnswer, classifyHubReply, MAX_MESSAGE_BYTES, utf8Bytes } from '../src/ask/meshMessages';

/** The simulated hub's answer, reassembled from its "(i/n) " parts like the real hub's. */
function answerFrom(messages: MeshMessage[]): string | null {
  const parts = messages.map((m) => {
    expect(utf8Bytes(m.text)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    const reply = classifyHubReply(m.text);
    if (reply.kind !== 'answer_part') throw new Error(`not an answer part: ${m.text}`);
    return reply;
  });
  return assembleAnswer(parts);
}

/**
 * Contract between phone/app and hub/responder.py. The hub side is read from
 * the Python source so this test fails if either side drifts (mirrors
 * hub/test_contract_phone.py on the hub side, and scripts/check_*.sh).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RESPONDER_PY = path.join(REPO_ROOT, 'hub', 'responder.py');
const ASK_CASES = path.join(REPO_ROOT, 'phone', 'test', 'golden', 'ask_cases.json');

function pyConst(name: string): string {
  const src = fs.readFileSync(RESPONDER_PY, 'utf8');
  const m = src.match(new RegExp('^' + name + ' = "((?:[^"\\\\]|\\\\.)*)"', 'm'));
  if (!m) throw new Error(`constant ${name} not found in responder.py`);
  return m[1];
}

describe('phone app <-> hub responder wire contract', () => {
  it('ack text equals hub ACK', () => {
    expect(HUB_ACK_TEXT).toBe(pyConst('ACK'));
    expect(HUB_ACK_TEXT).toBe('Received. Working on an answer.');
  });

  it('answer label equals hub DISCLAIMER', () => {
    expect(HUB_ANSWER_LABEL).toBe(pyConst('DISCLAIMER'));
  });

  it('loc: grammar matches hub LOC_LINE_RE on a sample battery', () => {
    const src = fs.readFileSync(RESPONDER_PY, 'utf8');
    const m = src.match(/LOC_LINE_RE = re\.compile\(\s*r"((?:[^"\\]|\\.)*)",\s*re\.([A-Z]+)\s*\)/);
    if (!m) throw new Error('LOC_LINE_RE not found in responder.py');
    const hubRe = new RegExp(m[1], m[2].includes('IGNORECASE') ? 'i' : '');
    const samples = [
      'loc: 51.50070,-0.12460', 'LOC:  51.50 , -0.12 ', 'loc:51.5,-0.1',
      'loc: -90,180', 'loc: 90.00001,-0.1', 'loc: 0x33,0', 'loc: 5e1,0',
      'loc: NaN,0', 'loc: +51.5,-0.1', 'myloc: 1,2', 'loc: 1', 'hello',
    ];
    for (const s of samples) {
      expect(LOC_LINE_RE_TS.test(s.trim())).toBe(hubRe.test(s.trim()));
    }
  });
});

describe('golden ask_cases.json against the simulated hub (same protocol as the real hub)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const cases = JSON.parse(fs.readFileSync(ASK_CASES, 'utf8')).cases;

  it('every case: ack first (== hub ACK), then an answer ending with the label', () => {
    for (const c of cases) {
      if (c.expect_http_status) continue; // validation cases are hub-side (hub/test_contract_phone.py)
      const transport = new SimulatedTransport({ ackDelayMs: 100, answerDelayMs: 500 });
      const received: MeshMessage[] = [];
      transport.subscribe((msg) => received.push(msg));
      const machine = new AskMachine({ timeoutMs: 30_000 });

      const sent = transport.send(HUB_PEER_ID, c.question);
      expect(sent.from).toBe(SELF_PEER_ID);
      expect(sent.to).toBe(HUB_PEER_ID);
      expect(sent.text).toBe(c.question);
      expect(machine.current).toBe('sent');

      jest.advanceTimersByTime(100);
      expect(received).toHaveLength(1);
      expect(received[0].text).toBe(pyConst('ACK'));
      machine.dispatch({ type: 'hubAck' });
      expect(machine.current).toBe('receivedByHub');

      jest.advanceTimersByTime(500);
      const answerParts = received.slice(1);
      const last = answerParts[answerParts.length - 1].text;
      expect(last.endsWith(HUB_ANSWER_LABEL)).toBe(true);
      expect(last.endsWith(pyConst('DISCLAIMER'))).toBe(true);
      expect(answerFrom(answerParts)).not.toBeNull();
      machine.dispatch({ type: 'answer' });
      expect(machine.current).toBe('answered');
      machine.dispose();
    }
  });

  it('hub offline: no reply, timeout -> hubNotReachable -> retry -> sent', () => {
    const transport = new SimulatedTransport({ hubOnline: false });
    const received: MeshMessage[] = [];
    transport.subscribe((msg) => received.push(msg));
    const machine = new AskMachine({ timeoutMs: 1000 });
    transport.send(HUB_PEER_ID, 'Is the water safe here?');
    jest.advanceTimersByTime(1000);
    expect(received).toHaveLength(0);
    machine.dispatch({ type: 'timeout' });
    expect(machine.current).toBe('hubNotReachable');
    machine.dispatch({ type: 'retry' });
    expect(machine.current).toBe('sent');
    machine.dispose();
  });
});
