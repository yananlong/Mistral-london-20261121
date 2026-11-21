import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { MeshApp } from '../src/AppShell';
import { demoLocation, fixedLocation, LocationSource } from '../src/location/LocationStore';
import { ACK_TEXT, ACK_TIMEOUT_MS, ANSWER_LABEL, ANSWER_TIMEOUT_MS, decodeLocationShare, HUB_NICKNAME, MAX_MESSAGE_BYTES } from '../src/protocol';
import { DISCLAIMER } from '../src/screens/AskScreen';
import { AppRuntime } from '../src/store/Runtime';
import { HUB_ID, SimulatedTransport } from '../src/transport/SimulatedTransport';
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
const button = (name: string) => screen.getByRole('button', { name });
const tap = async (name: string) => { await fireEvent.press(button(name)); };
const pressTab = async (name: string) => { await fireEvent.press(screen.getByRole('tab', { name })); };
const openChats = async () => { await pressTab('Chats'); };
const openAsk = async () => { await pressTab('Info'); await fireEvent.press(screen.getByRole('tab', { name: 'Ask' })); };
const openLocate = async () => { await pressTab('Info'); await fireEvent.press(screen.getByRole('tab', { name: 'Locate' })); };
const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };

beforeEach(() => { jest.useFakeTimers(); });
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

test('the app falls back to the simulated link when the native module is unavailable', () => {
  const selection = createTransport();
  expect(selection.transport.kind).toBe('simulated');
  expect(selection.simulation).toBeDefined();
});

