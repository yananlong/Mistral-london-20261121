import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { MeshApp } from '../src/AppShell';
import { demoLocation, fixedLocation, LocationSource } from '../src/location/LocationStore';
import { ACK_TEXT, ACK_TIMEOUT_MS, ANSWER_LABEL, ANSWER_TIMEOUT_MS, decodeLocationShare, HUB_NICKNAME, MAX_MESSAGE_BYTES } from '../src/protocol';
import { DISCLAIMER } from '../src/screens/AskScreen';
import { AppRuntime } from '../src/store/Runtime';
import { HUB_ID, SimulatedTransport } from '../src/transport/SimulatedTransport';
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
const tab = async (name: 'Ask' | 'Talk' | 'Locate') => { await fireEvent.press(screen.getByRole('tab', { name })); };
const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };

beforeEach(() => { jest.useFakeTimers(); });
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

describe('Ask on the real simulated link', () => {
  test('a suggestion goes from Sent to Received by hub to Answered with the label', async () => {
    await launch();
    await tab('Ask');
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
    await tab('Ask');
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
    await tab('Ask');
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
    await tab('Ask');
    await tap('Treat a burn');
    await advance(800);
    expect(screen.getByText('Received by hub')).toBeTruthy();
    await advance(2500);
    expect(screen.getByText('Hub could not answer')).toBeTruthy();
    expect(button('Retry')).toBeTruthy();
  });

  test('attachment is off by default, then adds a valid loc line to the hub wire', async () => {
    const { transport } = await launch();
    await tab('Ask');
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
    await tab('Ask');
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
    await tab('Ask');
    await tap('Carbon monoxide signs');
    expect(decodeLocationShare(transport.hubInbox[0])).toBeNull();
  });

  test('looks for the hub before its first sighting', async () => {
    const { transport } = await launch({ hubMode: 'offline' });
    await tab('Ask');
    expect(screen.getByText(/Looking for the hub/)).toBeTruthy();
    expect(button('Make water safe to drink')).toBeDisabled();
    expect(transport.sent).toHaveLength(0);
    await act(() => transport.setHubMode('online'));
    expect(button('Make water safe to drink')).toBeEnabled();
  });

  test('status and timers survive leaving Ask', async () => {
    await launch();
    await tab('Ask');
    await tap('Food after a power cut');
    await tab('Talk');
    await advance(3300);
    await tab('Ask');
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText(/1\. Keep the fridge/)).toBeTruthy();
    await tap('Ask another question');
    expect(button('Make water safe to drink')).toBeTruthy();
  });

  test('after an ack, a missing answer fails at the answer timeout', async () => {
    const { runtime, transport } = await launch();
    await tab('Ask');
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
    await tab('Ask');
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
    await tab('Ask');
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

  test('emoji questions stop at 200 bytes and fit with an attached location', async () => {
    const { transport } = await launch();
    await tab('Ask');
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
    expect(screen.getByText('No one nearby')).toBeTruthy();
  });
  test('a sent public message appears in the thread', async () => {
    const { transport } = await launch();
    await fireEvent.changeText(screen.getByLabelText('Message'), 'We are safe at the gate.');
    await tap('Send message');
    expect(screen.getByText('We are safe at the gate.')).toBeTruthy();
    expect(transport.sent[0]).toEqual({ to: 'public', text: 'We are safe at the gate.' });
  });
  test('the composer stops at 255 bytes and an over-limit message cannot be sent', async () => {
    const { runtime, transport } = await launch();
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
    await act(() => transport.sendPhoneMessage('private'));
    expect(screen.queryByText('I’m at the north gate. Are you nearby?')).toBeNull();
    await tap('Open private thread with Phone B');
    expect(screen.getByText('I’m at the north gate. Are you nearby?')).toBeTruthy();
  });
  test('a location row opens Locate on that pin', async () => {
    const { transport } = await launch();
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
    await tab('Locate');
    expect(screen.getByText('◆ Phone B')).toBeTruthy();
    expect(screen.getByText('51.50550, -0.11950')).toBeTruthy();
    expect(screen.getByText(/Offline map needs a development build/)).toBeTruthy();
  });
  test('denied location permission is clear and sharing is disabled', async () => {
    await launch({}, fixedLocation({ kind: 'denied' }));
    await tab('Locate');
    expect(screen.getByText(/Location permission denied/)).toBeTruthy();
    expect(button('Share location')).toBeDisabled();
  });
  test('no position fix has a separate state', async () => {
    await launch({}, fixedLocation({ kind: 'locating' }));
    await tab('Locate');
    expect(screen.getByText(/No position fix yet/)).toBeTruthy();
  });
  test('share recipient picker excludes the hub and emits the contract text', async () => {
    const { transport } = await launch();
    await tab('Locate');
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
  await tab('Locate');
  expect(screen.getByText('◆ Phone B')).toBeTruthy();
});
