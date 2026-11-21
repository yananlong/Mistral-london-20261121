import { AskFlow, AskFlowSnapshot } from '../src/ask/askFlow';
import { HUB_ACK_TEXT, HUB_ANSWER_LABEL } from '../src/transport/protocol';

/**
 * PR #10 review majors, exercised end to end through the same flow the Ask
 * screen uses: late replies after a timeout (major 1) and reply attribution
 * with more than one question (major 2).
 */

function makeFlow(sent: string[], snapshots: AskFlowSnapshot[], timeoutMs = 1000) {
  return new AskFlow({
    timeoutMs,
    sendToHub: (payload) => sent.push(payload),
    onChange: (snapshot) => snapshots.push(snapshot),
  });
}

const ANSWER_ONE = `Answer one.\n${HUB_ANSWER_LABEL}`;
const ANSWER_TWO = `Answer two.\n${HUB_ANSWER_LABEL}`;

describe('AskFlow serializes questions to the hub (major 2)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps one question in flight and queues the rest in order', () => {
    const sent: string[] = [];
    const flow = makeFlow(sent, []);
    flow.ask('first question', 'first question');
    flow.ask('second question', 'second question');
    expect(sent).toEqual(['first question']); // second is queued, not sent

    flow.handleHubMessage(HUB_ACK_TEXT, true);
    expect(sent).toEqual(['first question']); // still in flight after the ack

    flow.handleHubMessage(ANSWER_ONE, false);
    // answering the first frees the slot and sends the queued second
    expect(sent).toEqual(['first question', 'second question']);
    flow.dispose();
  });

  it('attributes ack and answer to the right question with two asked back to back', () => {
    const sent: string[] = [];
    const snapshots: AskFlowSnapshot[] = [];
    const flow = makeFlow(sent, snapshots);
    flow.ask('first question', 'first question');
    flow.ask('second question', 'second question');

    flow.handleHubMessage(HUB_ACK_TEXT, true);
    flow.handleHubMessage(ANSWER_ONE, false);
    flow.handleHubMessage(HUB_ACK_TEXT, true);
    flow.handleHubMessage(ANSWER_TWO, false);

    const items = snapshots[snapshots.length - 1].items;
    const first = items.find((item) => item.question === 'first question');
    const second = items.find((item) => item.question === 'second question');
    expect(first?.status).toBe('answered');
    expect(first?.answer).toBe(ANSWER_ONE);
    expect(second?.status).toBe('answered');
    expect(second?.answer).toBe(ANSWER_TWO);
    flow.dispose();
  });

  it('reports the queued count while a question is in flight', () => {
    const sent: string[] = [];
    const snapshots: AskFlowSnapshot[] = [];
    const flow = makeFlow(sent, snapshots);
    flow.ask('first question', 'first question');
    flow.ask('second question', 'second question');
    flow.ask('third question', 'third question');
    const latest = snapshots[snapshots.length - 1];
    expect(latest.queuedCount).toBe(2);
    expect(latest.items).toHaveLength(1);
    flow.dispose();
  });

  it('retries a timed-out question and attributes its replies to it', () => {
    const sent: string[] = [];
    const snapshots: AskFlowSnapshot[] = [];
    const flow = makeFlow(sent, snapshots);
    flow.ask('is anyone there?', 'is anyone there?');
    jest.advanceTimersByTime(1000);
    let item = snapshots[snapshots.length - 1].items[0];
    expect(item.status).toBe('hubNotReachable');

    flow.retry(item.id);
    expect(sent).toEqual(['is anyone there?', 'is anyone there?']); // re-sent
    item = snapshots[snapshots.length - 1].items[0];
    expect(item.status).toBe('sent');

    flow.handleHubMessage(HUB_ACK_TEXT, true);
    flow.handleHubMessage(ANSWER_ONE, false);
    item = snapshots[snapshots.length - 1].items[0];
    expect(item.status).toBe('answered');
    expect(item.answer).toBe(ANSWER_ONE);
    flow.dispose();
  });
});

describe('AskFlow keeps late hub replies after a timeout (major 1)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('applies a late answer to the timed-out question and moves it to Answered', () => {
    const sent: string[] = [];
    const snapshots: AskFlowSnapshot[] = [];
    const flow = makeFlow(sent, snapshots);
    flow.ask('will the hub answer?', 'will the hub answer?');
    jest.advanceTimersByTime(1000);
    expect(snapshots[snapshots.length - 1].items[0].status).toBe('hubNotReachable');

    // the answer arrives after "Hub not reachable" was already shown
    flow.handleHubMessage(ANSWER_ONE, false);
    const item = snapshots[snapshots.length - 1].items[0];
    expect(item.status).toBe('answered');
    expect(item.answer).toBe(ANSWER_ONE);

    // and the timer does not fire again afterwards
    jest.advanceTimersByTime(60_000);
    expect(snapshots[snapshots.length - 1].items[0].status).toBe('answered');
    flow.dispose();
  });

  it('applies a late ack to the timed-out question, then its answer', () => {
    const sent: string[] = [];
    const snapshots: AskFlowSnapshot[] = [];
    const flow = makeFlow(sent, snapshots);
    flow.ask('late ack question', 'late ack question');
    jest.advanceTimersByTime(1000);

    flow.handleHubMessage(HUB_ACK_TEXT, true);
    expect(snapshots[snapshots.length - 1].items[0].status).toBe('receivedByHub');
    flow.handleHubMessage(ANSWER_ONE, false);
    expect(snapshots[snapshots.length - 1].items[0].status).toBe('answered');
    flow.dispose();
  });

  it('routes a late reply to the oldest unanswered question, not to a newer in-flight one', () => {
    const sent: string[] = [];
    const snapshots: AskFlowSnapshot[] = [];
    const flow = makeFlow(sent, snapshots);
    flow.ask('old question', 'old question');
    jest.advanceTimersByTime(1000); // old question -> Hub not reachable
    flow.ask('new question', 'new question'); // sent, slot was free
    expect(sent).toEqual(['old question', 'new question']);

    // the hub's late answer to the OLD question arrives while the new one is in flight
    flow.handleHubMessage(ANSWER_ONE, false);
    const items = snapshots[snapshots.length - 1].items;
    const oldItem = items.find((item) => item.question === 'old question');
    const newItem = items.find((item) => item.question === 'new question');
    expect(oldItem?.status).toBe('answered');
    expect(oldItem?.answer).toBe(ANSWER_ONE);
    expect(newItem?.status).toBe('sent');
    expect(newItem?.answer).toBeNull();

    // the new question then gets its own ack and answer
    flow.handleHubMessage(HUB_ACK_TEXT, true);
    flow.handleHubMessage(ANSWER_TWO, false);
    const after = snapshots[snapshots.length - 1].items;
    expect(after.find((item) => item.question === 'new question')?.status).toBe('answered');
    expect(after.find((item) => item.question === 'new question')?.answer).toBe(ANSWER_TWO);
    flow.dispose();
  });

  it('drops hub replies when no question is waiting, without crashing', () => {
    const sent: string[] = [];
    const snapshots: AskFlowSnapshot[] = [];
    const flow = makeFlow(sent, snapshots);
    flow.handleHubMessage(ANSWER_ONE, false);
    flow.handleHubMessage(HUB_ACK_TEXT, true);
    expect(snapshots).toHaveLength(0);
    flow.dispose();
  });
});
