# Product Requirements Document
## "Amygdala" — a retro-terminal online multiplayer card game

**Status:** Draft v1
**Date:** 2026-07-15
**Owner:** Shivansh

---

## 1. Summary

Amygdala is a browser-based, real-time multiplayer card game with a retro
green-phosphor CRT aesthetic. Players join rooms with a nickname (optionally
signing up to save progress), pick a card game, and play live against others. A
pixel-art dog rendered in phosphor green acts as the game's full narrator —
explaining rules, prompting turns, reacting to plays, and giving the product its
personality.

The build is **phased**: Phase 1 delivers Blackjack end-to-end with the complete
multiplayer, dog, and theming stack. Phase 2 adds Rummy on the proven
foundation.

---

## 2. Goals & non-goals

### Goals
- Deliver a polished, cohesive retro-CRT experience that feels like a single
  console, not a generic web app.
- Support real-time multiplayer with server-authoritative game logic (no
  client-side cheating on hidden cards).
- Make the pixel dog a structural part of the UX, not a one-off animation.
- Get players into a game in seconds (guest-first), while allowing optional
  accounts for persistence.
- Ship accessible: CRT effects and narration must be adjustable/skippable.

### Non-goals (for now)
- Real-money gambling. Chips are cosmetic/score only.
- Native mobile apps. The web app is responsive; no App Store build.
- Voice/video chat. Text/emote reactions only, if any.
- A large game catalog at launch. Two games, phased.

---

## 3. Target users & context

- Casual players who enjoy card games and retro aesthetics.
- Friends who want a quick game together via a shared room code.
- Sessions are short (a few hands) and social. Mobile and desktop both matter;
  fanned card hands must remain usable on small screens.

---

## 4. Scope by phase

### Phase 1 — Blackjack (the foundation)
- Full multiplayer architecture: rooms, real-time sync, authoritative dealer.
- Blackjack rules engine (player vs. dealer, multiple players per table).
- Complete CRT theme + settings, pixel dog full-narrator system.
- Guest join; optional account sign-up with basic persistence (chips, stats).

### Phase 2 — Rummy (expansion)
- Rummy rules engine (draw/discard, melds, sets/runs, scoring).
- Game selection screen surfaces both games.
- Reuse of the multiplayer, dog, theme, and account systems from Phase 1.

> Rationale: Blackjack's dealer logic is simple and proves the entire
> real-time pipeline. Rummy's melding logic is the hard part and is safest to
> build once the plumbing is trusted.

### Game catalog & the `game_rules/` folder
The architecture treats every game as a pluggable module so the catalog can grow
without touching the multiplayer core. A dedicated **`game_rules/` folder** holds
one entry per game, and each entry has two parts:
- **Rules engine module** — server-side code that deals, validates moves, and
  scores, all behind a shared interface so any game plugs into the same room
  lifecycle.
- **Rule reference text** — the human-readable rules the dog teaches and that a
  players' reference can display.

Planned catalog (build order stays phased — only Blackjack then Rummy are built
in Phases 1–2; the rest are future modules the folder is structured to accept):
Blackjack, Rummy, Bluff, Poker, Teen Patti, and further variations over time.

---

## 5. Functional requirements

### 5.1 Onboarding & identity
- Player lands on a title screen (CRT boot animation optional/skippable).
- **Guest path:** enter a nickname → join or create a room. No account required.
- **Optional account:** sign up (email or OAuth) to persist chips, stats, and
  match history. A guest can convert to an account without losing their session.
- Nicknames are unique within a room; profanity filter on display names.

### 5.2 Lobby & rooms
- Create a room → receive a shareable room code.
- Join a room via code.
- Room settings: game type, max players, starting chips, table speed.
- Host controls: start game, kick player, adjust settings pre-game.
- Spectator mode is a possible later addition (not required for Phase 1).

### 5.3 Gameplay (Blackjack, Phase 1)
- Standard Blackjack: hit, stand, double down, split (split optional for v1).
- Dealer logic runs server-side and is authoritative.
- Betting round with chips; payouts on hand resolution.
- Turn timer with a default timeout action (auto-stand) to prevent stalls.
- Clear surfacing of hand values, bust, blackjack, push, and win/loss.

### 5.4 Gameplay (Rummy, Phase 2)
- Draw from stock or discard; meld sets and runs; discard to end turn.
- Server validates melds and scoring.
- Round/game end conditions and scoring surfaced clearly.

### 5.5 The pixel dog (full narrator)
The dog is the product's voice across the whole UI. It needs a defined **state
machine** and a **line library** so its behavior is consistent and content is
maintainable.

Dog states (minimum set):
- `idle` — ambient loop while waiting.
- `explaining` — teaching rules; may be multi-step, always skippable.
- `prompting` — cueing the active player ("your move").
- `thinking` — during dealer/opponent turns.
- `reacting_win` — celebration (tail wag, jump).
- `reacting_loss` — sympathy (ears down).
- `reacting_neutral` — push/tie, minor events.
- `celebrating` — round/game victory.

Requirements:
- Each game event and screen maps to a dog state + one or more lines.
- Lines are stored as data (not hardcoded in components) so they're easy to edit
  and localize later.
- A consistent voice/tone guide governs the writing (friendly, playful, brief).
- Narration never blocks play; a "skip"/"mute dog" control is always available.
- Sprites delivered as sprite sheets; animations are frame-based, green palette.

