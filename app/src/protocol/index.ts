export const HUB_NICKNAME = 'hub';
export const ACK_TEXT = 'Received. Working on an answer.';
export const ANSWER_LABEL = 'AI answer from an open-weight model on the hub. Not verified emergency advice.';
export const HUB_ERROR_TEXT = 'The hub could not answer right now. Please try again.';
export const HUB_EMPTY_TEXT = 'Send a question in plain words, for example: How do I make water safe to drink?';
export const LOCATION_SHARE_DEFAULT_NOTE = 'Shared location';
export const MAX_MESSAGE_BYTES = 255;
export const MAX_QUESTION_BYTES = 200;
export const MAX_ANSWER_BODY_BYTES = 900;
export const MAX_ANSWER_PARTS = 9;
export const ACK_TIMEOUT_MS = 30_000;
export const ANSWER_TIMEOUT_MS = 150_000;
export const HUB_MODEL_TIMEOUT_MS = 120_000;

export const CONSTANTS = {
  HUB_NICKNAME, ACK_TEXT, ANSWER_LABEL, HUB_ERROR_TEXT, HUB_EMPTY_TEXT,
  LOCATION_SHARE_DEFAULT_NOTE, MAX_MESSAGE_BYTES, MAX_QUESTION_BYTES, MAX_ANSWER_BODY_BYTES, MAX_ANSWER_PARTS,
  ACK_TIMEOUT_MS, ANSWER_TIMEOUT_MS, HUB_MODEL_TIMEOUT_MS,
};

export interface Coordinates { lat: number; lon: number }
export interface LocationShare extends Coordinates { note: string }

export const normalize = (text: string): string => text.replace(/\r\n?/g, '\n');

function characterBytes(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) bytes += characterBytes(character);
  return bytes;
}

/** Cut by UTF-8 bytes without splitting a Unicode code point. */
export function prefixBytes(text: string, limit: number): string {
  let result = '';
  let used = 0;
  for (const character of text) {
    const bytes = characterBytes(character);
    if (used + bytes > limit) break;
    result += character;
    used += bytes;
  }
  return result;
}

export function encodeLoc(lat: number, lon: number): string {
  return `loc: ${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export function decodeLoc(line: string): Coordinates | null {
  const match = /^loc:\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(line.trim());
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

export function splitTrailingLoc(text: string): { body: string; loc: Coordinates | null } {
  const lines = normalize(text).split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const loc = lines.length ? decodeLoc(lines[lines.length - 1]) : null;
  if (loc) lines.pop();
  return { body: lines.join('\n').trim(), loc };
}

export function encodeQuestion(text: string, loc: Coordinates | null): string {
  const body = normalize(text).trim();
  return loc ? `${body}\n${encodeLoc(loc.lat, loc.lon)}` : body;
}

export interface AnswerPart { index: number; total: number; text: string }
export type HubReply = { kind: 'ack' } | { kind: 'hub_error' } | ({ kind: 'answer_part' } & AnswerPart) | { kind: 'other' };

export function classifyHubReply(wire: string): HubReply {
  const text = normalize(wire).trim();
  if (text === ACK_TEXT) return { kind: 'ack' };
  if (text === HUB_ERROR_TEXT) return { kind: 'hub_error' };
  const match = /^\((\d)\/(\d)\) ([\s\S]*)$/.exec(text);
  if (match) {
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (index >= 1 && index <= total) return { kind: 'answer_part', index, total, text: match[3].trim() };
  }
  return { kind: 'other' };
}

export function assembleAnswer(parts: readonly AnswerPart[]): string | null {
  if (parts.length === 0) return null;
  const total = parts[parts.length - 1].total;
  const received = new Map<number, string>();
  for (const part of parts) if (part.total === total) received.set(part.index, part.text);
  if (received.size !== total || received.get(total) !== ANSWER_LABEL) return null;
  const body: string[] = [];
  for (let index = 1; index < total; index++) {
    const text = received.get(index);
    if (text === undefined) return null;
    body.push(text);
  }
  return body.join('\n').trim();
}

export function encodeLocationShare(note: string | null, lat: number, lon: number): string {
  return `${note?.trim() || LOCATION_SHARE_DEFAULT_NOTE}\n${encodeLoc(lat, lon)}`;
}

export function decodeLocationShare(wire: string): LocationShare | null {
  const { body, loc } = splitTrailingLoc(wire);
  return loc ? { note: body, ...loc } : null;
}
