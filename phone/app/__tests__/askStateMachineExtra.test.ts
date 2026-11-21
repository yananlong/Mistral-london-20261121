import { AskMachine, transition } from '../src/ask/askStateMachine';

describe('ask state machine edge cases (pure transition table)', () => {
  it('duplicate answer on answered is a no-op', () => {
    expect(transition('answered', { type: 'answer' })).toBe('answered');
  });

  it('duplicate ack on receivedByHub is a no-op', () => {
    expect(transition('receivedByHub', { type: 'hubAck' })).toBe('receivedByHub');
  });

  it('retry while still sent is a no-op', () => {
    expect(transition('sent', { type: 'retry' })).toBe('sent');
  });

  it('timeout only guards the first reply (ack), not the answer', () => {
    expect(transition('receivedByHub', { type: 'timeout' })).toBe('receivedByHub');
    expect(transition('answered', { type: 'timeout' })).toBe('answered');
  });

  it('an answer without ack is tolerated (sent -> answered)', () => {
    expect(transition('sent', { type: 'answer' })).toBe('answered');
  });

  it('full cycle: sent -> timeout -> hubNotReachable -> retry -> sent -> ack -> receivedByHub -> answer -> answered', () => {
    let s = transition('sent', { type: 'timeout' });
    expect(s).toBe('hubNotReachable');
    s = transition(s, { type: 'retry' });
    expect(s).toBe('sent');
    s = transition(s, { type: 'hubAck' });
    expect(s).toBe('receivedByHub');
    s = transition(s, { type: 'answer' });
    expect(s).toBe('answered');
  });
});

describe('AskMachine timers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('timeout fires once while sent and moves to hubNotReachable', () => {
    const m = new AskMachine({ timeoutMs: 1000 });
    expect(m.current).toBe('sent');
    jest.advanceTimersByTime(1000);
    expect(m.current).toBe('hubNotReachable');
    jest.advanceTimersByTime(60_000);
    expect(m.current).toBe('hubNotReachable'); // timer cleared, does not re-fire
    m.dispose();
  });

  it('ack before timeout clears the timer (answer-still-coming, no hubNotReachable)', () => {
    const m = new AskMachine({ timeoutMs: 1000 });
    m.dispatch({ type: 'hubAck' });
    expect(m.current).toBe('receivedByHub');
    jest.advanceTimersByTime(60_000);
    expect(m.current).toBe('receivedByHub');
    m.dispose();
  });

  it('retry re-arms the timeout', () => {
    const m = new AskMachine({ timeoutMs: 1000 });
    jest.advanceTimersByTime(1000);
    expect(m.current).toBe('hubNotReachable');
    m.dispatch({ type: 'retry' });
    expect(m.current).toBe('sent');
    jest.advanceTimersByTime(1000);
    expect(m.current).toBe('hubNotReachable');
    m.dispose();
  });
});