**Content sourcing.** Content splits into two kinds, and the volume is smaller
than it first appears:
- *Rules reference* (how each game actually works) — sourced from online
  references for factual accuracy, then rewritten in our own words. This is the
  bulk of the factual text and does not need to be authored from imagination.
- *Dog voice lines* (reactions, prompts, "your move," celebration quips) — a
  small bespoke set (roughly a few dozen short lines per game) authored to match
  the tone guide. These can't be downloaded; they are what gives the dog its
  personality, but they are low-volume by nature.

### 5.6 Theme & CRT effects
- Palette: phosphor green on black. Define a small token set (base green, bright
  green highlight, dim green, black, one warning/amber accent for alerts).
- Card design follows the same theme and fonts. The suit-color problem in a
  monochrome palette is solved by a **filled-vs-outlined rule**: spades and clubs
  render as solid glyphs, hearts and diamonds as outlined glyphs, always paired
  with the rank letter so a suit is never ambiguous without red/black.
- Fonts: **Amoria** for display/headings/logo. Licensing is a non-blocker (this
  is a personal, non-commercial project); the only requirement is a usable web
  font file (.woff2/.ttf) that loads via `@font-face`. A legible sans-serif for
  body; consider a pixel font for card rank/suit at small sizes.
- CRT effects available: scanlines, phosphor glow/bloom, flicker, subtle screen
  curvature, optional chromatic aberration.

### 5.7 Settings & accessibility (first-class)
- CRT intensity: **Off / Subtle / Full**.
- Reduce motion toggle (respects `prefers-reduced-motion`).
- Reduce flicker toggle (independent of motion).
- Dog: mute / skip narration.
- Sound: master + SFX volume.
- All toggles persist for accounts; stored locally for guests.

### 5.8 Persistence (optional accounts)
- Guests: nothing persists server-side; settings kept in local storage.
- Accounts: chips balance, win/loss stats, match history, saved settings.

---

## 6. Non-functional requirements

- **Latency:** actions feel immediate; target < 150 ms perceived for local UI,
  server round-trips optimistic where safe.
- **Reliability:** graceful disconnect/reconnect — a dropped player can rejoin
  their seat within a grace window; game state is preserved server-side.
- **Fairness/anti-cheat:** hidden cards never sent to clients that shouldn't see
  them; deck and shuffling live only on the server.
- **Responsive:** works on mobile and desktop; card hands remain usable on
  narrow screens.
- **Accessibility:** WCAG-minded contrast within the green palette; motion and
  flicker controls; keyboard navigability for core actions.

---

## 7. Proposed technical architecture

> Directional, not binding — final stack to be confirmed by engineering.

- **Front end:** React + Tailwind CSS. Sprite-sheet animation for the dog and
  card effects. CRT effects via CSS/SVG filters and shader-lite techniques.
- **Real-time server:** an authoritative multiplayer framework —
  **Colyseus** (purpose-built for room-based authoritative state) is
  recommended; Socket.IO is the lower-level alternative.
- **Game logic:** a per-game rules engine on the server (Blackjack first, Rummy
  second) with a shared interface so games plug into the same room lifecycle.
- **Identity/persistence:** guest sessions in-memory; optional accounts backed by
  a database (chips, stats, history). Auth via email or OAuth.
- **Assets:** Amoria web font (license permitting), pixel body/card font, dog
  sprite sheets, SFX.

---

## 8. Data model (high level)

- **Player:** id, nickname, isGuest, (accountId), chips, stats.
- **Room:** code, hostId, gameType, settings, playerIds, state.
- **GameState (per game):** deck (server-only), hands, turn, phase, pot/bets,
  results.
- **DogEvent → DogState/Lines:** mapping table driving narration.
- **Account:** id, auth, chips, stats, matchHistory, savedSettings.

---

## 9. Key risks & open questions

- **Amoria** — licensing is not a concern (personal, non-commercial). Only open
  item is confirming a usable web font file (.woff2/.ttf) that loads via
  `@font-face`.
- **Suit legibility** — resolved by the filled-vs-outlined glyph rule (§5.6);
  still worth a quick usability check at small sizes.
- **Real-time complexity** — reconnection, timeouts, and authoritative state are
  the hardest part; Phase 1 must prove this before Rummy.
- **Dog content** — reframed: factual rules text is sourced/verified online and
  rewritten; only the small bespoke set of voice lines is authored. Low volume,
  low risk.
- **Mobile card layouts** — fanned hands need a dedicated small-screen pattern.
- **CRT effects vs. performance/readability** — heavy effects can hurt both;
  the toggle system mitigates but defaults matter.

---

## 10. Success metrics (initial)

- Time-to-first-game (join → dealt in) under ~30 seconds for a guest.
- Completed-game rate (rooms that finish a hand vs. abandon).
- Return play (accounts created, repeat sessions).
- Accessibility adoption (share of players adjusting CRT/motion — signals the
  toggles matter).

---

## 11. Phased milestones

**Phase 1 — Blackjack**
1. Theme system + settings + CRT toggles.
2. Dog state machine + line library + Blackjack narration.
3. Rooms, real-time sync, authoritative Blackjack engine.
4. Guest flow + optional accounts + basic persistence.
5. Responsive/mobile pass + accessibility pass.

**Phase 2 — Rummy**
1. Rummy rules engine + server validation.
2. Game selection UI surfaces both games.
3. Rummy dog narration content.
4. Reuse accounts/theme/multiplayer; polish.

---

*End of PRD v1. This is a living document — sections 5, 7, and 8 will be
refined as design and engineering decisions firm up.*
