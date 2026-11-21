import { ANSWER_LABEL, Coordinates, MAX_ANSWER_BODY_BYTES, MAX_ANSWER_PARTS, MAX_MESSAGE_BYTES, MAX_QUESTION_BYTES, normalize, prefixBytes, splitTrailingLoc, utf8Bytes } from '../protocol';

export function parseQuestion(wire: string): { kind: 'empty' | 'question'; body: string; loc: Coordinates | null } {
  const { body, loc } = splitTrailingLoc(wire);
  return body === '' ? { kind: 'empty', body, loc } : { kind: 'question', body: prefixBytes(body, MAX_QUESTION_BYTES), loc };
}

function truncateBody(body: string): string {
  if (utf8Bytes(body) <= MAX_ANSWER_BODY_BYTES) return body;
  let cut = Array.from(prefixBytes(body, MAX_ANSWER_BODY_BYTES - utf8Bytes('…')));
  const floor = Math.floor(MAX_ANSWER_BODY_BYTES / 2);
  const newline = cut.lastIndexOf('\n');
  if (newline >= floor) cut = cut.slice(0, newline);
  else {
    const space = cut.lastIndexOf(' ');
    if (space >= floor) cut = cut.slice(0, space);
  }
  return `${cut.join('').trimEnd()}…`;
}

function splitAnswer(body: string): string[] {
  const limit = MAX_MESSAGE_BYTES - utf8Bytes('(9/9) ');
  let current = '';
  let chunks: string[] = [];
  for (let line of body.split('\n')) {
    while (utf8Bytes(line) > limit) {
      let head = prefixBytes(line, limit);
      const characters = Array.from(head);
      const space = characters.lastIndexOf(' ');
      if (space >= Math.floor(characters.length / 2)) head = characters.slice(0, space).join('');
      if (current) { chunks.push(current); current = ''; }
      chunks.push(head);
      line = Array.from(line).slice(Array.from(head).length).join('').trimStart();
    }
    const candidate = current === '' ? line : `${current}\n${line}`;
    if (utf8Bytes(candidate) <= limit) current = candidate;
    else { chunks.push(current); current = line; }
  }
  chunks.push(current);
  chunks = chunks.map(chunk => chunk.trim()).filter(Boolean);
  if (chunks.length > MAX_ANSWER_PARTS - 1) {
    chunks = chunks.slice(0, MAX_ANSWER_PARTS - 1);
    const last = chunks.length - 1;
    chunks[last] = `${prefixBytes(chunks[last], limit - utf8Bytes('…')).trimEnd()}…`;
  }
  return chunks;
}

export function composeAnswer(modelOutput: string): string[] | null {
  const lines = normalize(modelOutput).split('\n').filter(line => line.trim() !== ANSWER_LABEL);
  const body = lines.join('\n').trim();
  if (!body) return null;
  const parts = [...splitAnswer(truncateBody(body)), ANSWER_LABEL];
  return parts.map((part, index) => `(${index + 1}/${parts.length}) ${part}`);
}
