/**
 * Mesh message limits and hub answer parts, per protocol/README.md.
 *
 * BitChat rejects private message content over 255 UTF-8 bytes
 * (bitchat/bitchat/Protocols/Packets.swift:251-265). So a question is capped
 * at MAX_QUESTION_BYTES, leaving room for its loc: line, and the hub sends each
 * answer as "(i/n) " parts with the AI label as the last part. This file ports
 * the phone side of protocol/make_vectors.py; __tests__/meshMessages.test.ts
 * checks it against protocol/vectors.json.
 */

export const MAX_MESSAGE_BYTES = 255;
export const MAX_QUESTION_BYTES = 200;
export const ACK_TEXT = 'Received. Working on an answer.';
export const HUB_ERROR_TEXT = 'The hub could not answer right now. Please try again.';
export const ANSWER_LABEL =
  'AI answer from an open-weight model on the hub. Not verified emergency advice.';

// Python str.strip() whitespace, so trimming matches the reference implementation.
const WHITESPACE =
  '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const LEADING_WHITESPACE = new RegExp(`^${WHITESPACE}+`, 'u');
const TRAILING_WHITESPACE = new RegExp(`${WHITESPACE}+$`, 'u');
const PART = /^\((\d)\/(\d)\) ([\s\S]*)$/;

const trim = (text: string): string =>
  text.replace(LEADING_WHITESPACE, '').replace(TRAILING_WHITESPACE, '');
const normalize = (text: string): string => text.replace(/\r\n?/g, '\n');

function characterBytes(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) bytes += characterBytes(character);
  return bytes;
}

/** The longest prefix of `text` within `limit` UTF-8 bytes, never splitting a character. */
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

export interface AnswerPart {
  index: number;
  total: number;
  text: string;
}

export type HubReply =
  | { kind: 'ack' }
  | { kind: 'hub_error' }
  | ({ kind: 'answer_part' } & AnswerPart)
  | { kind: 'other' };

export function classifyHubReply(wire: string): HubReply {
  const text = trim(normalize(wire));
  if (text === ACK_TEXT) return { kind: 'ack' };
  if (text === HUB_ERROR_TEXT) return { kind: 'hub_error' };
  const match = PART.exec(text);
  if (match) {
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (index >= 1 && index <= total) {
      return { kind: 'answer_part', index, total, text: trim(match[3]) };
    }
  }
  return { kind: 'other' };
}

/**
 * The answer body once every part 1..total has arrived and the last part is
 * the AI label, else null. Parts may arrive out of order or twice.
 */
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
