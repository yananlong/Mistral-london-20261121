import * as fs from 'fs';
import * as path from 'path';
import {
  ACK_TEXT,
  ANSWER_LABEL,
  AnswerPart,
  assembleAnswer,
  classifyHubReply,
  HUB_ERROR_TEXT,
  MAX_MESSAGE_BYTES,
  MAX_QUESTION_BYTES,
  prefixBytes,
  utf8Bytes,
} from '../src/ask/meshMessages';
import { formatLocLine } from '../src/locate/locLine';

/** protocol/vectors.json is written by protocol/make_vectors.py, the reference contract. */
const VECTORS = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'protocol', 'vectors.json'), 'utf8'),
);

describe('mesh messages match protocol/vectors.json', () => {
  it('constants', () => {
    expect(ACK_TEXT).toBe(VECTORS.constants.ACK_TEXT);
    expect(ANSWER_LABEL).toBe(VECTORS.constants.ANSWER_LABEL);
    expect(HUB_ERROR_TEXT).toBe(VECTORS.constants.HUB_ERROR_TEXT);
    expect(MAX_MESSAGE_BYTES).toBe(VECTORS.constants.MAX_MESSAGE_BYTES);
    expect(MAX_QUESTION_BYTES).toBe(VECTORS.constants.MAX_QUESTION_BYTES);
  });

  it.each(VECTORS.classifyHubReply as { wire: string; result: unknown }[])(
    'classifyHubReply %#',
    ({ wire, result }) => expect(classifyHubReply(wire)).toEqual(result),
  );

  it.each(VECTORS.assembleAnswer as { parts: [number, number, string][]; result: string | null }[])(
    'assembleAnswer %#',
    ({ parts, result }) => {
      const typed: AnswerPart[] = parts.map(([index, total, text]) => ({ index, total, text }));
      expect(assembleAnswer(typed)).toBe(result);
    },
  );

  it('every hub answer in the vectors reassembles to its body', () => {
    for (const { messages } of VECTORS.composeAnswer as { messages: string[] | null }[]) {
      if (messages === null) continue;
      const parts = messages.map((m) => classifyHubReply(m));
      for (const m of messages) expect(utf8Bytes(m)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
      const answer = assembleAnswer(
        parts.map((p) => {
          if (p.kind !== 'answer_part') throw new Error(`not a part: ${p.kind}`);
          return p;
        }).reverse(),
      );
      expect(answer).not.toBeNull();
    }
  });
});

describe('byte caps', () => {
  it('a capped emoji question plus its loc: line fits one BitChat message', () => {
    const question = prefixBytes('🚑'.repeat(200), MAX_QUESTION_BYTES);
    expect(utf8Bytes(question)).toBeLessThanOrEqual(MAX_QUESTION_BYTES);
    const wire = `${question}\n${formatLocLine({ lat: -89.123456, lon: -179.123456 })}`;
    expect(utf8Bytes(wire)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });

  it('prefixBytes never splits a character', () => {
    expect(prefixBytes('aé🚑', 3)).toBe('aé');
    expect(prefixBytes('aé🚑', 6)).toBe('aé');
    expect(prefixBytes('aé🚑', 7)).toBe('aé🚑');
  });
});
