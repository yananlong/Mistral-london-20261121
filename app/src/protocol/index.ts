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
// Match the reference implementation's Unicode whitespace, which differs from JavaScript trim.
const WHITESPACE = '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const LEADING_WHITESPACE = new RegExp(`^${WHITESPACE}+`, 'u');
const TRAILING_WHITESPACE = new RegExp(`${WHITESPACE}+$`, 'u');
const LOC_PATTERN = new RegExp(`^loc:${WHITESPACE}*(-?\\d{1,3}(?:\\.\\d+)?)${WHITESPACE}*,${WHITESPACE}*(-?\\d{1,3}(?:\\.\\d+)?)$`, 'u');
export const trimStart = (text: string): string => text.replace(LEADING_WHITESPACE, '');
export const trimEnd = (text: string): string => text.replace(TRAILING_WHITESPACE, '');
export const trim = (text: string): string => trimEnd(trimStart(text));

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

export function formatCoordinate(value: number): string {
  if (Object.is(value, -0)) return '-0.00000';
  const absolute = Math.abs(value);
  const sixtyFourths = absolute * 64;
  // Exact halfway values at five decimals are odd multiples of 1/64.
  if (Number.isSafeInteger(sixtyFourths) && sixtyFourths % 2 === 1) {
    const lower = Math.floor(absolute * 100_000);
    const rounded = lower % 2 === 0 ? lower : lower + 1;
    return `${value < 0 ? '-' : ''}${(rounded / 100_000).toFixed(5)}`;
  }
  return value.toFixed(5);
}

export function encodeLoc(lat: number, lon: number): string {
  return `loc: ${formatCoordinate(lat)},${formatCoordinate(lon)}`;
}

export function decodeLoc(line: string): Coordinates | null {
  const match = LOC_PATTERN.exec(trim(line));
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

export function splitTrailingLoc(text: string): { body: string; loc: Coordinates | null } {
  const lines = normalize(text).split('\n');
  while (lines.length && trim(lines[lines.length - 1]) === '') lines.pop();
  const loc = lines.length ? decodeLoc(lines[lines.length - 1]) : null;
  if (loc) lines.pop();
  return { body: trim(lines.join('\n')), loc };
}

export function encodeQuestion(text: string, loc: Coordinates | null): string {
  const body = trim(normalize(text));
  return loc ? `${body}\n${encodeLoc(loc.lat, loc.lon)}` : body;
}

export interface AnswerPart { index: number; total: number; text: string }
export type HubReply = { kind: 'ack' } | { kind: 'hub_error' } | ({ kind: 'answer_part' } & AnswerPart) | { kind: 'other' };

export function classifyHubReply(wire: string): HubReply {
  const text = trim(normalize(wire));
  if (text === ACK_TEXT) return { kind: 'ack' };
  if (text === HUB_ERROR_TEXT) return { kind: 'hub_error' };
  const match = /^\((\d)\/(\d)\) ([\s\S]*)$/.exec(text);
  if (match) {
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (index >= 1 && index <= total) return { kind: 'answer_part', index, total, text: trim(match[3]) };
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
  return trim(body.join('\n'));
}

export function encodeLocationShare(note: string | null, lat: number, lon: number): string {
  return `${(note === null ? '' : trim(note)) || LOCATION_SHARE_DEFAULT_NOTE}\n${encodeLoc(lat, lon)}`;
}

export function decodeLocationShare(wire: string): LocationShare | null {
  const { body, loc } = splitTrailingLoc(wire);
  return loc ? { note: body, ...loc } : null;
}
