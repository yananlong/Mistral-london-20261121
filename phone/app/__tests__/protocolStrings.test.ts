import * as fs from 'fs';
import * as path from 'path';
import { HUB_ACK_TEXT, HUB_ANSWER_LABEL } from '../src/transport/SimulatedTransport';

/**
 * The wire protocol strings must match hub/responder.py exactly (the hub is
 * the other end of the mesh). scripts/check_phone_hub_protocol.sh and
 * hub/test_contract_phone.py enforce the same equality from the Python side.
 */

const RESPONDER_PY = path.resolve(__dirname, '..', '..', '..', 'hub', 'responder.py');

function pyConst(name: string): string {
  const src = fs.readFileSync(RESPONDER_PY, 'utf8');
  const m = src.match(new RegExp('^' + name + ' = "((?:[^"\\\\]|\\\\.)*)"', 'm'));
  if (!m) throw new Error(`constant ${name} not found in responder.py`);
  return m[1];
}

describe('hub protocol strings (BLUEPRINT_1.md message format)', () => {
  it('ack text is the blueprint ack and equals hub ACK', () => {
    expect(HUB_ACK_TEXT).toBe('Received. Working on an answer.');
    expect(HUB_ACK_TEXT).toBe(pyConst('ACK'));
  });

  it('answer label is the blueprint disclaimer and equals hub DISCLAIMER', () => {
    expect(HUB_ANSWER_LABEL).toBe(
      'AI answer from an open-weight model on the hub. Not verified emergency advice.'
    );
    expect(HUB_ANSWER_LABEL).toBe(pyConst('DISCLAIMER'));
  });
});
