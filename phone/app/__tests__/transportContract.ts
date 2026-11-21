import { MeshMessage, Peer, PUBLIC_CHANNEL, SELF_PEER_ID, Transport } from '../src/transport/Transport';
import { SimulatedTransport } from '../src/transport/SimulatedTransport';

/**
 * Transport conformance contract. Run against ANY Transport implementation:
 * today SimulatedTransport; when the BitChat native module lands, add one line
 * `describeTransportContract(() => new BitChatTransport())` and it must pass
 * unchanged. This is the gate for swapping the simulated mesh for the real one.
 *
 * Note: the inbound-delivery cases use SimulatedTransport.simulateIncoming as
 * the injection point; a native transport should expose the same test hook.
 */
export function describeTransportContract(makeTransport: () => Transport): void {
  it('send() returns the sent message with self as from, text byte-identical, unique ids', () => {
    const t = makeTransport();
    const a = t.send(PUBLIC_CHANNEL, 'hello 🌍\nsecond line');
    const b = t.send('peer-1', 'second');
    expect(a.from).toBe(SELF_PEER_ID);
    expect(a.to).toBe(PUBLIC_CHANNEL);
    expect(a.text).toBe('hello 🌍\nsecond line');
    expect(b.from).toBe(SELF_PEER_ID);
    expect(b.to).toBe('peer-1');
    expect(Number.isFinite(a.timestamp)).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  it('does not synchronously self-echo the sent message to subscribers', () => {
    const t = makeTransport();
    const received: MeshMessage[] = [];
    t.subscribe((m) => received.push(m));
    t.send(PUBLIC_CHANNEL, 'ping');
    expect(received).toHaveLength(0);
  });

  it('send() to an absent/unreachable peer does not throw (failure surfaces via Ask timeout)', () => {
    const t = makeTransport();
    expect(() => t.send('no-such-peer', 'are you there?')).not.toThrow();
  });

  it('subscribe delivers to all subscribers; unsubscribe stops delivery and is idempotent', () => {
    const t = makeTransport() as SimulatedTransport;
    const a: MeshMessage[] = [];
    const b: MeshMessage[] = [];
    const unA = t.subscribe((m) => a.push(m));
    t.subscribe((m) => b.push(m));
    t.simulateIncoming('hi', 'ava');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    unA();
    unA(); // idempotent
    t.simulateIncoming('again', 'ava');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('a throwing subscriber does not starve the other subscribers', () => {
    const t = makeTransport() as SimulatedTransport;
    const got: MeshMessage[] = [];
    t.subscribe(() => {
      throw new Error('buggy handler');
    });
    t.subscribe((m) => got.push(m));
    t.simulateIncoming('hello', 'ava');
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe('hello');
  });

  it('peers() returns well-formed peers, exactly one hub, and a copy (mutation must not leak)', () => {
    const t = makeTransport();
    const peers: Peer[] = t.peers();
    expect(peers.length).toBeGreaterThan(0);
    for (const p of peers) {
      expect(['phone', 'hub']).toContain(p.kind);
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
    }
    expect(peers.filter((p) => p.kind === 'hub')).toHaveLength(1);
    peers[0].id = 'MUTATED';
    expect(t.peers()[0].id).not.toBe('MUTATED');
  });
}
