import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { QUESTION_RETRY_MS } from '../src/ask/QuestionThread';
import { MeshApp } from '../src/AppShell';
import { HOW_IT_WORKS, SOS_RECIPIENT } from '../src/components/Dock';
import { demoLocation, LocationSource } from '../src/location/LocationStore';
import { ACK_TIMEOUT_MS, MAX_QUESTION_BYTES, utf8Bytes } from '../src/protocol';
import { SOS_CANCEL_WIRE } from '../src/relay/RelayStore';
import { QUIET_GRACE_MS } from '../src/screens/HomeScreen';
import { AppRuntime } from '../src/store/Runtime';
import { HUB_ID, SimulatedTransport } from '../src/transport/SimulatedTransport';
import { createTransport } from '../src/transport/factory';
import { TransportEvent } from '../src/transport/types';

async function launch(options: ConstructorParameters<typeof SimulatedTransport>[0] = {}, source: LocationSource = demoLocation,
  transport = new SimulatedTransport(options), scheme?: 'dark' | 'light') {
  const runtime = new AppRuntime({ transport, simulation: transport }, source);
  await render(<MeshApp runtime={runtime} scheme={scheme} />);
  await act(async () => {});
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
const ask = async (text: string) => {
  await fireEvent.changeText(screen.getByLabelText('Ask anything'), text);
  await tap('Send');
};

beforeEach(() => { jest.useFakeTimers(); });
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

test('the app falls back to the simulated link when the native module is unavailable', () => {
  const selection = createTransport();
  expect(selection.transport.kind).toBe('simulated');
  expect(selection.simulation).toBeDefined();
});

describe('What is going on', () => {
  test('opens on the one fact, the six topics and the three questions', async () => {
    await launch();
    expect(screen.getByText('No phone signal.')).toBeTruthy();
    expect(screen.getByText('Since 2:05pm.')).toBeTruthy();
    expect(screen.getByText('Southwark, updated 2:05pm')).toBeTruthy();
    expect(screen.getByText('What you can find')).toBeTruthy();
    expect(button('Water, Nothing yet')).toBeTruthy();
    expect(button('Family, Send a message')).toBeTruthy();
    expect(button('First aid, On your phone')).toBeTruthy();
    expect(screen.getByText('Calls, texts and internet stopped. 999 may not work.')).toBeTruthy();
    expect(screen.getAllByText('Not known yet')).toHaveLength(2);
    expect(screen.getByText('In danger? Ask for help.')).toBeTruthy();
  });

  test('never talks about the connection', async () => {
    await launch();
    for (const word of [/online/i, /offline/i, /connected/i, /nearby/i, /\bhub\b/i, /mesh/i, /peer/i]) {
      expect(screen.queryByText(word)).toBeNull();
    }
  });

  test('news replaces "Not known yet" and is tagged New', async () => {
    const { runtime } = await launch();
    await tap('Demo controls');
    await tap('Some known');
    expect(screen.getByText('Power is off.')).toBeTruthy();
    expect(button('Water, 2 places')).toBeTruthy();
    expect(button('Shelter, 1 place')).toBeTruthy();
    expect(button('Food, Nothing yet')).toBeTruthy();
    await tap('All known');
    expect(screen.getByText('Back by about 8pm.')).toBeTruthy();
    expect(screen.getByText('Broken power equipment in Bankside.')).toBeTruthy();
    expect(screen.getByText('About 8pm. Not certain.')).toBeTruthy();
    expect(screen.getAllByText('New')).toHaveLength(2);
    expect(screen.queryByText('Not known yet')).toBeNull();
    await tap('Fixed');
    expect(screen.getByText('Power is back.')).toBeTruthy();
    expect(runtime.briefing.getSnapshot().changed.has('why')).toBe(false);
  });
});

describe('Did my message get through', () => {
  test('a question goes Sending, Delivered, Answered, with the answer and where it came from', async () => {
    const { transport } = await launch();
    await ask('Where can I charge my phone?');
    expect(screen.getByText('Sending')).toBeTruthy();
    await advance(800);
    expect(screen.getByText('Delivered')).toBeTruthy();
    await advance(2500);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText('Southwark Library, 450 m away. It has power. Bring your own cable. Open until 6pm.')).toBeTruthy();
    expect(screen.getByText(/^Computer answer, /)).toBeTruthy();
    expect(transport.hubInbox).toEqual(['Where can I charge my phone?']);
  });

  test('out-of-order answer parts assemble the full answer', async () => {
    await launch({}, demoLocation, new OutOfOrderTransport());
    await ask('How do I make water safe to drink?');
    await advance(3300);
    expect(screen.getByText('Delivered')).toBeTruthy();
    await advance(100);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText(/1\. Use sealed bottled water if you have it\.\s2\. Boiling/)).toBeTruthy();
  });

  test('a message that cannot get through says so and sends by itself later', async () => {
    const { transport } = await launch();
    await act(() => transport.setHubMode('offline'));
    await ask('Is the tube running?');
    expect(screen.getByText('Sending')).toBeTruthy();
    await advance(ACK_TIMEOUT_MS);
    expect(screen.getByText('Not sent yet')).toBeTruthy();
    expect(screen.getByText('Not getting through right now')).toBeTruthy();
    expect(screen.getByText('The app keeps trying. First aid and the news still work.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await act(() => transport.setHubMode('online'));
    await advance(QUESTION_RETRY_MS);
    await advance(3300);
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText('No tubes are running in central London. Buses are running.')).toBeTruthy();
    expect(screen.queryByText('Not getting through right now')).toBeNull();
    expect(transport.sent.filter(item => item.to === HUB_ID).map(item => item.text)).toEqual(['Is the tube running?', 'Is the tube running?']);
  });

  test('a failed answer shows No answer yet and tries again by itself', async () => {
    const { transport } = await launch({ hubMode: 'error' });
    await ask('How do I treat a burn?');
    await advance(3300);
    expect(screen.getByText('No answer yet')).toBeTruthy();
    await act(() => transport.setHubMode('online'));
    await advance(QUESTION_RETRY_MS + 3300);
    expect(screen.getByText('Answered')).toBeTruthy();
  });

  test('a second question waits, then goes by itself after the first is answered', async () => {
    const { transport } = await launch();
    await ask('Where can I charge my phone?');
    await ask('Is the tube running?');
    expect(screen.getByText('Not sent yet')).toBeTruthy();
    expect(transport.hubInbox).toHaveLength(1);
    await advance(3300);
    expect(transport.hubInbox).toEqual(['Where can I charge my phone?', 'Is the tube running?']);
    await advance(3300);
    expect(screen.getAllByText('Answered')).toHaveLength(2);
  });

  test('the question box stops at the 200-byte limit', async () => {
    const { transport } = await launch();
    await ask('🚑'.repeat(80));
    expect(utf8Bytes(transport.hubInbox[0])).toBeLessThanOrEqual(MAX_QUESTION_BYTES);
    expect(button('Send')).toBeDisabled();
  });

  test('Bluetooth off shows the one thing to do, with the button that does it', async () => {
    const { transport } = await launch();
    await act(() => transport.setBluetooth(false));
    expect(screen.getByText('Bluetooth is off')).toBeTruthy();
    expect(screen.getByText('Turn it on to send questions. First aid works without it.')).toBeTruthy();
    await tap('Turn on Bluetooth');
    expect(screen.queryByText('Bluetooth is off')).toBeNull();
  });

  test('with nobody to pass messages on, it says Not getting through and explains in one tap', async () => {
    const { transport } = await launch({ hubMode: 'offline', phoneNearby: false });
    expect(screen.queryByText('Not getting through right now')).toBeNull();
    await advance(QUIET_GRACE_MS);
    expect(screen.getByText('Not getting through right now')).toBeTruthy();
    await tap('How does this work?');
    expect(screen.getByText(HOW_IT_WORKS)).toBeTruthy();
    await act(() => transport.setHubMode('online'));
    expect(screen.queryByText('Not getting through right now')).toBeNull();
  });
});

