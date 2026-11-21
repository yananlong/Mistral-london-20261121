# App candidate choices

- Navigation: three explicit tabs in AppShell, with the runtime above them.
  Considered Expo Router and React Navigation. Rejected both for three fixed
  screens with no URLs, nested stacks, or deep-link requirement. The task
  explicitly leaves navigation open, overriding the generated template advice.
- State: one external MeshStore, React context, and useSyncExternalStore.
  Considered zustand and a large context reducer. Avoided a new dependency;
  external subscriptions also let transport events and tests drive one store.
- Ask: a complete typed 6-by-8 Record and a pure state reducer.
  AskController owns attempts, timers, and sends above the tab screens.
  Rejected component-local timers because navigation would discard progress.
  Duplicate events do not restart timers or replace the first answer.
- Map: MapLibre React Native 11.5.1 with a local PMTiles vector source.
  Considered react-native-maps and a web map. Rejected online tile defaults
  and WebView complexity. Platform files keep MapLibre out of the web bundle;
  optional native capability detection keeps Expo Go on a coordinate list.
- Map style: local land, water, roads, and buildings, with coloured position
  and peer circles. No remote fonts, sprites, or style JSON. Pin names and
  coordinates stay available in the list. The tile archive stays out of git.
- Location: the simulated link starts with an explicitly labelled Westminster
  demo position. Real GPS is one tap away. A real mesh starts with device GPS.
  Rejected silently using demo coordinates on the real link.
- Tests: Jest Expo + Testing Library 14, real SimulatedTransport, fake timers.
  Read vectors from the repository rather than copying expected fixtures.
  Rejected snapshots and mocked transports for screen tests: they cannot
  demonstrate the ack/answer flow, retained hub id, or wire location suffix.
- Transport: factory alone imports the native adapter and simulator. Screens
  receive runtime services. Talk routes hub questions through Ask to preserve
  the contract's one-question-in-flight rule.
- Visuals: calm pine/navy on warm white; 52-point minimum button targets.
  System-scaled text, wrapping layouts, visible demo badge, large live status.
- Session storage: memory only. Durable messaging and identity verification
  are outside this task. The protocol's stale-answer limitation is retained.
