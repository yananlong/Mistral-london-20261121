import vectors from '../../protocol/vectors.json';
import { ASK_EVENTS, ASK_STATES, ASK_TABLE, askReducer } from '../src/ask/machine';
import { CONSTANTS, classifyHubReply, decodeLoc, decodeLocationShare, encodeLoc, encodeLocationShare, encodeQuestion, prefixUnits } from '../src/protocol';

describe('shared protocol vectors (read from the repository contract)', () => {
  test.each(Object.entries(vectors.constants))('constant %s', (name, expected) => {
    expect(CONSTANTS).toHaveProperty(name, expected);
  });
  test.each(vectors.locEncode)('encode $line', ({ lat, lon, line }) => expect(encodeLoc(lat, lon)).toBe(line));
  test.each(vectors.locDecode)('decode $line', ({ line, result }) => expect(decodeLoc(line)).toEqual(result));
  test.each(vectors.encodeQuestion)('question $text', ({ text, loc, wire }) => expect(encodeQuestion(text, loc)).toBe(wire));
  test.each(vectors.classifyHubReply)('classify $wire', ({ wire, result }) => expect(classifyHubReply(wire)).toEqual(result));
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

test('Unicode cap preserves the last whole character', () => {
  expect(prefixUnits(`${'x'.repeat(499)}😀`, 500)).toBe('x'.repeat(499));
  expect(prefixUnits(`${'x'.repeat(498)}😀`, 500)).toHaveLength(500);
});

test('only the last non-empty line is a location; line endings are normalized', () => {
  expect(decodeLocationShare('loc: 51.50070,-0.12460\nSome text')).toBeNull();
  expect(decodeLocationShare('A note\r\nloc: 51.50070,-0.12460\r\n\r\n')).toEqual({ note: 'A note', lat: 51.5007, lon: -0.1246 });
});
