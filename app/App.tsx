import { useState } from 'react';
import { MeshApp } from './src/AppShell';
import { AppRuntime } from './src/store/Runtime';
import { createTransport } from './src/transport/factory';

export default function App() {
  const [runtime] = useState(() => new AppRuntime(createTransport()));
  return <MeshApp runtime={runtime} />;
}
