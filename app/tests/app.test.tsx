import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { MeshApp } from '../src/AppShell';
import { AI_SOURCE } from '../src/components/Thread';
import { config } from '../src/config';
import { demoLocation, DEMO_POSITION, fixedLocation, LocationSource } from '../src/location/LocationStore';
import { ACK_TEXT, ACK_TIMEOUT_MS, ANSWER_LABEL, ANSWER_TIMEOUT_MS, decodeLocationShare, encodeLoc, HUB_NICKNAME, MAX_MESSAGE_BYTES, SOS_CANCEL_NOTE, SOS_NOTE } from '../src/protocol';
import { AppRuntime } from '../src/store/Runtime';
import { HUB_ID, PHONE_B_ID, SimulatedTransport } from '../src/transport/SimulatedTransport';
import { createTransport } from '../src/transport/factory';
import { TransportEvent } from '../src/transport/types';

async function launch(options: ConstructorParameters<typeof SimulatedTransport>[0] = {}, source: LocationSource = demoLocation, transport = new SimulatedTransport(options)) {
  const runtime = new AppRuntime({ transport, simulation: transport }, source);
  await render(<MeshApp runtime={runtime} />);
  return { runtime, transport };
}

class OutOfOrderTransport extends SimulatedTransport {
  override subscribe(listener: (event: TransportEvent) => void): () => void {
    return super.subscribe(event => {
      if (event.type === 'message' && event.message.from === HUB_ID && event.message.text.startsWith('(1/')) {
        setTimeout(() => listener(event), 100);
      } else listener(event);
    });
  }
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const tap = async (name: string | RegExp) => { await fireEvent.press(button(name)); };
const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const askBox = () => screen.getByLabelText('Ask anything');
async function ask(text: string) {
  await fireEvent.changeText(askBox(), text);
  await tap('Send');
}
const hubReply = (runtime: AppRuntime, text: string) =>
  runtime.ask.receive({ id: `${text}-${Math.random()}`, from: HUB_ID, fromNickname: HUB_NICKNAME, text, channel: 'private', receivedAt: Date.now() });

beforeEach(() => { jest.useFakeTimers(); });
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

test('the app falls back to the simulated link when the native module is unavailable', () => {
  const selection = createTransport();
  expect(selection.transport.kind).toBe('simulated');
  expect(selection.simulation).toBeDefined();
});

describe('the home screen follows design/components.html', () => {
  test('briefing first: one big line, one fact, three questions, unknowns say Not known yet', async () => {
    await launch();
    expect(screen.getByText('Power disruption.')).toBeTruthy();
    expect(screen.getByText('Across the UK, since 2:20pm.')).toBeTruthy();
    expect(screen.getByText('What happened?')).toBeTruthy();
    expect(screen.getByText('No power, mobile signal or internet anywhere in the UK.')).toBeTruthy();
    expect(screen.getAllByText('Not known yet')).toHaveLength(2);
  });

  test('six topics say whether there is anything to find yet', async () => {
    await launch();
    expect(button('Water. 2 places')).toBeTruthy();
    expect(button('Charge phone. Nothing yet')).toBeTruthy();
    expect(button('Food. Nothing yet')).toBeTruthy();
    expect(button('Family. Send a message')).toBeTruthy();
    expect(button('Shelter. 1 place')).toBeTruthy();
    expect(button('First aid. On your phone')).toBeTruthy();
  });

  test('never talks about the connection: no online, connected, counts or hub; SOS and the question box are always there', async () => {
    await launch();
    for (const word of [/online/i, /connected/i, /nearby ·/i, /\bhub\b/i, /\bmesh\b/i, /signal bars/i]) expect(screen.queryByText(word)).toBeNull();
    expect(screen.queryByText('Not getting through right now')).toBeNull();
    expect(button('SOS. Ask for help')).toBeTruthy();
    expect(askBox()).toBeTruthy();
    expect(within(screen.getByTestId('main-scroll')).queryByLabelText('Ask anything')).toBeNull();
    expect(screen.getByText('Demo')).toBeTruthy();
  });

  test('news arriving replaces Not known yet and marks it New', async () => {
    const { runtime } = await launch();
    expect(screen.queryByText('New')).toBeNull();
    await act(() => runtime.news.set('all'));
    expect(screen.getByText('A fault in the national grid. Engineers are on site.')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(button('Charge phone. 2 places')).toBeTruthy();
  });
});

describe('asking: each message shows what happened to it', () => {
  test('Sending, then Delivered, then Answered, with the AI label', async () => {
    await launch();
    await ask('How do I make water safe to drink?');
    expect(screen.getByText('Sending')).toBeTruthy();
    expect(askBox()).toHaveProp('value', '');
    await advance(800);
    expect(screen.getByText('Delivered')).toBeTruthy();
    await advance(2500);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText(/1\. Use sealed bottled water/)).toBeTruthy();
    expect(screen.getByText(new RegExp(AI_SOURCE.replace('.', '\\.')))).toBeTruthy();
  });

  test('out-of-order answer parts show progress, then the full answer', async () => {
    await launch({}, demoLocation, new OutOfOrderTransport());
    await ask('How do I make water safe to drink?');
    await advance(3300);
    expect(screen.getByText('Delivered')).toBeTruthy();
    expect(screen.getByText('Answer arriving, 2 of 3')).toBeTruthy();
    await advance(100);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText('1. Use sealed bottled water if you have it.\n2. Boiling does not remove chemicals. Avoid water that may be chemically contaminated.\n3. For clear water with a biological risk, bring it to a rolling boil for at least 1 minute, then let it cool in a clean, covered container.')).toBeTruthy();
  });

  test('before any answerer is in range, a question waits as Not sent yet and goes by itself later', async () => {
    const { transport } = await launch({ hubMode: 'offline' });
    await ask('How do I treat a burn?');
    expect(screen.getByText('Not sent yet')).toBeTruthy();
    expect(screen.getByText('Not getting through right now')).toBeTruthy();
    expect(transport.sent).toHaveLength(0);
    await act(() => transport.setHubMode('online'));
    expect(transport.hubInbox).toEqual(['How do I treat a burn?']);
    expect(screen.queryByText('Not getting through right now')).toBeNull();
    await advance(3300);
    expect(screen.getByText('Answered')).toBeTruthy();
  });

  test('no acknowledgement: Not sent yet, keeps trying by itself, and sends again when the answerer is back', async () => {
    const { transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await ask('How do I stop heavy bleeding?');
    expect(screen.getByText('Sending')).toBeTruthy();
    await advance(ACK_TIMEOUT_MS - 1);
    expect(screen.getByText('Sending')).toBeTruthy();
    await advance(1);
    expect(screen.getByText('Not sent yet')).toBeTruthy();
    expect(screen.getByText('Not getting through right now')).toBeTruthy();
    expect(transport.sent[0].to).toBe(HUB_ID);
    await advance(config.retryIntervalMs);
    expect(transport.sent).toHaveLength(2);
    expect(screen.getByText('Sending')).toBeTruthy();
    await advance(ACK_TIMEOUT_MS);
    await act(() => transport.setHubMode('online'));
    expect(transport.sent).toHaveLength(3);
    expect(transport.sent[2].text).toBe(transport.sent[0].text);
    await advance(3300);
    expect(screen.getByText('Answered')).toBeTruthy();
  });

  test('a question that has not got through can be cancelled', async () => {
    const { runtime } = await launch({ hubMode: 'offline' });
    await ask('Is the tube running?');
    await tap('Cancel this question');
    expect(screen.queryByText('Is the tube running?')).toBeNull();
    expect(runtime.ask.getSnapshot().state).toBe('idle');
  });

  test('no answer: says so plainly, and Ask again sends the same question', async () => {
    const { transport } = await launch({ hubMode: 'error' });
    await ask('How do I treat a burn?');
    await advance(800);
    expect(screen.getByText('Delivered')).toBeTruthy();
    await advance(2500);
    expect(screen.getByText('No answer this time.')).toBeTruthy();
    await act(() => transport.setHubMode('online'));
    await tap('Ask again');
    expect(transport.hubInbox).toEqual(['How do I treat a burn?', 'How do I treat a burn?']);
    await advance(3300);
    expect(screen.getByText('Answered')).toBeTruthy();
  });

  test('after an ack, a missing answer ends as no answer at the answer timeout', async () => {
    const { runtime, transport } = await launch();
    await ask('How do I make water safe to drink?');
    await advance(800);
    await act(() => transport.setHubMode('offline'));
    await advance(ANSWER_TIMEOUT_MS - 1);
    expect(screen.getByText('Delivered')).toBeTruthy();
    await act(() => hubReply(runtime, '(1/3) First part'));
    expect(screen.getByText('Answer arriving, 1 of 3')).toBeTruthy();
    await advance(1);
    expect(screen.getByText('No answer this time.')).toBeTruthy();
  });

  test('a late answer after Not sent yet still lands, and duplicates are ignored', async () => {
    const { runtime, transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await ask('How do I treat a burn?');
    await advance(ACK_TIMEOUT_MS);
    await act(() => { hubReply(runtime, `(2/2) ${ANSWER_LABEL}`); hubReply(runtime, '(1/2) 1. A late answer.'); });
    expect(screen.getByText('Answered')).toBeTruthy();
    await act(() => { hubReply(runtime, ACK_TEXT); hubReply(runtime, '(1/2) 1. Duplicate answer.'); hubReply(runtime, `(2/2) ${ANSWER_LABEL}`); });
    expect(screen.getByText('1. A late answer.')).toBeTruthy();
    expect(screen.queryByText('1. Duplicate answer.')).toBeNull();
  });

  test('a retry discards the previous attempt’s partial answer', async () => {
    const { runtime, transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await ask('How do I treat a burn?');
    await advance(ACK_TIMEOUT_MS);
    await act(() => hubReply(runtime, '(1/2) Old answer'));
    expect(screen.getByText('Answer arriving, 1 of 2')).toBeTruthy();
    await act(() => runtime.ask.retry());
    expect(screen.queryByText('Answer arriving, 1 of 2')).toBeNull();
    await act(() => hubReply(runtime, `(2/2) ${ANSWER_LABEL}`));
    expect(screen.queryByText('Answered')).toBeNull();
    await act(() => hubReply(runtime, '(1/2) New answer'));
    expect(screen.getByText('New answer')).toBeTruthy();
  });

  test('answered questions stay in the thread when you ask the next one', async () => {
    const { transport } = await launch();
    await ask('Is fridge food safe after a power cut?');
    await advance(3300);
    await ask('How do I make water safe to drink?');
    await advance(3300);
    expect(screen.getAllByText('Answered')).toHaveLength(2);
    expect(screen.getByText(/1\. Keep the fridge/)).toBeTruthy();
    expect(screen.getByText(/1\. Use sealed bottled water/)).toBeTruthy();
    expect(transport.hubInbox).toHaveLength(2);
  });

  test('one question at a time: a second one waits for the first', async () => {
    const { transport } = await launch();
    await ask('How do I treat a burn?');
    await ask('Is the tube running?');
    expect(screen.getByText('One question at a time. Your last one is still on its way.')).toBeTruthy();
    expect(askBox()).toHaveProp('value', 'Is the tube running?');
    expect(transport.hubInbox).toHaveLength(1);
  });

  test('location is off by default; switched on, the loc line goes with that one question only', async () => {
    const { transport } = await launch();
    const toggle = () => screen.getByRole('switch', { name: 'Include where I am' });
    expect(toggle()).not.toBeChecked();
    await ask('How do I keep warm with no power?');
    expect(decodeLocationShare(transport.hubInbox[0])).toBeNull();
    await advance(3300);
    await fireEvent.press(toggle());
    expect(screen.getByText('Where you are goes with this question.')).toBeTruthy();
    await ask('How do I keep warm with no power?');
    expect(transport.hubInbox[1].split('\n').pop()).toBe(encodeLoc(DEMO_POSITION.lat, DEMO_POSITION.lon));
    expect(toggle()).not.toBeChecked();
  });

  test('the question box stops at 200 bytes and still fits a location line', async () => {
    const { transport } = await launch();
    await fireEvent.press(screen.getByRole('switch', { name: 'Include where I am' }));
    await fireEvent.changeText(askBox(), `${'😀'.repeat(50)}extra`);
    expect(askBox()).toHaveProp('value', '😀'.repeat(50));
    await tap('Send');
    expect(transport.hubInbox[0]).toBe(`${'😀'.repeat(50)}\n${encodeLoc(DEMO_POSITION.lat, DEMO_POSITION.lon)}`);
    expect(new TextEncoder().encode(transport.hubInbox[0]).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });

  test('an over-limit question cannot bypass the box', async () => {
    const { runtime, transport } = await launch();
    await act(() => { runtime.ask.submit('😀'.repeat(51), null); runtime.ask.ask('😀'.repeat(51), null); });
    expect(transport.sent).toHaveLength(0);
    expect(runtime.ask.getSnapshot().state).toBe('idle');
  });
});

describe('what you can find', () => {
  test('a topic opens on its map, every place numbered, with how far the walk is and who said so', async () => {
    await launch();
    await tap('Water. 2 places');
    expect(screen.getByText('Where can I get drinking water?')).toBeTruthy();
    expect(screen.getByLabelText(/Map: 2 places/)).toBeTruthy();
    expect(screen.getByText('Southwark Cathedral')).toBeTruthy();
    expect(screen.getAllByText(/m, \d+ min walk/)).toHaveLength(2);
    expect(screen.getAllByText('From Southwark Council, 2:30pm')).toHaveLength(2);
    await tap('Close');
    expect(screen.queryByText('Southwark Cathedral')).toBeNull();
  });

  test('nothing shared yet: says so, and Ask anyway sends the topic question', async () => {
    const { transport } = await launch();
    await tap('Food. Nothing yet');
    expect(screen.getByText('Nobody has shared this yet.')).toBeTruthy();
    await tap('Ask anyway: Where can I get food?');
    expect(transport.hubInbox).toEqual(['Where can I get food?']);
    expect(screen.getByText('Where can I get food?')).toBeTruthy();
  });

  test('an answer about a place carries a map card that opens the same map', async () => {
    const { runtime } = await launch();
    await act(() => runtime.news.set('all'));
    await ask('Where can I charge my phone?');
    await advance(3300);
    await tap('Open map of Southwark Library');
    expect(screen.getByText("Guy's Hospital")).toBeTruthy();
  });

  test('first aid is on the phone and works with Bluetooth off, one guide at a time', async () => {
    const { transport } = await launch();
    await act(() => transport.setBluetooth(false));
    await tap('First aid. On your phone');
    await tap('Bleeding');
    expect(screen.getByText('Press hard on the wound with a clean cloth.')).toBeTruthy();
    await tap('Burns');
    expect(screen.queryByText('Press hard on the wound with a clean cloth.')).toBeNull();
    expect(screen.getByText('Cool the burn under cool running water for 20 minutes.')).toBeTruthy();
  });
});

describe('family and people nearby', () => {
  test('I\'m OK goes to everyone nearby by default and says who has it', async () => {
    const { transport } = await launch();
    await tap('Family. Send a message');
    await tap("Send I'm OK to everyone nearby");
    expect(transport.sent).toEqual([{ to: 'public', text: "I'm OK." }]);
    expect(screen.getAllByText('Sent to everyone nearby').length).toBeGreaterThan(0);
  });

  test('pick a person, then send where you are only after confirming', async () => {
    const { transport } = await launch();
    await act(() => transport.sendPhoneMessage('private'));
    await tap('Family. Send a message');
    await tap('Phone B');
    await tap('Send where I am to Phone B');
    expect(transport.sent).toHaveLength(0);
    await tap('Send my location');
    expect(transport.sent[0].to).toBe(PHONE_B_ID);
    expect(decodeLocationShare(transport.sent[0].text)).toMatchObject(DEMO_POSITION);
  });

  test('messages from people nearby appear in the thread, and a shared location opens on the map', async () => {
    const { transport } = await launch();
    await act(() => transport.sendPhoneMessage('public'));
    expect(screen.getByText('I’m at the cathedral gate. Are you nearby?')).toBeTruthy();
    expect(screen.getByText(/From Phone B, to everyone nearby/)).toBeTruthy();
    await act(() => transport.sendPhoneLocation());
    await tap("Open map: Phone B's location");
    expect(screen.getByText('Where Phone B is')).toBeTruthy();
    expect(screen.getByText(/min walk/)).toBeTruthy();
  });

  test('an SOS from someone nearby is shown as danger', async () => {
    const { transport } = await launch();
    await act(() => transport.sendPhoneSos());
    expect(screen.getByText('Phone B needs help.')).toBeTruthy();
    expect(screen.getAllByText('SOS')).toHaveLength(2); // the message heading, plus your own SOS button
    expect(screen.getByText(/From Phone B, to everyone nearby/)).toBeTruthy();
  });
});

describe('SOS', () => {
  test('asks once, sends with where you are, says it went, and Cancel tells everyone', async () => {
    const { transport } = await launch();
    await tap('SOS. Ask for help');
    expect(screen.getByText('Send SOS?')).toBeTruthy();
    expect(transport.sent).toHaveLength(0);
    await tap('Send SOS');
    expect(screen.getByText('SOS sent to everyone nearby.')).toBeTruthy();
    expect(transport.sent[0].to).toBe('public');
    expect(decodeLocationShare(transport.sent[0].text)).toEqual({ note: SOS_NOTE, ...DEMO_POSITION });
    await tap('Cancel SOS');
    expect(transport.sent[1]).toEqual({ to: 'public', text: SOS_CANCEL_NOTE });
    expect(button('SOS. Ask for help')).toBeTruthy();
  });

  test('can be called off before sending', async () => {
    const { transport } = await launch();
    await tap('SOS. Ask for help');
    await tap("Don't send SOS");
    expect(transport.sent).toHaveLength(0);
  });

  test('with Bluetooth off it waits as Not sent yet, then goes by itself when Bluetooth is back', async () => {
    const { transport } = await launch();
    await act(() => transport.setBluetooth(false));
    expect(screen.getByText('Bluetooth is off')).toBeTruthy();
    await tap('SOS. Ask for help');
    await tap('Send SOS');
    expect(screen.getByText('SOS not sent yet. The app keeps trying.')).toBeTruthy();
    expect(transport.sent).toHaveLength(0);
    await tap('Turn on Bluetooth');
    expect(screen.queryByText('Bluetooth is off')).toBeNull();
    expect(screen.getByText('SOS sent to everyone nearby.')).toBeTruthy();
    expect(transport.sent).toHaveLength(1);
  });

  test('with no position it still sends, without a loc line', async () => {
    const { transport } = await launch({}, fixedLocation({ kind: 'denied' }));
    await tap('SOS. Ask for help');
    expect(screen.getByText('It asks everyone nearby for help.')).toBeTruthy();
    await tap('Send SOS');
    expect(transport.sent[0]).toEqual({ to: 'public', text: SOS_NOTE });
  });
});

test('demo controls set the story: questions stop getting through', async () => {
  const { transport } = await launch();
  await tap('Demo controls');
  await tap('Not getting through');
  expect(transport.getHubMode()).toBe('offline');
  await tap('More known');
  expect(screen.getByText('A fault in the national grid. Engineers are on site.')).toBeTruthy();
});