describe('Ask on the real simulated link', () => {
  test('the disclaimer stays outside the scrolling content', async () => {
    await launch();
    await openAsk();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(within(screen.getByTestId('main-scroll')).queryByText(DISCLAIMER)).toBeNull();
  });

  test('a suggestion goes from Sent to Received by hub to Answered with the label', async () => {
    await launch();
    await openAsk();
    expect(screen.getByText('Simulated link')).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    await tap('Make water safe to drink');
    expect(screen.getByText('Sent')).toBeTruthy();
    await advance(800);
    expect(screen.getByText('Received by hub')).toBeTruthy();
    await advance(2500);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText(ANSWER_LABEL)).toBeTruthy();
    expect(screen.getByText(/1\. Use sealed bottled water/)).toBeTruthy();
    expect(screen.getByText('3s elapsed')).toBeTruthy();
    expect(button('Ask another question')).toBeTruthy();
  });

  test('out-of-order simulated mesh parts show progress and assemble the full answer', async () => {
    await launch({}, demoLocation, new OutOfOrderTransport());
    await openAsk();
    await tap('Make water safe to drink');
    await advance(3300);
    expect(screen.getByText('Received by hub')).toBeTruthy();
    expect(screen.getByText('Answer arriving, 2 of 3')).toBeTruthy();
    await advance(100);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText('1. Use sealed bottled water if you have it.\n2. Boiling does not remove chemicals. Avoid water that may be chemically contaminated.\n3. For clear water with a biological risk, bring it to a rolling boil for at least 1 minute, then let it cool in a clean, covered container.')).toBeTruthy();
  });

  test('remembers a hub that goes offline, times out, retries and answers', async () => {
    const { transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await openAsk();
    await tap('Stop heavy bleeding');
    expect(screen.getByText('Sent')).toBeTruthy();
    await advance(ACK_TIMEOUT_MS - 1);
    expect(screen.getByText('Sent')).toBeTruthy();
    await advance(1);
    expect(screen.getByText('Hub not reachable')).toBeTruthy();
    expect(transport.sent[0].to).toBe(HUB_ID);
    await act(() => transport.setHubMode('online'));
    await tap('Retry');
    await advance(3300);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(transport.sent[1].text).toBe(transport.sent[0].text);
  });

  test('hub error becomes Hub could not answer with retry', async () => {
    await launch({ hubMode: 'error' });
    await openAsk();
    await tap('Treat a burn');
    await advance(800);
    expect(screen.getByText('Received by hub')).toBeTruthy();
    await advance(2500);
    expect(screen.getByText('Hub could not answer')).toBeTruthy();
    expect(button('Retry')).toBeTruthy();
  });

  test('attachment is off by default, then adds a valid loc line to the hub wire', async () => {
    const { transport } = await launch();
    await openAsk();
    const toggle = screen.getByRole('switch', { name: 'Attach my location' });
    expect(toggle).toHaveProp('value', false);
    await fireEvent(toggle, 'valueChange', true);
    await tap('Keep warm with no power');
    const wire = transport.hubInbox[0];
    expect(wire.split('\n').pop()).toBe('loc: 51.50070,-0.12460');
    expect(decodeLocationShare(wire)).toEqual({ note: 'How do I keep warm with no power?', lat: 51.5007, lon: -0.1246 });
  });

  test('a new question switches location attachment off again', async () => {
    const { transport } = await launch();
    await openAsk();
    await fireEvent(screen.getByRole('switch', { name: 'Attach my location' }), 'valueChange', true);
    await tap('Make water safe to drink');
    expect(decodeLocationShare(transport.hubInbox[0])).not.toBeNull();
    await advance(3300);
    await tap('Ask another question');
    expect(screen.getByRole('switch', { name: 'Attach my location' })).toHaveProp('value', false);
    await tap('Stop heavy bleeding');
    expect(decodeLocationShare(transport.hubInbox[1])).toBeNull();
  });

  test('without attachment no coordinates travel to the hub', async () => {
    const { transport } = await launch();
    await openAsk();
    await tap('Carbon monoxide signs');
    expect(decodeLocationShare(transport.hubInbox[0])).toBeNull();
  });

  test('looks for the hub before its first sighting', async () => {
    const { transport } = await launch({ hubMode: 'offline' });
    await openAsk();
    expect(screen.getByText(/Looking for the hub/)).toBeTruthy();
    expect(button('Make water safe to drink')).toBeDisabled();
    expect(transport.sent).toHaveLength(0);
    await act(() => transport.setHubMode('online'));
    expect(button('Make water safe to drink')).toBeEnabled();
  });

  test('status and timers survive leaving Ask', async () => {
    await launch();
    await openAsk();
    await tap('Food after a power cut');
    await openChats();
    await advance(3300);
    await openAsk();
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText(/1\. Keep the fridge/)).toBeTruthy();
    await tap('Ask another question');
    expect(button('Make water safe to drink')).toBeTruthy();
  });

  test('after an ack, a missing answer fails at the answer timeout', async () => {
    const { runtime, transport } = await launch();
    await openAsk();
    await tap('Make water safe to drink');
    await advance(800);
    await act(() => transport.setHubMode('offline'));
    await advance(ANSWER_TIMEOUT_MS - 1);
    expect(screen.getByText('Received by hub')).toBeTruthy();
    await act(() => runtime.ask.receive({ id: 'partial', from: HUB_ID, fromNickname: HUB_NICKNAME, text: '(1/3) First part', channel: 'private', receivedAt: Date.now() }));
    expect(screen.getByText('Answer arriving, 1 of 3')).toBeTruthy();
    await advance(1);
    expect(screen.getByText('Hub could not answer')).toBeTruthy();
  });

  test('allows a late answer after an unreachable timeout and ignores duplicate replies', async () => {
    const { runtime, transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await openAsk();
    await tap('Treat a burn');
    await advance(ACK_TIMEOUT_MS);
    const reply = (text: string) => runtime.ask.receive({ id: 'late', from: HUB_ID, fromNickname: HUB_NICKNAME, text, channel: 'private', receivedAt: Date.now() });
    await act(() => { reply(`(2/2) ${ANSWER_LABEL}`); reply('(1/2) 1. A late answer.'); });
    expect(screen.getByText('Answered')).toBeTruthy();
    await act(() => { reply(ACK_TEXT); reply('(1/2) 1. Duplicate answer.'); reply(`(2/2) ${ANSWER_LABEL}`); });
    expect(screen.getByText('1. A late answer.')).toBeTruthy();
    expect(screen.queryByText('1. Duplicate answer.')).toBeNull();
  });

  test('retry discards the previous attempt’s partial answer', async () => {
    const { runtime, transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await openAsk();
    await tap('Treat a burn');
    await advance(ACK_TIMEOUT_MS);
    const reply = (text: string) => runtime.ask.receive({ id: text, from: HUB_ID, fromNickname: HUB_NICKNAME, text, channel: 'private', receivedAt: Date.now() });
    await act(() => reply('(1/2) Old answer'));
    expect(screen.getByText('Answer arriving, 1 of 2')).toBeTruthy();
    await tap('Retry');
    expect(screen.queryByText('Answer arriving, 1 of 2')).toBeNull();
    await act(() => reply(`(2/2) ${ANSWER_LABEL}`));
    expect(screen.queryByText('Answered')).toBeNull();
    await act(() => reply('(1/2) New answer'));
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText('New answer')).toBeTruthy();
  });

  test('reset discards partial answers before a new question', async () => {
    const { runtime, transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await openAsk();
    await tap('Treat a burn');
    await advance(ACK_TIMEOUT_MS);
    const reply = (text: string) => runtime.ask.receive({ id: text, from: HUB_ID, fromNickname: HUB_NICKNAME, text, channel: 'private', receivedAt: Date.now() });
    await act(() => reply('(1/2) Previous answer'));
    await tap('Ask another question');
    await tap('Stop heavy bleeding');
    await act(() => reply(`(2/2) ${ANSWER_LABEL}`));
    expect(screen.queryByText('Answered')).toBeNull();
    await act(() => reply('(1/2) Current answer'));
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText('Current answer')).toBeTruthy();
  });

  test('emoji questions stop at 200 bytes and fit with an attached location', async () => {
    const { transport } = await launch();
    await openAsk();
    await fireEvent(screen.getByRole('switch', { name: 'Attach my location' }), 'valueChange', true);
    await fireEvent.changeText(screen.getByLabelText('Your question'), `${'😀'.repeat(50)}extra`);
    expect(screen.getByLabelText('Your question')).toHaveProp('value', '😀'.repeat(50));
    expect(screen.getByText('0 bytes remaining')).toBeTruthy();
    await tap('Send question');
    expect(transport.hubInbox[0]).toBe(`${'😀'.repeat(50)}\nloc: 51.50070,-0.12460`);
    expect(new TextEncoder().encode(transport.hubInbox[0]).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });

  test('an over-limit question cannot bypass the composer', async () => {
    const { runtime, transport } = await launch();
    await act(() => runtime.ask.submit('😀'.repeat(51), null));
    expect(transport.sent).toHaveLength(0);
    expect(runtime.ask.getSnapshot().state).toBe('idle');
  });
});

