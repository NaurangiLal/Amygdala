# Amygdala

A retro-terminal card club. Green phosphor on black, a pixel dog who narrates,
and Blackjack you can actually play.

This is the **Phase 1 frontend** ([PRD](PRD.md) §4): every screen from the
wireframe, built to full CRT fidelity, with a working Blackjack engine running
locally. There is **no server yet** — see [Scope](#scope) below.

## Run it

```bash
npm install
npm start           # http://localhost:3000
```

Screenshots (used to check the build against the wireframe):

```bash
node screenshot.mjs http://localhost:3000 label      # -> ./temporary screenshots/
node screenshot.mjs http://localhost:3000 x --nav=table --width=390
```

## Layout

```
index.html              the console shell + all ten screens, styles inline
app/
  app.mjs               router, boot, table loop, settings + account wiring
  dog.mjs               dog state machine (when it speaks, what state it wears)
  settings.mjs          settings + local-storage persistence
game_rules/             one folder per game — see game_rules/README.md
  index.mjs             registry; the core resolves games through this
  blackjack/
    engine.mjs          rules engine — deal, validate, score
    rules.md            rule reference text the dog teaches
    lines.mjs           dog voice lines, as data
brand_assets/           tokens.css is the source of truth for colour/type/effects
```

Three ideas hold it together:

**The console is the product.** Every screen is a channel inside one phosphor
tube, not a page in a web app (PRD goal §2). The bezel, status bar, and footplate
never change; only the viewport swaps.

**Games are plug-ins.** `app.mjs` never imports Blackjack directly — it asks
`game_rules/index.mjs` for a game and calls a fixed interface. Rummy (Phase 2)
means adding a folder and a registry line.

**Content is data.** Dog lines live in `lines.mjs`, rules in `rules.md`. Neither
is hardcoded in a component, so both stay editable and localizable (PRD §5.5).

## Scope

Built: all ten wireframe screens, a real Blackjack engine (hit/stand/double,
soft aces, dealer stands on 17, 3:2 blackjack, push, bust), turn timers with
auto-stand, the eight-state dog, CRT Off/Subtle/Full, reduce-motion,
reduce-flicker, dog mute/skip, volumes, guest→account conversion, and live
stats/history.

Not built: **the multiplayer server.** The other seats are simulated locally and
the engine runs in the browser. Every line that becomes a server round-trip is
marked `SERVER:` in `app.mjs` — those are the seams Colyseus (PRD §7) plugs into.

`engine.view(state, playerId)` is already the anti-cheat boundary (PRD §6): it
drops the deck and nulls the dealer's hole card. Today it's enforced by
convention; on a server it becomes the only thing allowed over the wire.

Also deferred: split (dimmed per PRD §5.3), sound (volume controls persist but
play nothing), real auth, and Rummy.

## Decisions worth knowing

**Two wireframe elements were read as annotation, not UI, and left out:** the
theme-token swatch row on the title screen, and the `states:` legend
(WIN/LOSS/PUSH/BUST/BLACKJACK) on the resolution screen. Both carry annotation
pins in the wireframe and document the design to a reviewer rather than serving a
player — a title screen doesn't ship its own palette, and a result screen shows
the one outcome that happened. Say the word and they go in.

**`tokens.css` is linked, not inlined**, against the usual single-file default —
it calls itself the source of truth and asks to be imported everywhere. Component
styles are still inline in `index.html`.

**One brand-asset bug fixed.** `tokens.css` had both dark stops of the scanline
gradient at `3px`, giving the band zero height — scanlines never drew, which made
CRT Off and Full look nearly identical. Now `2px` transparent + `1px` line.

**Chromatic aberration is gated to Full.** `tokens.css` ships `.crt-aberration`
ungated; Settings advertises it as a Full-only effect, so `index.html` damps it
at Off/Subtle.

**Mobile gets a different dog.** A floating narrator has nowhere to stand beside a
fanned hand, so under 780px the dog becomes a narration strip below the viewport
— the dedicated small-screen pattern PRD §9 flags as an open risk.
