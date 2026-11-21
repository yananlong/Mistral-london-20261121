# Mesh Help app

- Use npm and Expo SDK 58. Read the matching Expo docs before changing native APIs.
- `design/components.html` and `design/PRINCIPLES.md` are the benchmark for look and behaviour. The app is one screen in `src/AppShell.tsx` (briefing, topics, thread, pinned dock, sheets), with no router and no tabs.
- `../protocol/README.md` and `../protocol/vectors.json` own the wire contract.
- Screens use the runtime services. Concrete transports stay behind `src/transport/factory.ts`.
- Keep the Ask transition table complete and typed. Keep timers and sends outside its pure reducer.
- Do not create or change `modules/`. The native module belongs to another worker.
- Keep Expo Go and web usable without the native module or MapLibre.
- Keep the **Demo** tag (simulated link) and the AI label on every answer visible. Never show connection status, peer counts, or the words online, connected, hub or mesh in the UI.
- Use the tokens in `src/theme/tokens.ts` (dark, from design/system.html) and the `Txt`/`Button`/`Status` kit in `src/components/ui.tsx`. Buttons are 48 points; small buttons are no less than 44. Colour means state (red danger, yellow waiting, green done), and is always paired with an icon and a word.
- Before completion, run `npx tsc --noEmit`, `npx jest --ci`, and `npx expo export --platform web` from this directory.
- Keep `node_modules/`, `dist/`, and map data out of git. Do not push.
