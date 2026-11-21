import { HUB_ACK_TEXT, HUB_ANSWER_LABEL } from '../src/transport/protocol';
import { ASK_STATUS_LABEL } from '../src/ask/askStateMachine';
import { formatLocLine } from '../src/locate/locLine';

/**
 * Pins the wire strings byte-exact against BLUEPRINT_1.md's message format,
 * so a well-meaning edit breaks the build instead of the protocol.
 */
describe('protocol strings are byte-exact per BLUEPRINT_1.md', () => {
  it('pins the hub ack', () => {
    expect(HUB_ACK_TEXT).toBe('Received. Working on an answer.');
  });

  it('pins the answer disclaimer label', () => {
    expect(HUB_ANSWER_LABEL).toBe(
      'AI answer from an open-weight model on the hub. Not verified emergency advice.',
    );
  });

  it('pins the loc: line format with the blueprint example', () => {
    expect(formatLocLine({ lat: 51.5007, lon: -0.1246 })).toBe('loc: 51.50070,-0.12460');
  });

  it('pins the four Ask state labels', () => {
    expect(ASK_STATUS_LABEL).toEqual({
      sent: 'Sent',
      receivedByHub: 'Received by hub',
      answered: 'Answered',
      hubNotReachable: 'Hub not reachable',
    });
  });
});
