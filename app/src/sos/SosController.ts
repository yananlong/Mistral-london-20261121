import { config } from '../config';
import { Coordinates, encodeSOS, SOS_CANCEL_NOTE } from '../protocol';
import { MeshStore } from '../store/MeshStore';

/**
 * The SOS bar (design/components.html, "Can I get help?"). It asks once,
 * sends a public SOS with where you are (the `loc:` line puts a pin on every
 * map that receives it), then says plainly whether it went. With nobody in
 * range it waits as "Not sent yet" and keeps trying by itself.
 *
 * 999 may not work, so SOS goes to everyone nearby on the mesh. There is no
 * route to emergency services yet, so the app never claims one.
 */
export type SosMode = 'idle' | 'confirm' | 'sending' | 'sent' | 'waiting';

export class SosController {
  private mode: SosMode = 'idle';
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancelled = false;
  constructor(private readonly mesh: MeshStore, private readonly position: () => Coordinates | null) {}
  getSnapshot = (): SosMode => this.mode;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private set(mode: SosMode): void {
    clearTimeout(this.timer);
    this.mode = mode;
    if (mode === 'waiting') this.timer = setTimeout(() => this.flush(), config.retryIntervalMs);
    this.listeners.forEach(listener => listener());
  }
  private canSend(): boolean {
    const mesh = this.mesh.getSnapshot();
    return mesh.link === 'running' && mesh.peers.some(peer => peer.reachable);
  }

  request(): void { if (this.mode === 'idle') this.set('confirm'); }
  async send(): Promise<void> {
    if (this.mode !== 'confirm' && this.mode !== 'waiting') return;
    if (!this.canSend()) { this.set('waiting'); return; }
    this.cancelled = false;
    this.set('sending');
    try {
      await this.mesh.send('public', encodeSOS(this.position()));
      if (this.cancelled) { this.cancelled = false; await this.sendCancel(); return; }
      this.set('sent');
    } catch {
      if (!this.cancelled) this.set('waiting');
    }
  }
  /** Cancel is always there. If the SOS already went out, everyone who got it is told. */
  cancel(): void {
    if (this.mode === 'sending') { this.cancelled = true; this.set('idle'); return; }
    if (this.mode === 'sent') void this.sendCancel();
    this.set('idle');
  }
  private async sendCancel(): Promise<void> {
    try { await this.mesh.send('public', SOS_CANCEL_NOTE); } catch { /* best effort */ }
  }
  /** Called after every mesh change. */
  flush(): void { if (this.mode === 'waiting' && this.canSend()) void this.send(); }
  dispose(): void { clearTimeout(this.timer); }
}