describe('Can I get help', () => {
  test('SOS asks once, sends where you are, says who has it, and can be cancelled', async () => {
    const { transport } = await launch();
    await tap('SOS. Ask for help');
    expect(screen.getByText('Send SOS?')).toBeTruthy();
    expect(screen.getByText('It asks for help and sends where you are.')).toBeTruthy();
    expect(transport.hubInbox).toHaveLength(0);
    await tap('Send SOS');
    expect(screen.getByText('Sending SOS')).toBeTruthy();
    expect(transport.hubInbox[0]).toBe('SOS\nloc: 51.50070,-0.12460');
    await advance(800);
    expect(screen.getByText(`SOS delivered to ${SOS_RECIPIENT}.`)).toBeTruthy();
    await tap('Cancel SOS');
    expect(screen.getByText('In danger? Ask for help.')).toBeTruthy();
    expect(transport.hubInbox[1]).toBe(SOS_CANCEL_WIRE);
  });

  test('cancel on the question sends nothing', async () => {
    const { transport } = await launch();
    await tap('SOS. Ask for help');
    await tap('Cancel');
    expect(screen.getByText('In danger? Ask for help.')).toBeTruthy();
    expect(transport.sent).toHaveLength(0);
  });

  test('an SOS that cannot get through keeps trying by itself', async () => {
    const { transport } = await launch({ hubMode: 'offline' });
    await tap('SOS. Ask for help');
    await tap('Send SOS');
    await advance(ACK_TIMEOUT_MS);
    expect(screen.getByText('SOS not sent yet. The app keeps trying.')).toBeTruthy();
    await act(() => transport.setHubMode('online'));
    await advance(QUESTION_RETRY_MS + 800);
    expect(screen.getByText(`SOS delivered to ${SOS_RECIPIENT}.`)).toBeTruthy();
  });
});

