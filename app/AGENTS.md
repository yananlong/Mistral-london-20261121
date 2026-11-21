# Mesh Help app

- Use npm and Expo SDK 58. Read the matching Expo docs before changing native APIs.
- The task explicitly allows navigation choices. This candidate uses three tabs in `src/AppShell.tsx`, without a router.
- `../protocol/README.md` and `../protocol/vectors.json` own the wire contract.
- Screens use the runtime services. Concrete transports stay behind `src/transport/factory.ts`.
- Keep the Ask transition table complete and typed. Keep timers and sends outside its pure reducer.
- Do not create or change `modules/`. The native module belongs to another worker.
- Keep Expo Go and web usable without the native module or MapLibre.
- Keep the simulated link badge and the AI disclaimer visible.
- Use the tokens in `src/theme/tokens.ts` and minimum 48-point targets.
- Before completion, run `npx tsc --noEmit`, `npx jest --ci`, and `npx expo export --platform web` from this directory.
- Keep `node_modules/`, `dist/`, and map data out of git. Do not push.
