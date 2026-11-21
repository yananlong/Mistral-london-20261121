import { NativeModule, requireNativeModule } from 'expo-modules-core';
import type {
  BitchatMeshEvents,
  NativePeer,
} from './src/BitchatMesh.types';

export type * from './src/BitchatMesh.types';

class BitchatMeshNativeModule extends NativeModule<BitchatMeshEvents> {
  start!: (nickname: string) => Promise<void>;
  stop!: () => Promise<void>;
  getPeers!: () => Promise<NativePeer[]>;
  sendPublic!: (text: string) => Promise<void>;
  sendPrivate!: (peerId: string, text: string) => Promise<void>;
}

const BitchatMesh = requireNativeModule<BitchatMeshNativeModule>('BitchatMesh');

export const start = (nickname: string) => BitchatMesh.start(nickname);
export const stop = () => BitchatMesh.stop();
export const getPeers = () => BitchatMesh.getPeers();
export const sendPublic = (text: string) => BitchatMesh.sendPublic(text);
export const sendPrivate = (peerId: string, text: string) => BitchatMesh.sendPrivate(peerId, text);
export const onPeers = (listener: BitchatMeshEvents['onPeers']) => BitchatMesh.addListener('onPeers', listener);
export const onMessage = (listener: BitchatMeshEvents['onMessage']) => BitchatMesh.addListener('onMessage', listener);
export const onState = (listener: BitchatMeshEvents['onState']) => BitchatMesh.addListener('onState', listener);

export default BitchatMesh;