describe('What can I find', () => {
  test('a topic opens as a sheet with each place, how far, what is there and who said so', async () => {
    await launch();
    await tap('Demo controls');
    await tap('Some known');
    await tap('Water, 2 places');
    expect(screen.getByText('Where can I get drinking water?')).toBeTruthy();
    expect(screen.getByText('Southwark Cathedral')).toBeTruthy();
    expect(screen.getByText('300 m, 4 min walk')).toBeTruthy();
    expect(screen.getByText('Free bottled water. Open until 8pm.')).toBeTruthy();
    expect(screen.getAllByText('From Southwark Council, 2:30pm')).toHaveLength(2);
    await tap('Close');
    expect(screen.queryByText('Where can I get drinking water?')).toBeNull();
  });

  test('a topic with nothing yet can still be asked about', async () => {
    const { transport } = await launch();
    await tap('Food, Nothing yet');
    expect(screen.getByText('Nobody has shared this yet. You can still ask.')).toBeTruthy();
    await tap('Ask');
    expect(transport.hubInbox).toEqual(['Where can I get food?']);
    expect(screen.getByText('Sending')).toBeTruthy();
  });

  test('family gets a ready message as a text, and it says when it is delivered', async () => {
    const { transport } = await launch();
    await tap('Family, Send a message');
    expect(screen.getByText('How can I reach my family?')).toBeTruthy();
    expect(screen.getByText('Gets it as a text message, 07700 900123')).toBeTruthy();
    await tap("Send I'm OK to Mum");
    expect(transport.hubInbox[0]).toBe("FAMILY 07700900123: I'm OK.");
    expect(screen.getByText('Sending')).toBeTruthy();
    await advance(800);
    expect(screen.getByText('Delivered to Mum')).toBeTruthy();
  });

  test('first aid works on the phone, one step at a time', async () => {
    const { transport } = await launch();
    await act(() => transport.setBluetooth(false));
    await tap('First aid, On your phone');
    await tap('Heavy bleeding');
    expect(screen.getByText('Heavy bleeding. Step 1 of 4')).toBeTruthy();
    expect(screen.getByText('Press firmly on the wound with a clean cloth or dressing.')).toBeTruthy();
    await tap('Next step');
    expect(screen.getByText('Keep pressing. Do not lift it to look.')).toBeTruthy();
    await tap('Back');
    expect(screen.getByText('Heavy bleeding. Step 1 of 4')).toBeTruthy();
    expect(transport.sent).toHaveLength(0);
  });
});

test('the light palette renders the same screen', async () => {
  await launch({}, demoLocation, undefined, 'light');
  expect(screen.getByText('No phone signal.')).toBeTruthy();
});
