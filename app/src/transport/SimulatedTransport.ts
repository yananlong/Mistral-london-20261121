import { ACK_TEXT, HUB_EMPTY_TEXT, HUB_ERROR_TEXT, HUB_NICKNAME, MAX_MESSAGE_BYTES, utf8Bytes, encodeLocationShare } from '../protocol';
import { composeAnswer, parseQuestion } from './simulatedHub';
import { HubMode, InboundMessage, Peer, SimulationControls, Transport, TransportEvent, peerId, PeerId } from './types';

export const PHONE_B_ID = peerId('sim-phone-b');
export const HUB_ID = peerId('sim-hub');
const PHONE: Peer = { id: PHONE_B_ID, nickname: 'Phone B', reachable: true };
const HUB: Peer = { id: HUB_ID, nickname: HUB_NICKNAME, reachable: true };

// Deliberately canned examples: this transport never calls an AI service.
const ANSWERS: Record<string, string> = {
  water: '1. Use sealed bottled water if you have it.\n2. Boiling does not remove chemicals. Avoid water that may be chemically contaminated.\n3. For clear water with a biological risk, bring it to a rolling boil for at least 1 minute, then let it cool in a clean, covered container.',
  bleeding: '1. Call 999 or 112 if you can.\n2. Press firmly on the wound with a clean cloth or dressing. Keep pressing.\n3. If an object is embedded, press around it and leave it in place. Keep the person warm while help comes.',
  warm: '1. Move to a dry room, close doors and put on dry layers.\n2. Use blankets and stay together.\n3. Keep generators, barbecues and camping stoves outside, well away from windows and doors. They can cause fatal carbon monoxide poisoning indoors.',
  food: '1. Keep the fridge and freezer doors closed.\n2. A fridge usually keeps food cold for about 4 hours without power.\n3. Discard perishable food if it has been too warm or you are unsure. Never taste food to check it is safe.',
  carbon: '1. Get everyone into fresh air immediately. Do not re-enter the building.\n2. Signs include headache, dizziness, nausea, weakness, confusion and breathlessness.\n3. Call 999 or 112 if you can and say you suspect carbon monoxide poisoning.',
  burn: '1. Cool the burn under cool or lukewarm running water for 20 minutes.\n2. Remove jewellery and loose clothing near it, leaving anything stuck to the skin.\n3. Cover loosely with cling film laid over it. Use no ice or creams. Seek urgent help for a large, deep, chemical or electrical burn.',
  generic: '1. Move away from immediate danger if you can do so safely.\n2. Contact 999 or 112 if you can reach them.\n3. Ask people nearby for help and follow local emergency instructions when available. This is a canned demo response; no model has run.',
};

function answerFor(question: string): string {
  const text = question.toLowerCase();
  const topic = /water|drink/.test(text) ? 'water' : /bleed/.test(text) ? 'bleeding'
    : /warm|power/.test(text) && !/food|fridge/.test(text) ? 'warm'
    : /fridge|food/.test(text) ? 'food' : /carbon|monoxide/.test(text) ? 'carbon'
    : /burn/.test(text) ? 'burn' : 'generic';
  return ANSWERS[topic];
}

export class SimulatedTransport implements Transport, SimulationControls {
  readonly kind: Transport['kind'] = 'simulated';
  protected readonly hubPeer: Peer = HUB;
  readonly hubInbox: string[] = [];
  readonly sent: { to: PeerId | 'public'; text: string }[] = [];
  private listeners = new Set<(event: TransportEvent) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private mode: HubMode = 'online';
  private state: 'running' | 'stopped' = 'stopped';
  private phoneNearby = true;
  private serial = 0;
  private hubAvailableAt = 0;

  constructor(options: { hubMode?: HubMode; phoneNearby?: boolean } = {}) {
    this.mode = options.hubMode ?? 'online';
    this.phoneNearby = options.phoneNearby ?? true;
  }

  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  protected emit(event: TransportEvent): void { this.listeners.forEach(listener => listener(event)); }
  private peers(): Peer[] { return [...(this.phoneNearby ? [PHONE] : []), ...(this.mode === 'offline' ? [] : [HUB])]; }
  private announcePeers(): void { if (this.state === 'running') this.emit({ type: 'peers', peers: this.peers() }); }

  async start(_nickname: string): Promise<void> {
    this.emit({ type: 'state', state: 'starting' });
    this.state = 'running';
    this.emit({ type: 'state', state: 'running' });
    this.announcePeers();
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.hubAvailableAt = 0;
    this.emit({ type: 'peers', peers: [] });
    this.emit({ type: 'state', state: 'stopped' });
  }

  private later(delay: number, callback: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.state === 'running') callback();
    }, delay);
    this.timers.add(timer);
  }

  protected inbound(from: Peer, text: string, channel: 'public' | 'private'): void {
    const message: InboundMessage = { id: `sim-${++this.serial}`, from: from.id, fromNickname: from.nickname, text, channel, receivedAt: Date.now() };
    this.emit({ type: 'message', message });
  }

  protected isRunning(): boolean { return this.state === 'running'; }
  protected checkRunning(): void { if (this.state !== 'running') throw new Error('The link is stopped. Start it before sending.'); }
  protected checkMessage(text: string): void { if (utf8Bytes(text) > MAX_MESSAGE_BYTES) throw new Error('The message exceeds the mesh byte limit.'); }

  async sendPublic(text: string): Promise<void> {
    this.checkRunning();
    this.checkMessage(text);
    this.sent.push({ to: 'public', text });
  }

  async sendPrivate(to: PeerId, text: string): Promise<void> {
    this.checkRunning();
    this.checkMessage(text);
    this.sent.push({ to, text });
    if (to !== HUB_ID || this.mode === 'offline') return;
    this.hubInbox.push(text);
    const question = parseQuestion(text);
    const queuedFor = Math.max(0, this.hubAvailableAt - Date.now());
    if (question.kind === 'empty') {
      this.later(queuedFor + 800, () => { if (this.mode !== 'offline') this.inbound(HUB, HUB_EMPTY_TEXT, 'private'); });
      return;
    }
    const mode = this.mode;
    this.hubAvailableAt = Date.now() + queuedFor + 3300;
    this.later(queuedFor + 800, () => { if (this.mode !== 'offline') this.inbound(HUB, ACK_TEXT, 'private'); });
    this.later(queuedFor + 3300, () => {
      if (this.mode === 'offline') return;
      const messages = mode === 'error' ? [HUB_ERROR_TEXT] : composeAnswer(answerFor(question.body)) ?? [HUB_ERROR_TEXT];
      messages.forEach(message => this.inbound(HUB, message, 'private'));
    });
  }

  getHubMode(): HubMode { return this.mode; }
  setHubMode(mode: HubMode): void { this.mode = mode; this.announcePeers(); }
  setPhoneNearby(nearby: boolean): void { this.phoneNearby = nearby; this.announcePeers(); }
  sendPhoneMessage(channel: 'public' | 'private'): void {
    if (this.state === 'running' && this.phoneNearby) this.inbound(PHONE, 'I’m at the north gate. Are you nearby?', channel);
  }
  sendPhoneLocation(): void {
    if (this.state === 'running' && this.phoneNearby) this.inbound(PHONE, encodeLocationShare('I’m at the north gate', 51.5055, -0.1195), 'private');
  }
}