describe('Talk', () => {
  test('no peers shows No one nearby', async () => {
    await launch({ hubMode: 'offline', phoneNearby: false });
    await openChats();
    expect(screen.getByText('No one nearby')).toBeTruthy();
  });
  test('a sent public message appears in the thread', async () => {
    const { transport } = await launch();
    await openChats();
    await fireEvent.changeText(screen.getByLabelText('Message'), 'We are safe at the gate.');
    await tap('Send message');
    expect(screen.getByText('We are safe at the gate.')).toBeTruthy();
    expect(transport.sent[0]).toEqual({ to: 'public', text: 'We are safe at the gate.' });
  });
  test('the composer stops at 255 bytes and an over-limit message cannot be sent', async () => {
    const { runtime, transport } = await launch();
    await openChats();
    await fireEvent.changeText(screen.getByLabelText('Message'), `${'😀'.repeat(63)}abcde`);
    expect(screen.getByLabelText('Message')).toHaveProp('value', `${'😀'.repeat(63)}abc`);
    expect(screen.getByText('0 bytes remaining')).toBeTruthy();
    await tap('Send message');
    expect(new TextEncoder().encode(transport.sent[0].text).length).toBe(MAX_MESSAGE_BYTES);
    await expect(runtime.mesh.send('public', '😀'.repeat(64))).rejects.toThrow();
    expect(transport.sent).toHaveLength(1);
  });
  test('an inbound private message is in Phone B’s private thread', async () => {
    const { transport } = await launch();
    await openChats();
    await act(() => transport.sendPhoneMessage('private'));
    expect(screen.queryByText('I’m at the north gate. Are you nearby?')).toBeNull();
    await tap('Open private thread with Phone B');
    expect(screen.getByText('I’m at the north gate. Are you nearby?')).toBeTruthy();
  });
  test('a location row opens Locate on that pin', async () => {
    const { transport } = await launch();
    await openChats();
    await act(() => transport.sendPhoneLocation());
    await tap('Open private thread with Phone B');
    await tap('Open Phone B location in Locate');
    expect(screen.getByText('Selected location · Phone B')).toBeTruthy();
    expect(screen.getAllByText('51.50550, -0.11950').length).toBeGreaterThan(0);
  });
});

