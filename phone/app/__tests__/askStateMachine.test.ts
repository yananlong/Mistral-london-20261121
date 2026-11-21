import {
  AskMachine,
  ASK_STATUS_LABEL,
  DEFAULT_HUB_TIMEOUT_MS,
  transition,
} from '../src/ask/askStateMachine';

describe('transition covers all four states', () => {
  it('walks Sent -> Received by hub -> Answered', () => {
    expect(transition('sent', { type: 'hubAck' })).toBe('receivedByHub');
    expect(transition('receivedByHub', { type: 'answer' })).toBe('answered');
  });

  it('walks Sent -> Hub not reachable -> Sent on retry', () => {
    expect(transition('sent', { type: 'timeout' })).toBe('hubNotReachable');
    expect(transition('hubNotReachable', { type: 'retry' })).toBe('sent');
  });

  it('has a display label for each of the four states', () => {
    expect(ASK_STATUS_LABEL).toEqual({
      sent: 'Sent',
      receivedByHub: 'Received by hub',
      answered: 'Answered',
      hubNotReachable: 'Hub not reachable',
    });
  });
});

describe('transition ignores events that do not apply', () => {
  it('never leaves Answered', () => {
    expect(transition('answered', { type: 'timeout' })).toBe('answered');
    expect(transition('answered', { type: 'hubAck' })).toBe('answered');
    expect(transition('answered', { type: 'retry' })).toBe('answered');
  });

  it('only times out while Sent: after the ack the answer is simply still coming', () => {
    expect(transition('receivedByHub', { type: 'timeout' })).toBe('receivedByHub');
  });

  it('tolerates an answer that arrives without the ack', () => {
    expect(transition('sent', { type: 'answer' })).toBe('answered');
  });

  it('ignores retry outside Hub not reachable', () => {
    expect(transition('sent', { type: 'retry' })).toBe('sent');
    expect(transition('hubNotReachable', { type: 'hubAck' })).toBe('hubNotReachable');
  });
});

describe('AskMachine', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts Sent and times out to Hub not reachable, then retry returns to Sent', () => {
    const machine = new AskMachine({ timeoutMs: 1000 });
    expect(machine.current).toBe('sent');
    jest.advanceTimersByTime(999);
    expect(machine.current).toBe('sent');
    jest.advanceTimersByTime(1);
    expect(machine.current).toBe('hubNotReachable');
    machine.dispatch({ type: 'retry' });
    expect(machine.current).toBe('sent');
    // retry re-arms the timeout
    jest.advanceTimersByTime(1000);
    expect(machine.current).toBe('hubNotReachable');
    machine.dispose();
  });

  it('goes Sent -> Received by hub -> Answered and never times out after the ack', () => {
    const seen: string[] = [];
    const machine = new AskMachine({ timeoutMs: 1000, onChange: (s) => seen.push(s) });
    machine.dispatch({ type: 'hubAck' });
    expect(machine.current).toBe('receivedByHub');
    jest.advanceTimersByTime(60_000);
    expect(machine.current).toBe('receivedByHub');
    machine.dispatch({ type: 'answer' });
    expect(machine.current).toBe('answered');
    expect(seen).toEqual(['receivedByHub', 'answered']);
    machine.dispose();
  });

  it('honours a configurable timeout', () => {
    const machine = new AskMachine({ timeoutMs: 5000 });
    jest.advanceTimersByTime(4999);
    expect(machine.current).toBe('sent');
    jest.advanceTimersByTime(1);
    expect(machine.current).toBe('hubNotReachable');
    machine.dispose();
  });

  it('dispose stops the timer', () => {
    const machine = new AskMachine({ timeoutMs: 1000 });
    machine.dispose();
    jest.advanceTimersByTime(10_000);
    expect(machine.current).toBe('sent');
  });

  it('exposes a positive default timeout', () => {
    expect(Number.isFinite(DEFAULT_HUB_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_HUB_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
