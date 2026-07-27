// Server configuration — registers rooms and HTTP routes. Shared by the live
// entry point (index.ts) and the test harness (boot()), so tests exercise the
// exact wiring that ships.

import config from '@colyseus/tools';
import { BlackjackRoom } from './rooms/BlackjackRoom.ts';

// Cross-origin note: the web client (Vercel) and this server (Render) are on
// different origins, so the SDK's matchmaking HTTP request is cross-origin.
// @colyseus/tools already ships CORS that reflects the request origin and
// supports credentials — the correct, valid behaviour — so no CORS code is
// needed here. The WebSocket upgrade itself isn't CORS-gated.

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define('blackjack', BlackjackRoom);
  },
  initializeExpress: (app) => {
    // Render pings this to know the service is awake (it sleeps on the free
    // tier after 15 min idle — a plain 200 is all the health check needs).
    app.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
      res.json({ ok: true });
    });
  },
});
