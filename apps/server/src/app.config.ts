// Server configuration — registers rooms and HTTP routes. Shared by the live
// entry point (index.ts) and the test harness (boot()), so tests exercise the
// exact wiring that ships.

import config from '@colyseus/tools';
import { BlackjackRoom } from './rooms/BlackjackRoom.ts';

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
