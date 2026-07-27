// Runtime config — plain global, loaded before the app so no build step is
// needed. For production, set the Colyseus server's public address here (the
// Render URL from DEPLOY.md), e.g.:
//
//   window.AMYGDALA_SERVER = "wss://amygdala-server.onrender.com";
//
// Left null, the app falls back to ws://localhost:2567 on localhost, so local
// development needs no edit. Must be wss:// (not ws://) in production so a
// page served over https can connect.
window.AMYGDALA_SERVER = "wss://amygdala-server.onrender.com";

// Optional accounts (PRD §5.8). Guest play needs none of this — the game is
// fully playable without it. Both values below are the Supabase *anon* public
// key and project URL — safe to ship in browser code; row-level security
// (docs/supabase-schema.sql) is what actually protects the data, not secrecy
// of this key. Never put the service_role key here or anywhere client-side.
window.AMYGDALA_SUPABASE = {
  url: "https://scvwnlfkecigchbkmjbr.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjdndubGZrZWNpZ2NoYmttamJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjAyMTQsImV4cCI6MjEwMDczNjIxNH0.9EEBFs_LxRShNK7PigvC_QMJXkJDgIu4_7nQtgVuOFY",
};
