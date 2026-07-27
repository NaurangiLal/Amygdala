// Live entry point. Runs as a standalone Node process (PRD §7), separate from
// the Next.js app — Colyseus holds sockets in memory and cannot live on
// Vercel's serverless functions.

import { listen } from '@colyseus/tools';
import appConfig from './app.config.ts';

// Render supplies PORT; 2567 is Colyseus's default for local runs.
const port = Number(process.env.PORT) || 2567;
await listen(appConfig, port);
