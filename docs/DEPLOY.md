# Deploying Amygdala

The game is in three pieces, each free to host:

| Piece | What it is | Where it goes | Cost |
|-------|------------|---------------|------|
| **Frontend** | the static CRT site (`index.html`, `app/`, `brand_assets/`) | **Vercel** | free |
| **Server** | the Colyseus room process (`apps/server`) | **Render** | free |
| **Accounts** (optional) | Postgres + auth | **Supabase** | free |

The frontend and server are already wired together — the only manual steps are
creating the hosting accounts (which I can't do for you) and pasting one URL
into one config file.

> **Why two hosts?** A Colyseus room is many WebSocket connections sharing one
> in-memory process. Vercel's serverless functions can't hold that, so the
> server needs a host that runs a real process. Render's free tier does, no card
> required. (It sleeps after 15 min idle and takes ~30–50s to wake — the game's
> boot screen covers that first connect.)

---

## 1. Deploy the server to Render

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. Go to **[dashboard.render.com](https://dashboard.render.com)** → **New** →
   **Blueprint**. No credit card required for the free plan.
3. Connect your GitHub and pick the **Amygdala** repo. Render reads
   [`render.yaml`](../render.yaml) and configures everything: build command,
   start command, Node version, and the `/health` check.
4. Click **Apply**. First build takes a few minutes.
5. When it's live, copy the service URL — it looks like
   `https://amygdala-server.onrender.com`.

Verify it's up: open `https://amygdala-server.onrender.com/health` — it should
return `{"ok":true}`.

## 2. Point the frontend at the server

Edit **[`app/config.js`](../app/config.js)** — change the first line to your
Render URL, with `wss://` (secure WebSocket, required from an `https://` page):

```js
window.AMYGDALA_SERVER = "wss://amygdala-server.onrender.com";
```

Commit and push. That's the whole wiring.

## 3. Deploy the frontend to Vercel

Already set up — the repo has [`vercel.json`](../vercel.json) and deploys the
static site as-is. If you haven't imported it yet:

1. **[vercel.com/new](https://vercel.com/new)** → import the **Amygdala** repo.
2. Framework preset: **Other** (it's a static site; `vercel.json` handles the
   rest). Click **Deploy**.

Every `git push` after that redeploys automatically. Your game is live at the
Vercel URL.

## 4. Play

Open the Vercel URL, enter a nickname, **Create Room**, and share the 9-character
code. Anyone who opens the same site and joins with that code lands at your
table. A lone visitor gets two CPU players so the table is never empty.

---

## Accounts (optional)

Guests play with no account — stats live in their browser for the session. To
add persistent accounts (chips-as-score, win/loss record, match history that
survives across devices):

1. Create a project at **[supabase.com](https://supabase.com)** (free, no card).
2. In the project: **SQL Editor** → paste
   [`docs/supabase-schema.sql`](supabase-schema.sql) → **Run**. This creates the
   `profiles` and `match_history` tables with row-level security (each player
   can only touch their own rows).
3. In **Project Settings → API**, copy the **Project URL** and the **anon public
   key** (both are safe in the browser — RLS is what protects the data).
4. Paste them into [`app/config.js`](../app/config.js):
   ```js
   window.AMYGDALA_SUPABASE = {
     url: "https://YOUR-PROJECT.supabase.co",
     anonKey: "YOUR-ANON-KEY",
   };
   ```
5. Enable email auth (and any OAuth providers you want) under
   **Authentication → Providers**.

> **Status:** the schema and config hook are ready; the account **screen** in
> the app currently runs guest-first (sign-up converts the session locally). The
> remaining wiring — calling `supabase.auth` on the account screen and writing
> resolved hands to `match_history` — is the one piece that needs your live
> project to build and test against, since it can't be exercised without real
> keys. Everything it hangs off (the account screen, the stats model, the config
> hook) is in place.

---

## Local development

No hosting needed to run it all locally:

```bash
npm install                                    # once, from the repo root
npm run start --workspace @amygdala/server      # terminal 1 — server on :2567
npm start                                       # terminal 2 — site on :3000
```

Open `http://localhost:3000`. With no `AMYGDALA_SERVER` set, the client
auto-connects to `ws://localhost:2567`, so local dev needs no config edit.

Run the test suites (40 tests: engine + server) with:

```bash
npm test
```
