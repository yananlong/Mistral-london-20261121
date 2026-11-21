import vectors from '../../protocol/vectors.json';
import { ASK_EVENTS, ASK_STATES, ASK_TABLE, askReducer } from '../src/ask/machine';
import { ANSWER_LABEL, CONSTANTS, MAX_MESSAGE_BYTES, assembleAnswer, classifyHubReply, decodeLoc, decodeLocationShare, encodeLoc, encodeLocationShare, encodeQuestion, prefixBytes, utf8Bytes } from '../src/protocol';
import { composeAnswer, parseQuestion } from '../src/transport/simulatedHub';

describe('shared protocol vectors (read from the repository contract)', () => {
  test.each(Object.entries(vectors.constants))('constant %s', (name, expected) => {
    expect(CONSTANTS).toHaveProperty(name, expected);
  });
  test.each(vectors.locEncode)('encode $line', ({ lat, lon, line }) => expect(encodeLoc(lat, lon)).toBe(line));
  test.each(vectors.locDecode)('decode $line', ({ line, result }) => expect(decodeLoc(line)).toEqual(result));
  test.each(vectors.encodeQuestion)('question $text', ({ text, loc, wire }) => expect(encodeQuestion(text, loc)).toBe(wire));
  test.each(vectors.parseQuestion)('simulated hub parses $wire', ({ wire, result }) => expect(parseQuestion(wire)).toEqual(result));
  test.each(vectors.composeAnswer)('simulated hub composes answer', ({ modelOutput, messages }) => {
    const result = composeAnswer(modelOutput);
    expect(result).toEqual(messages);
    result?.forEach(message => expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES));
  });
  test.each(vectors.classifyHubReply)('classify $wire', ({ wire, result }) => expect(classifyHubReply(wire)).toEqual(result));
  test.each(vectors.assembleAnswer)('assemble $parts', ({ parts, result }) => {
    const typedParts = parts.map(([index, total, text]) => {
      if (typeof index !== 'number' || typeof total !== 'number' || typeof text !== 'string') throw new Error('Invalid answer vector');
      return { index, total, text };
    });
    expect(assembleAnswer(typedParts)).toEqual(result);
  });
  test.each(vectors.encodeLocationShare)('share $wire', ({ note, lat, lon, wire }) => expect(encodeLocationShare(note, lat, lon)).toBe(wire));
  test.each(vectors.decodeLocationShare)('read share $wire', ({ wire, result }) => expect(decodeLocationShare(wire)).toEqual(result));
  test('state and event vocabulary match the contract', () => {
    expect(ASK_STATES).toEqual(vectors.askStates);
    expect(ASK_EVENTS).toEqual(vectors.askEvents);
    expect(vectors.askTransitions).toHaveLength(48);
  });
  test.each(ASK_STATES.flatMap(state => ASK_EVENTS.map(event => ({ state, event }))))('$state + $event', ({ state, event }) => {
    const vector = vectors.askTransitions.find(row => row.from === state && row.event === event);
    expect(vector).toBeDefined();
    expect(ASK_TABLE[state][event]).toBe(vector?.to);
    expect(askReducer(state, event)).toBe(vector?.to);
  });
});

test('UTF-8 byte counts and prefixes preserve whole characters', () => {
  expect(utf8Bytes('Aé😀')).toBe(new TextEncoder().encode('Aé😀').length);
  expect(utf8Bytes('a\ud800b')).toBe(new TextEncoder().encode('a\ud800b').length);
  expect(prefixBytes(`${'x'.repeat(199)}😀`, 200)).toBe('x'.repeat(199));
  expect(prefixBytes(`${'x'.repeat(196)}😀`, 200)).toBe(`${'x'.repeat(196)}😀`);
});

test('simulated answers split long Unicode lines without splitting a character', () => {
  expect(composeAnswer('😀'.repeat(63))).toEqual([
    `(1/3) ${'😀'.repeat(62)}`,
    '(2/3) 😀',
    `(3/3) ${ANSWER_LABEL}`,
  ]);
});

test('trimming matches the reference for Unicode whitespace and byte-order marks', () => {
  expect(composeAnswer('\u0085\u001e')).toBeNull();
  expect(composeAnswer('\ufeff')).toEqual([`(1/2) \ufeff`, `(2/2) ${ANSWER_LABEL}`]);
  expect(classifyHubReply('(1/2) \ufeff')).toEqual({ kind: 'answer_part', index: 1, total: 2, text: '\ufeff' });
  expect(parseQuestion('\u0085')).toEqual({ kind: 'empty', body: '', loc: null });
  expect(decodeLoc('loc:\u008551.5,\u001e-0.1')).toEqual({ lat: 51.5, lon: -0.1 });
});

test('location encoding uses the reference rounding for ties and signed zero', () => {
  expect(encodeLoc(0.015625, -0)).toBe('loc: 0.01562,-0.00000');
  expect(encodeLoc(-0.015625, 0.046875)).toBe('loc: -0.01562,0.04688');
});

test('answer assembly follows the latest total and replaces duplicate indexes', () => {
  expect(assembleAnswer([
    { index: 1, total: 2, text: 'old' },
    { index: 1, total: 3, text: 'first' },
    { index: 1, total: 3, text: 'corrected' },
    { index: 3, total: 3, text: ANSWER_LABEL },
    { index: 2, total: 3, text: 'second' },
  ])).toBe('corrected\nsecond');
});

test('only the last non-empty line is a location; line endings are normalized', () => {
  expect(decodeLocationShare('loc: 51.50070,-0.12460\nSome text')).toBeNull();
  expect(decodeLocationShare('A note\r\nloc: 51.50070,-0.12460\r\n\r\n')).toEqual({ note: 'A note', lat: 51.5007, lon: -0.1246 });
});
