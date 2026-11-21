import { SimulatedTransport } from '../src/transport/SimulatedTransport';
import { describeTransportContract } from './transportContract';

// Today the only Transport implementation is the simulated mesh. When the
// BitChat native module lands, add: describeTransportContract(() => new BitChatTransport());
describe('SimulatedTransport conforms to the Transport contract', () => {
  describeTransportContract(() => new SimulatedTransport());
});
