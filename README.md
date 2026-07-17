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

## Deploy

Static — no build step, no runtime dependencies. `vercel.json` skips both the
install and build commands (the only dependency is Puppeteer, which is dev-only
and would otherwise drag Chromium into the build) and serves the repo root.

`.vercelignore` matters more than it looks: a static deploy serves *every* file
it ships, so dev tooling, the asset-generation scripts, the internal docs, and
the desktop font source are all held back from the live site.

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

**The page is the tube.** Every screen is a channel inside one phosphor surface,
not a page in a web app (PRD goal §2). Nothing frames the game but your own
screen: the CRT raster runs edge to edge over the status bar and HUD strip
alike, and only the viewport between them swaps.

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

**Two brand-asset bugs fixed.** `tokens.css` had both dark stops of the scanline
gradient at `3px`, giving the band zero height — scanlines never drew, which made
CRT Off and Full look nearly identical. It's now a `3px` gap + `1px` line, chunky
enough to read at full-bleed sizes. Separately, its `@import` of the pixel font
sat *after* an `@font-face` rule, so the browser silently discarded it and the
entire UI rendered in a fallback sans; `@import` must come first in a stylesheet.

**The dog is a sprite sheet, not a PNG.** `brand_assets/_slice_dog_v2.py` keys the
white background out of the reference sheet and slices it into one strip per
animation (`brand_assets/dog/`), masking each frame to its own component so
neighbouring sparkles don't bleed in. CSS `steps()` walks the strips; each dog
state maps to one. The element is `1em` square and `font-size` is the display
size, so one frame is always exactly `1em` and every dog size animates correctly
from one set of strips.

**Amoria ships as a `.woff2` only.** The licensed desktop `.otf` is gitignored on
purpose — serving the webfont is normal licensed use, republishing the
installable font is not. `brand_assets/fonts/Amoria.woff2` is committed, so
nothing here needs the `.otf` to run.

**Chromatic aberration is gated to Full.** `tokens.css` ships `.crt-aberration`
ungated; Settings advertises it as a Full-only effect, so `index.html` damps it
at Off/Subtle.

**Mobile gets a different dog.** A floating narrator has nowhere to stand beside a
fanned hand, so under 780px the dog becomes a narration strip below the viewport
— the dedicated small-screen pattern PRD §9 flags as an open risk.
