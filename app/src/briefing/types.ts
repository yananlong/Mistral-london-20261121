import { Coordinates } from '../protocol';

/** A fact with who said it and when. Official text is passed on word for word. */
export interface Fact { text: string; source: string; at: number }

/** One place a topic points to: how far, what's there, and who said so. */
export interface Place { id: string; name: string; distance: string; detail: string; source: string; at: number; position: Coordinates }

export type TopicId = 'water' | 'charge' | 'food' | 'family' | 'shelter' | 'firstAid';
export const TOPIC_IDS: TopicId[] = ['water', 'charge', 'food', 'family', 'shelter', 'firstAid'];

/** What the opening screen shows: one big line, one fact under it, then three questions. */
export interface Briefing {
  area: string;
  updatedAt: number;
  /** Icon beside the "updated" line: no phone signal, power cut, or fixed. */
  kind: 'no-signal' | 'power-off' | 'fixed';
  headline: string;
  subline: string;
  happened: Fact | null;
  why: Fact | null;
  fixed: Fact | null;
  places: Partial<Record<TopicId, Place[]>>;
}

/** A briefing plus which answers changed since the last one, for the "New" tag. */
export interface BriefingView extends Briefing { changed: Set<'happened' | 'why' | 'fixed'> }

export function formatTime(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  const m = d.getMinutes();
  // "8pm", not "20:00".
  return `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}${h < 12 ? 'am' : 'pm'}`;
}
