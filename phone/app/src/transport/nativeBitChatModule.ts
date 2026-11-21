import { NativeModules } from 'react-native';
import type { BitChatNativeModule } from './NativeTransport';

/**
 * The only file that touches react-native's NativeModules. The native BitChat
 * module (wrapping the Swift mesh code from our BitChat fork, PLAN.md
 * section 4) registers itself under this name once the Xcode wiring lands.
 */
export const BITCHAT_NATIVE_MODULE_NAME = 'BitChatMesh';

/**
 * Returns the linked native BitChat module, or null while the app still runs
 * on the simulated mesh. `NativeModules` is a lazy proxy: an unregistered
 * name simply reads as undefined.
 */
export function getNativeBitChatModule(): BitChatNativeModule | null {
  const module = NativeModules[BITCHAT_NATIVE_MODULE_NAME] as BitChatNativeModule | undefined;
  if (!module || typeof module.send !== 'function' || typeof module.addListener !== 'function') {
    return null;
  }
  return module;
}
