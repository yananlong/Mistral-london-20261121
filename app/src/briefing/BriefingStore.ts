import { Briefing, BriefingView } from './types';

/**
 * Holds the current briefing. Each update marks which of the three answers
 * changed, so the screen can tag them "New" until the next update.
 */
export class BriefingStore {
  private view: BriefingView;
  private listeners = new Set<() => void>();
  constructor(initial: Briefing) { this.view = { ...initial, changed: new Set() }; }
  getSnapshot = (): BriefingView => this.view;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  set(next: Briefing): void {
    const changed = new Set<'happened' | 'why' | 'fixed'>();
    (['happened', 'why', 'fixed'] as const).forEach(key => {
      const before = this.view[key]?.text ?? null;
      const after = next[key]?.text ?? null;
      if (after !== null && after !== before) changed.add(key);
    });
    this.view = { ...next, changed };
    this.listeners.forEach(listener => listener());
  }
}
