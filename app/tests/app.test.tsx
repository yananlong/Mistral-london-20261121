import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { MeshApp } from '../src/AppShell';
import { demoLocation, fixedLocation, LocationSource } from '../src/location/LocationStore';
import { ACK_TEXT, ACK_TIMEOUT_MS, ANSWER_LABEL, ANSWER_TIMEOUT_MS, decodeLocationShare, HUB_NICKNAME } from '../src/protocol';
import { DISCLAIMER } from '../src/screens/AskScreen';
import { AppRuntime } from '../src/store/Runtime';
import { HUB_ID, SimulatedTransport } from '../src/transport/SimulatedTransport';

async function launch(options: ConstructorParameters<typeof SimulatedTransport>[0] = {}, source: LocationSource = demoLocation) {
  const transport = new SimulatedTransport(options);
  const runtime = new AppRuntime({ transport, simulation: transport }, source);
  await render(<MeshApp runtime={runtime} />);
  return { runtime, transport };
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
    const { transport } = await launch();
    await tab('Ask');
    await tap('Make water safe to drink');
    await advance(800);
    await act(() => transport.setHubMode('offline'));
    await advance(ANSWER_TIMEOUT_MS - 1);
    expect(screen.getByText('Received by hub')).toBeTruthy();
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
    await act(() => reply(`1. A late answer.\n${ANSWER_LABEL}`));
    expect(screen.getByText('Answered')).toBeTruthy();
    await act(() => { reply(ACK_TEXT); reply(`1. Duplicate answer.\n${ANSWER_LABEL}`); });
    expect(screen.getByText('1. A late answer.')).toBeTruthy();
    expect(screen.queryByText('1. Duplicate answer.')).toBeNull();
  });

  test('free text is capped at 500 UTF-16 units without splitting an emoji', async () => {
    const { transport } = await launch();
    await tab('Ask');
    await fireEvent.changeText(screen.getByLabelText('Your question'), `${'x'.repeat(499)}😀`);
    await tap('Send question');
    expect(transport.hubInbox[0]).toBe('x'.repeat(499));
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
