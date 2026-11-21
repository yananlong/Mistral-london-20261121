import { ACK_TIMEOUT_MS, Coordinates, encodeQuestion } from '../protocol';
import { MeshStore } from '../store/MeshStore';
import { InboundMessage } from '../transport/types';

/**
 * SOS and family messages travel to the hub the same way questions do.
 * PROPOSED wire format (not yet in ../protocol/README.md, and the hub does not
 * implement it yet; the simulated hub does):
 *   "SOS" + optional "\nloc: lat,lon"     ask for help with where you are
 *   "SOS CANCEL"                           withdraw it
 *   "FAMILY <number>: <text>"             pass a text message on to a contact
 * The hub answers each with RELAY_ACK_TEXT once it has the message.
 */
export const RELAY_ACK_TEXT = 'Relayed.';
export const SOS_WIRE = 'SOS';
export const SOS_CANCEL_WIRE = 'SOS CANCEL';
export const familyWire = (number: string, text: string) => `FAMILY ${number.replace(/\s+/g, '')}: ${text}`;
/** How often an undelivered SOS or family message tries again by itself. */
export const RELAY_RETRY_MS = 30_000;

export type RelayStatus = 'sending' | 'delivered' | 'notSent';
export interface RelayItem { id: number; kind: 'sos' | 'family'; text: string; wire: string; status: RelayStatus }
export interface RelayState { sos: RelayItem | null; family: RelayItem[] }

export interface FamilyContact { name: string; number: string }
/** Placeholder contact (an Ofcom drama number) until contacts can be chosen. */
export const DEMO_CONTACT: FamilyContact = { name: 'Mum', number: '07700 900123' };

export class RelayStore {
  private state: RelayState = { sos: null, family: [] };
  private listeners = new Set<() => void>();
  private serial = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Items waiting for the hub's "Relayed.", oldest first. */
  private pending: number[] = [];
  constructor(private readonly mesh: MeshStore) {}
  getSnapshot = (): RelayState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: RelayState): void { this.state = state; this.listeners.forEach(listener => listener()); }
  private patch(id: number, status: RelayStatus): void {
    const { sos, family } = this.state;
    this.publish({
      sos: sos?.id === id ? { ...sos, status } : sos,
      family: family.map(item => item.id === id ? { ...item, status } : item),
    });
  }
  private find(id: number): RelayItem | undefined {
    return this.state.sos?.id === id ? this.state.sos : this.state.family.find(item => item.id === id);
  }

  sendSos(location: Coordinates | null): void {
    if (this.state.sos) return;
    const item: RelayItem = { id: ++this.serial, kind: 'sos', text: SOS_WIRE, wire: encodeQuestion(SOS_WIRE, location), status: 'sending' };
    this.publish({ ...this.state, sos: item });
    this.attempt(item.id);
  }

  cancelSos(): void {
    const sos = this.state.sos;
    if (!sos) return;
    this.stop(sos.id);
    this.publish({ ...this.state, sos: null });
    const hub = this.mesh.getSnapshot().hubId;
    if (hub && sos.status === 'delivered') void this.mesh.send(hub, SOS_CANCEL_WIRE).catch(() => {});
  }

  sendFamily(contact: FamilyContact, text: string): void {
    const item: RelayItem = { id: ++this.serial, kind: 'family', text, wire: familyWire(contact.number, text), status: 'sending' };
    this.publish({ ...this.state, family: [...this.state.family, item] });
    this.attempt(item.id);
  }

  receive(message: InboundMessage): void {
    const hub = this.mesh.getSnapshot().hubId;
    if (message.channel !== 'private' || message.from !== hub || message.text.trim() !== RELAY_ACK_TEXT) return;
    const id = this.pending.shift();
    if (id === undefined) return;
    this.stop(id);
    this.patch(id, 'delivered');
  }

  private attempt(id: number): void {
    const item = this.find(id);
    if (!item) return;
    const hub = this.mesh.getSnapshot().hubId;
    if (item.status !== 'sending') this.patch(id, 'sending');
    const fail = () => {
      this.stop(id);
      if (!this.find(id)) return;
      this.patch(id, 'notSent');
      // Not sent yet: it keeps trying by itself. Nothing to tap.
      this.timers.set(id, setTimeout(() => this.attempt(id), RELAY_RETRY_MS));
    };
    if (!hub) { fail(); return; }
    this.pending = [...this.pending.filter(other => other !== id), id];
    this.timers.set(id, setTimeout(fail, ACK_TIMEOUT_MS));
    void this.mesh.send(hub, item.wire).catch(fail);
  }

  private stop(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.pending = this.pending.filter(other => other !== id);
  }

  dispose(): void { this.timers.forEach(clearTimeout); this.timers.clear(); }
}
