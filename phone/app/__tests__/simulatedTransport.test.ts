import {
  DEFAULT_PEERS,
  HUB_ACK_TEXT,
  HUB_ANSWER_LABEL,
  HUB_PEER_ID,
  SimulatedTransport,
} from '../src/transport/SimulatedTransport';
import { MeshMessage, PUBLIC_CHANNEL, SELF_PEER_ID } from '../src/transport/Transport';

describe('SimulatedTransport with the hub online', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('replies with the ack first and the answer second, in order', () => {
    const transport = new SimulatedTransport({ ackDelayMs: 500, answerDelayMs: 2000 });
    const received: MeshMessage[] = [];
    transport.subscribe((message) => received.push(message));

    const sent = transport.send(HUB_PEER_ID, 'How do I make water safe to drink?');
    expect(sent.from).toBe(SELF_PEER_ID);
    expect(sent.to).toBe(HUB_PEER_ID);
    expect(sent.text).toBe('How do I make water safe to drink?');
    expect(received).toHaveLength(0);

    jest.advanceTimersByTime(500);
    expect(received).toHaveLength(1);
    expect(received[0].from).toBe(HUB_PEER_ID);
    expect(received[0].to).toBe(SELF_PEER_ID);
    expect(received[0].text).toBe('Received. Working on an answer.');
    expect(received[0].text).toBe(HUB_ACK_TEXT);

    jest.advanceTimersByTime(2000);
    expect(received).toHaveLength(2);
    expect(received[1].from).toBe(HUB_PEER_ID);
    expect(received[1].text).not.toBe(HUB_ACK_TEXT);
    expect(received[1].text.endsWith(HUB_ANSWER_LABEL)).toBe(true);
    expect(received[1].timestamp).toBeGreaterThanOrEqual(received[0].timestamp);
  });

  it('does not answer public-channel or phone-to-phone messages', () => {
    const transport = new SimulatedTransport({ ackDelayMs: 100, answerDelayMs: 100 });
    const received: MeshMessage[] = [];
    transport.subscribe((message) => received.push(message));
    transport.send(PUBLIC_CHANNEL, 'hello mesh');
    transport.send('ava', 'hi ava');
    jest.advanceTimersByTime(10_000);
    expect(received).toHaveLength(0);
  });

  it('stops delivering after unsubscribe', () => {
    const transport = new SimulatedTransport({ ackDelayMs: 100, answerDelayMs: 100 });
    const received: MeshMessage[] = [];
    const unsubscribe = transport.subscribe((message) => received.push(message));
    unsubscribe();
    transport.send(HUB_PEER_ID, 'anyone there?');
    jest.advanceTimersByTime(1000);
    expect(received).toHaveLength(0);
  });

  it('exposes the peers view, including the hub as a peer', () => {
    const transport = new SimulatedTransport({});
    const peers = transport.peers();
    expect(peers).toEqual(DEFAULT_PEERS);
    expect(peers.some((peer) => peer.id === HUB_PEER_ID && peer.kind === 'hub')).toBe(true);
  });

  it('can be built with no peers, for the no-one-nearby state', () => {
    const transport = new SimulatedTransport({ peers: [] });
    expect(transport.peers()).toEqual([]);
  });
});

describe('SimulatedTransport with the hub unreachable', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends but gets no reply at all, so the timeout state can be exercised', () => {
    const transport = new SimulatedTransport({
      hubOnline: false,
      ackDelayMs: 100,
      answerDelayMs: 100,
    });
    const received: MeshMessage[] = [];
    transport.subscribe((message) => received.push(message));
    transport.send(HUB_PEER_ID, 'Is anyone there?');
    jest.advanceTimersByTime(60_000);
    expect(received).toHaveLength(0);
  });

  it('can go unreachable at runtime and come back, as in demo step 5', () => {
    const transport = new SimulatedTransport({ ackDelayMs: 100, answerDelayMs: 100 });
    const received: MeshMessage[] = [];
    transport.subscribe((message) => received.push(message));

    transport.setHubOnline(false);
    transport.send(HUB_PEER_ID, 'first question');
    jest.advanceTimersByTime(1000);
    expect(received).toHaveLength(0);

    transport.setHubOnline(true);
    transport.send(HUB_PEER_ID, 'second question');
    jest.advanceTimersByTime(100);
    expect(received.map((message) => message.text)).toEqual([HUB_ACK_TEXT]);
    jest.advanceTimersByTime(100);
    expect(received).toHaveLength(2);
    expect(received[1].text.endsWith(HUB_ANSWER_LABEL)).toBe(true);
  });
});