describe('Locate', () => {
  test('a location share produces a latest pin for Phone B', async () => {
    const { transport } = await launch();
    await act(() => transport.sendPhoneLocation());
    await openLocate();
    expect(screen.getByText('◆ Phone B')).toBeTruthy();
    expect(screen.getByText('51.50550, -0.11950')).toBeTruthy();
    expect(screen.getByText(/Offline map needs a development build/)).toBeTruthy();
  });
  test('denied location permission is clear and sharing is disabled', async () => {
    await launch({}, fixedLocation({ kind: 'denied' }));
    await openLocate();
    expect(screen.getByText(/Location permission denied/)).toBeTruthy();
    expect(button('Share location')).toBeDisabled();
  });
  test('no position fix has a separate state', async () => {
    await launch({}, fixedLocation({ kind: 'locating' }));
    await openLocate();
    expect(screen.getByText(/No position fix yet/)).toBeTruthy();
  });
  test('share recipient picker excludes the hub and emits the contract text', async () => {
    const { transport } = await launch();
    await openLocate();
    await tap('Share location');
    expect(screen.queryByRole('button', { name: 'Share with hub' })).toBeNull();
    await tap('Share with public channel');
    expect(transport.sent[0]).toEqual({ to: 'public', text: 'Shared location\nloc: 51.50070,-0.12460' });
    expect(screen.getByText('Location shared with the public channel.')).toBeTruthy();
  });
});

test('demo controls can take the hub offline and inject a Phone B location', async () => {
  await launch();
  await tap('Demo controls');
  await tap('Hub offline');
  expect(screen.getByText('Hub mode: offline')).toBeTruthy();
  await tap('Phone B shares a location');
  await openLocate();
  expect(screen.getByText('◆ Phone B')).toBeTruthy();
});

describe('two-tab shell', () => {
  test('launches on the Info tab showing Ask, with Info and Chats in the bottom bar', async () => {
    await launch();
    expect(screen.getByText('Ask the hub')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Info' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Chats' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Talk' })).toBeNull();
    // the Info sub-switcher offers Ask and Locate
    expect(screen.getByRole('tab', { name: 'Ask' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Locate' })).toBeTruthy();
  });

  test('the pinned Ask/Locate switcher stays outside the scrolling content', async () => {
    await launch();
    expect(within(screen.getByTestId('main-scroll')).queryByRole('tab', { name: 'Locate' })).toBeNull();
    await openLocate();
    expect(screen.getByRole('header', { name: 'Locate' })).toBeTruthy();
    expect(within(screen.getByTestId('main-scroll')).queryByRole('tab', { name: 'Ask' })).toBeNull();
  });

  test('Chats tab shows the Talk threads', async () => {
    await launch();
    await openChats();
    expect(screen.getByText('Talk nearby')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Info' })).toBeTruthy();
  });
});

describe('SOS emergency flow', () => {
  const openSOS = async () => { await fireEvent.press(screen.getByRole('button', { name: 'SOS — emergency options' })); };

  test('the SOS header action is a small pill, not a big button, and opens the guided steps in order', async () => {
    await launch();
    const sos = screen.getByRole('button', { name: 'SOS — emergency options' });
    expect(sos).toBeTruthy();
    await fireEvent.press(sos);
    expect(screen.getByText('Emergency')).toBeTruthy();
    for (const step of ['First aid — try to resolve it yourself', 'Help — reach the people around you', 'What is happening — get an analysis', 'Call for help — alert everyone on the mesh']) {
      expect(screen.getByText(step)).toBeTruthy();
    }
  });

  test('Send SOS + get first-aid guidance does both at once: public SOS with loc pin, and a hub question', async () => {
    const { transport } = await launch();
    await openSOS();
    await tap('Send SOS + get first-aid guidance');
    expect(transport.sent).toContainEqual({ to: 'public', text: 'SOS — I need help\nloc: 51.50070,-0.12460' });
    expect(transport.sent).toContainEqual({ to: HUB_ID, text: 'First aid: what should I do right now?\nloc: 51.50070,-0.12460' });
    // navigated to Info/Ask and the question is on its way (the SOS receipt stays in the sheet until it closes)
    expect(screen.getByText('Sent')).toBeTruthy();
  });

  test('Send SOS to everyone nearby reports the receipt and lands in the public thread', async () => {
    const { transport } = await launch();
    await openSOS();
    await tap('Send SOS to everyone nearby');
    expect(transport.sent).toContainEqual({ to: 'public', text: 'SOS — I need help\nloc: 51.50070,-0.12460' });
    expect(screen.getByText(/SOS sent to everyone on the mesh/)).toBeTruthy();
    await tap('Close emergency options');
    await openChats();
    expect(screen.getByText(/SOS — I need help/)).toBeTruthy();
  });

  test('Message people nearby from the sheet goes to the Chats tab', async () => {
    await launch();
    await openSOS();
    await tap('Message people nearby');
    expect(screen.getByText('Talk nearby')).toBeTruthy();
  });
});
