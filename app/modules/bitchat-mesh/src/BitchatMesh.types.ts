export type NativePeer = {
  id: string;
  nickname: string;
  reachable: boolean;
};

export type NativeMessage = {
  id: string;
  from: string;
  fromNickname: string;
  text: string;
  channel: 'public' | 'private';
  receivedAt: number;
};

export type NativeLinkState =
  | 'starting'
  | 'running'
  | 'bluetooth_off'
  | 'unauthorized'
  | 'unsupported'
  | 'stopped';

export type PeersEvent = { peers: NativePeer[] };
export type StateEvent = { state: NativeLinkState; detail?: string };

export type BitchatMeshEvents = {
  onPeers: (event: PeersEvent) => void;
  onMessage: (event: NativeMessage) => void;
  onState: (event: StateEvent) => void;
};
