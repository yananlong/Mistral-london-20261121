import { NativeMesh } from '../src/transport/BitchatTransport';
import { createTransport } from '../src/transport/factory';

const fakeNative = {} as NativeMesh;

test('auto uses the native module when it is linked', () => {
  const selection = createTransport('auto', () => fakeNative);
  expect(selection.transport.kind).toBe('bitchat');
  expect(selection.simulation).toBeUndefined();
});

test('auto falls back to the simulated mesh when the module is missing', () => {
  const selection = createTransport('auto', () => null);
  expect(selection.transport.kind).toBe('simulated');
  expect(selection.simulation).toBeDefined();
});

test('simulated ignores a linked native module', () => {
  const loadNative = jest.fn(() => fakeNative);
  expect(createTransport('simulated', loadNative).transport.kind).toBe('simulated');
  expect(loadNative).not.toHaveBeenCalled();
});

test('native fails loudly when the module is missing', () => {
  expect(() => createTransport('native', () => null)).toThrow(/not linked/);
});
