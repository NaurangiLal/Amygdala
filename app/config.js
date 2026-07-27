// Runtime config — plain global, loaded before the app so no build step is
// needed. For production, set the Colyseus server's public address here (the
// Render URL from DEPLOY.md), e.g.:
//
//   window.AMYGDALA_SERVER = "wss://amygdala-server.onrender.com";
//
// Left null, the app falls back to ws://localhost:2567 on localhost, so local
// development needs no edit. Must be wss:// (not ws://) in production so a
// page served over https can connect.
window.AMYGDALA_SERVER = null;

// Optional accounts (PRD §5.8). Guest play needs none of this — the game is
// fully playable without it. To turn on persistent accounts, create a Supabase
// project, run docs/supabase-schema.sql in it, and paste its URL + anon key
// here (both are safe to expose in the browser; row-level security protects the
// data). See docs/DEPLOY.md § Accounts.
//
//   window.AMYGDALA_SUPABASE = {
//     url: "https://YOUR-PROJECT.supabase.co",
//     anonKey: "YOUR-ANON-KEY",
//   };
window.AMYGDALA_SUPABASE = null;
