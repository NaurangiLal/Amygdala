# Amygdala — Multiplayer Server Planning Notes
(Discussion summary, pre-implementation — nothing below is built yet)

## Where we are
Phase 1 (static frontend) is done and deployed: https://amygdala-gules.vercel.app/
- No server. Blackjack runs locally in the browser; other seats are simulated bots.
- Every point in `app/app.mjs` that will become a real network call is already
  marked `SERVER:` — those comments are the seams this work plugs into.

PRD §7 has the stack **locked in** (not up for debate):
- Frontend: Next.js (React) + Tailwind, TypeScript
- Real-time server: Colyseus, TypeScript, its own Node process
- Auth/DB: Supabase (Postgres + built-in auth)
- The existing engine (`game_rules/blackjack/engine.mjs`) ports to TS largely
  as-is — new home, not a rewrite.

## Key finding: Vercel cannot host the Colyseus server
Vercel added native WebSockets in mid-2026, but connections pin to a single
function instance with **no cross-instance broadcast** and a 5-minute default
duration cap. A Colyseus room is fundamentally "many sockets sharing one
in-memory process, broadcasting to each other" — the one shape that model
can't do. This doesn't contradict the PRD (§7 already says "standalone Node
process separate from Next.js") — it just means **two deploy targets**:
Next.js stays on Vercel; Colyseus needs a place that runs a persistent process.

## Server hosting — where we landed
Started recommending Railway/Fly.io, but the real constraint is **zero
budget, no card on hand, small-scale personal project** (a handful of
friends playing together counts as success — not launching to a global
audience). That changes the answer:

- **Render.com free Web Service tier** — no credit card required, runs a
  plain Node process including WebSockets, genuinely $0. Tradeoff: it sleeps
  after ~15 min with nobody connected, and the first connection after that
  waits ~30-50s while it wakes up. For "open the link, everyone waits once,
  then play" this is a non-issue.
- Railway and Fly.io both now expect a card on file (even at $0 charged),
  which doesn't fit the stated constraint.
- Colyseus Cloud and a plain VPS were also discussed and ruled out — Cloud
  costs money, a VPS means you personally maintain nginx/SSL/patching forever.
**Verified 2026-07-18** against Render's own docs (not blog summaries):
- No credit card required. ✓
- WebSockets supported, and **no fixed connection timeout** — Render's
  WebSocket doc states it "doesn't impose a fixed timeout," with no
  free-vs-paid distinction. (A third-party post claiming sockets drop at
  5 minutes regardless of activity is **wrong** — that figure is Vercel's
  function cap, not Render's.)
- Spin-down counts "WebSocket messages from existing connections" as inbound
  traffic, so **an in-progress game keeps the service awake**. The 15-min
  timer only runs when nobody is playing.
- 750 free instance hours per *workspace* per month. One sleeping service
  fits comfortably; a second always-on free service would not.
- Render's docs say plainly: "Do not use them for production applications."
  Fine at this scale — worth knowing it's their stated position.

So the target stack is: **Vercel (code) + Render (Colyseus server) +
Supabase (database/auth)** — all three free, no card needed anywhere.

### What the free tier changes about the build
Not blockers, but they stop being optional once we're on free infrastructure:

1. **Cold start ≈ 30–60s** on the first connection after a lull. This is a
   gift, not a tax: the CRT boot sequence already exists, so the wait becomes
   `CONNECTING TO DEALER…` over the scanline boot log. A 1980s terminal that
   takes a moment to warm up is *more* period-accurate, not less. The one
   rule is that it must be honest — a boot log that's secretly a spinner is
   fine; one that implies progress it can't measure isn't.
2. **Spin-down destroys in-memory rooms.** Room codes do not survive a 15-min
   empty lull — the process dies and Colyseus state goes with it. Acceptable
   for "friends show up and play," but it must be a *designed* behaviour: a
   stale code returns a clean "room expired, start a new one," never a crash
   or a hang.
3. **Deploys drop every live connection** (30s graceful window). So
   `allowReconnection()` plus a client reconnect path is load-bearing, not
   polish. PRD §6 already requires exactly this, so it's not new scope — the
   free tier just moves it from "should" to "must," in Stage B rather than
   later.
4. **Supabase free pauses after 7 days of no *database* activity** (~30s to
   wake; data is preserved, not deleted). Dashboard visits don't count, only
   queries. Relevant to Stage D: either accept the wake delay or add a weekly
   ping. Free tier also caps at 2 active projects.
5. **Cross-origin is real work.** Vercel-hosted page → Render-hosted `wss://`
   endpoint means CORS and WSS config, plus the Colyseus endpoint as an env
   var per environment. A Stage E task, not a footnote.

## Repo structure (proposed, not yet built)
npm workspaces (not Turborepo — three packages isn't a build graph worth
configuring):

`game-rules` is shared (not server-only) because the browser needs the
state *types* and pure helpers (`handValue`, `legalMoves`) too — that's the
whole reason TypeScript was picked in §7.

## The core architecture decision
Colyseus syncs a `Schema` object to every client. Our engine works on plain
JS objects. Two ways to bridge:

- (a) Rewrite the engine to operate on Schema instances directly — makes it
  untestable in isolation, contradicts "port as-is."
- **(b) Chosen: engine stays pure POJO in a private Room field. A small
  `project()` function copies only public fields into the Schema after each
  move.**

Why (b): anti-cheat becomes *structural*, not just disciplined — the deck
and dealer's hole card can't leak because they're never placed in the
synced object at all. This is exactly what `engine.view()` already does
today (drops the deck, nulls the hole card) — just promoted into the sync
layer instead of being a UI-side convention.

Bonus: Blackjack needs **no per-client filtering** — every player's cards
are public to everyone; only the dealer's hole card and the deck are secret
from *everyone*. So one shared Schema *is* the public view. Colyseus 0.16's
`StateView`/`@view()` (the per-player-secret tool, replacing the old
`@filter()`) is needed for Rummy later, not Blackjack now.

## Staged build order
| Stage | Job to be done | Proof it's done |
|---|---|---|
| A. Monorepo + engine → TS | One typed definition of Blackjack truth shared by client and server | `npm test` green, incl. regressions for bugs Red already caught (reshoe duplicates, sub-5-chip deadlock, 3:2 rounding, soft-17) |
| B. Colyseus authoritative room | 3 clients play a full hand; none can see the deck or hole card, even in devtools | `@colyseus/testing`: assert no deck client-side, hole card null until reveal, out-of-turn moves rejected |
| C. Next.js frontend | The existing CRT console, now driven by the server, visually identical to the live site | Screenshot diff vs. the live site at 1280px and 390px; full hand played against the real server |
| D. Supabase auth + persistence | Sign up mid-hand without losing your seat; stats survive a reload | Sign-up-mid-hand test; stats persist across reload |
| E. Deploy | Two people, two machines, one hand, one public URL | Exactly that |

Ordering notes:
- Server proven by **tests**, not a throwaway wiring of the current vanilla
  JS client — that wiring would be thrown away the moment React lands anyway.
- Server built and proven **before** the frontend port, so a misdealt hand
  during Stage C can only be a frontend bug, not an ambiguous one.
- Stage C keeps the 756 lines of CRT CSS (scanlines, curvature, halation,
  sprite `steps()` keyframes) as global styles, largely unchanged — Tailwind
  handles new layout only, not a re-litigation of the CRT look already
  earned. That leaves only ~340 lines of actual markup to port into React
  components.
- Agent Red reviews each stage on completion, same as Phase 1.

## Decisions — resolved 2026-07-18
1. **Solo visitor experience → port the bots server-side.** A lone visitor
   still gets a live table; real players take over seats as they arrive. CPU
   opponents also fit the "1980s terminal game" fiction naturally. (Rejected:
   you-vs-dealer only — valid Blackjack but reads as an empty room; and
   requiring 2+ humans — purest, but strands anyone who clicks the link
   alone, which is most people.)
   *Build note:* the bots move server-side into the room, and the client
   loses its local simulation entirely — so a bot is indistinguishable from
   a human over the wire, and no bot logic ships to the browser.
2. **Chips → room = play money, account = lifetime score.** Each room seeds
   stacks from its own `startingChips` setting and the broke-player top-up
   stays as-is. `Account.chips` becomes lifetime net winnings — a stat, not
   a wallet. Matches PRD §2 ("chips are cosmetic/score only"), keeps §5.2's
   per-room setting coherent, and needs no new code today. (Rejected: a
   carried bankroll — more compelling long-term, but it contradicts
   auto-refill, makes the per-room setting pointless, and edges toward the
   gambling mechanic §2 rules out. Layerable later if ever wanted.)

Both open decisions are now closed and the hosting terms are verified, so
this is an approved staged plan. Nothing is implemented yet — Stage A is
the next thing to build.