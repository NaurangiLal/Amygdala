# Amygdala — A Complete Project Explanation for a Novice

*A line-by-line-honest walkthrough of what this project is, what every part does, and the exact programming techniques it uses. Written to be readable if you have never seen this code before, but without dumbing down the vocabulary: every technical term is used and then explained.*

---

## 1. What Amygdala is, in one paragraph

Amygdala is a **browser-based card game**. You open a web page, type a nickname, "create a room," get a short share code, and play **Blackjack** against a dealer and a few other seats. The whole thing is styled to look like an **old green-on-black CRT terminal** (the kind of glowing phosphor monitor used in the 1980s), complete with scanlines, flicker, and screen curvature. A **pixel-art dog** sits in the corner and narrates everything — greeting you, prompting your turn, cheering a win, drooping its ears on a loss.

What actually exists today is **Phase 1: the front end only**. There is **no server yet**. The Blackjack logic runs entirely inside your browser, and the "other players" at the table are simulated by small pieces of code (called *bots*) rather than being real people over a network. The project's documents describe a later phase that adds a real multiplayer server, real accounts, and a database — but none of that is built. This distinction matters throughout, so the code is explicit about it.

---

## 2. The three big ideas the whole project is built around

The `README.md` states three organizing principles. Understanding these three makes every file predictable.

**Idea 1 — "The page is the tube."** In most web pages, content sits inside boxes with margins and a visible frame. Here, the *entire* browser window is treated as the surface of a CRT screen. The green glow, the scanlines, and the curved-edge vignette run edge to edge across everything — the top status bar, the middle play area, and the bottom control strip. When you move between screens (title → identity → lobby → room → betting → table → result), only the middle area swaps out; the "monitor" around it never changes. This is why there is a single `index.html` holding all ten screens rather than ten separate pages.

**Idea 2 — "Games are plug-ins."** The core application code (`app/app.mjs`) never directly mentions Blackjack's rules. Instead it asks a **registry** (`game_rules/index.mjs`) for "the game called `blackjack`" and then calls a **fixed set of functions** that every game is required to provide (deal cards, list legal moves, apply a move, score the hand, and so on). Because of this, adding a second game (Rummy is planned) means writing a new folder and adding one line to the registry — the core never changes. In software terms this is called **programming to an interface**: the caller depends on a *shape* (a set of function names and what they return), not on a specific implementation.

**Idea 3 — "Content is data."** The words the dog says live in a plain data file (`game_rules/blackjack/lines.mjs`), and the human-readable rules of Blackjack live in a Markdown text file (`rules.md`). Neither is hard-coded inside the visual components. This keeps the writing editable and, later, translatable into other languages, without touching program logic.

---

## 3. The file-and-folder map

```
index.html              The "console shell" + all ten screens. All component
                        styling (CSS) is written inline inside a <style> block.
app/
  app.mjs               The orchestrator: screen router, boot animation, the
                        betting/table/result game loop, timers, settings + account wiring.
  dog.mjs               The dog "state machine": decides WHEN the dog speaks and
                        WHICH mood (state) it wears. It never owns the words.
  settings.mjs          Reads/writes user preferences and saves them in the browser.
game_rules/             One folder per game (the plug-in system).
  index.mjs             The registry. The core resolves games only through this.
  blackjack/
    engine.mjs          The rules engine: deal, validate moves, score. Pure logic, no visuals.
    rules.md            The human-readable Blackjack rules the dog "teaches."
    lines.mjs           The dog's voice lines for Blackjack, stored as data.
brand_assets/
  tokens.css            The single source of truth for colour, type, spacing, CRT effects.
  fonts/Amoria.woff2    The display/logo font (web format).
  dog/                  The sliced sprite-sheet frames, one image strip per animation.
serve.mjs               A tiny local web server used during development.
screenshot.mjs          A script that takes screenshots of the running app (dev tool).
package.json            Project metadata + the one dev dependency (Puppeteer).
vercel.json             Deployment configuration for Vercel (the hosting service).
.vercelignore           A list of files NOT to publish to the live site.
PRD.md / README.md / docs/server-plan.md / CLAUDE.md   Project documentation.
```

---

## 4. Background you need first (skip if you know it)

**HTML** (HyperText Markup Language) describes the *structure* of a page — headings, buttons, text boxes. **CSS** (Cascading Style Sheets) describes the *appearance* — colours, sizes, animation. **JavaScript (JS)** is the *programming language* that runs inside the browser and makes the page interactive. The browser downloads all three and runs them.

This project uses modern JavaScript organized into **ES modules** (ECMAScript modules; "ECMAScript" is the official name of the JavaScript standard). A module is simply a `.js` (here, `.mjs`) file that can **`export`** values for other files to use and **`import`** values from other files. The `.mjs` file extension explicitly tells tools "this file is a module." Modules are loaded in the HTML with `<script type="module" src="app/app.mjs"></script>`. The `type="module"` attribute is what enables `import`/`export` and also makes the script run in **strict mode** (a stricter, safer set of language rules) and **deferred** (it runs after the HTML is parsed, so the elements it touches already exist).

A key point that makes this project unusual: it has **no build step**. Many modern web projects run a "bundler" (a tool that compiles and combines files) before the code can run. Here the browser runs the source files directly, exactly as written. That is deliberate for Phase 1.

---

## 5. `index.html` — the shell and the styling

### 5.1 The document head

```html
<!DOCTYPE html>
<html lang="en" class="crt--subtle">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="brand_assets/tokens.css">
<style> ... hundreds of lines of component CSS ... </style>
</head>
```

- `<!DOCTYPE html>` declares the document as modern HTML5.
- `class="crt--subtle"` on the root `<html>` element sets the **default CRT intensity** to "subtle." JavaScript later swaps this class to `crt--off` or `crt--full` when the user changes the setting. The CSS is written so that these three class names switch whole visual effect sets on and off.
- `<meta name="viewport" ...>` tells mobile browsers to use the device's real width and not artificially zoom out — this is what makes "responsive" (adapts to screen size) layout possible.
- `<link rel="stylesheet" href="brand_assets/tokens.css">` pulls in the shared design-token stylesheet (explained in §6). It is *linked* rather than pasted in, because the file calls itself the single source of truth and is meant to be imported everywhere.
- The `<style>` block holds all the *component* CSS (the styling for cards, chips, the dog, each screen). Every colour or size in it refers back to a token from `tokens.css` rather than inventing new values.

### 5.2 The ten screens

Inside `<body>` there is one `<main class="console">` holding a `<div class="tube">`, and inside the tube each screen is a `<section class="screen" data-screen="NAME">`. Examples: `data-screen="boot"`, `data-screen="identity"`, `data-screen="lobby"`, `data-screen="room"`, `data-screen="betting"`, `data-screen="table"`, `data-screen="result"`, `data-screen="settings"`, `data-screen="account"`.

Only one section is visible at a time. Visibility is controlled by a **custom data attribute** called `data-active`. `data-*` attributes are HTML's official way to attach arbitrary machine-readable values to an element; JavaScript can read and toggle them, and CSS can style based on them. The router in `app.mjs` adds `data-active` to exactly one section and the CSS reveals only that one.

At the very end of the body:

```html
<script type="module" src="app/app.mjs"></script>
```

This single line boots the whole application. `app.mjs` imports everything else it needs.

---

## 6. `brand_assets/tokens.css` — the design system

This file defines **design tokens**: named, reusable values for colour, font, spacing, and effects. Centralizing them means the entire look can change from one place.

### 6.1 Font loading, and a subtle rule about `@import`

```css
@import url("https://fonts.googleapis.com/css2?family=VT323&display=swap");

@font-face {
  font-family: "Amoria";
  src: url("fonts/Amoria.woff2") format("woff2");
  font-weight: 400 800;
  font-display: swap;
}
```

- `@import` pulls in another stylesheet — here the pixel terminal font **VT323** from Google Fonts. There is a strict CSS rule the comments call out: **`@import` must be the very first rule in a stylesheet**; a browser silently ignores an `@import` that appears after any other rule. An earlier version of the file had it *after* the `@font-face` rule, so the font silently failed to load and the whole UI fell back to a generic sans-serif. This is a real bug that was fixed, and it is a good example of "syntax order matters" in CSS.
- `@font-face` registers a custom font. `font-family: "Amoria"` names it; `src: url(...) format("woff2")` points to the actual font file. **WOFF2** (Web Open Font Format 2) is a compressed, web-optimized font format. `font-display: swap` tells the browser to show text immediately in a fallback font and swap in Amoria once it downloads, so text is never invisible while waiting.

### 6.2 CSS custom properties (variables)

```css
:root {
  --green-base:   #3DF07A;
  --green-bright: #C6FFDA;
  --green-dim:    #1A7A40;
  --crt-black:    #05090B;
  --amber-alert:  #FFC24D;
  /* ...spacing, type sizes, easing curves... */
}
```

`:root` is a selector that matches the top `<html>` element, so anything defined here is available to the entire document. Names beginning with `--` are **CSS custom properties** (commonly called CSS variables). They are consumed with the `var()` function, e.g. `color: var(--green-base);`. The hex codes like `#3DF07A` are colours in **hexadecimal RGB** (two hex digits each for red, green, blue). The palette is almost entirely shades of green plus one amber "alert" colour, matching the phosphor-monitor concept.

Other notable tokens:
- `--fs-display: clamp(2.75rem, 6vw, 5rem);` uses the CSS **`clamp()`** function, which picks a value that scales with the viewport (`6vw` = 6% of viewport width) but never goes below `2.75rem` or above `5rem`. `rem` means "relative to the root font size." This is **fluid typography** — text that grows with the screen but stays within safe limits.
- Spacing tokens (`--space-1: 4px;` … `--space-8: 64px;`) create a consistent spacing scale so gaps and padding are chosen from a fixed set, not random numbers.
- `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);` defines a reusable animation timing curve. `cubic-bezier(...)` describes acceleration; the value greater than 1 makes motion slightly overshoot and settle, giving a springy feel.

### 6.3 The CRT effect utilities

The file defines small, independent CSS classes for each visual effect so the settings panel can toggle them one by one:

- `.crt-scanlines::before` draws the horizontal raster lines using a `repeating-linear-gradient` (a background pattern that repeats a colour band). The `::before` is a **pseudo-element** — an extra element CSS invents and positions over the box without adding anything to the HTML. `mix-blend-mode: multiply` blends those dark lines into whatever is beneath so they darken rather than paint solid.
- `.crt-curve::after` adds an inset shadow and radial gradient to fake screen curvature and edge vignetting.
- `.crt-glow` / `.crt-glow-box` add `text-shadow` / `box-shadow` in green to simulate phosphor bloom (the glow around bright pixels).
- `.crt-flicker` runs a keyframe animation (`@keyframes crt-flicker`) that momentarily dips opacity, imitating an unstable CRT.

The **intensity presets** then switch these on and off by class:

```css
.crt--off .crt-scanlines::before,
.crt--off .crt-curve::after { display: none; }
.crt--off .crt-flicker { animation: none; }

.crt--subtle .crt-scanlines::before { opacity: 0.5; }
.crt--subtle .crt-flicker { animation: none; }
/* Full = defaults, all effects on */
```

Because the root `<html>` carries `crt--off`, `crt--subtle`, or `crt--full`, one class swap changes the whole screen's fidelity.

Finally, **accessibility** is handled directly in CSS:

```css
@media (prefers-reduced-motion: reduce) {
  .crt-flicker, .crt-breathe { animation: none !important; }
}
.reduce-flicker .crt-flicker { animation: none !important; }
```

`@media (prefers-reduced-motion: reduce)` is a **media query** that activates when the user's operating system is set to minimize animation. The app respects that system setting automatically, and also offers its own in-app toggles (`reduce-flicker`, `reduce-motion` classes).

---

## 7. `app/app.mjs` — the application orchestrator

This ~840-line module wires everything together. It is plain JavaScript with no framework. Below are its important parts and the techniques each one demonstrates.

### 7.1 Imports and DOM helper functions

```js
import { getGame } from '../game_rules/index.mjs';
import { Dog } from './dog.mjs';
import { Settings } from './settings.mjs';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
```

- The `import { name } from '...'` syntax pulls **named exports** out of other modules.
- `$` and `$$` are **arrow functions** (a compact function syntax: `(args) => returnValue`) that wrap the browser's built-in `document.querySelector` (find the first element matching a CSS selector) and `document.querySelectorAll` (find all matches). `root = document` is a **default parameter** — if you don't pass a root element, it searches the whole document. The `[...` spread in `$$` converts the `NodeList` returned by `querySelectorAll` into a real array so array methods like `.forEach` and `.map` work on it. These two helpers are used constantly instead of typing the long method names.

### 7.2 The `session` object — what a guest is

```js
const session = {
  nickname: 'guest',
  isGuest: true,
  chips: 1000,
  roomCode: null,
  maxPlayers: 4,
  startingChips: 1000,
  tableSpeed: 'normal',
  stats: { wins: 0, losses: 0, pushes: 0 },
  history: [],
};
```

This is a plain **JavaScript object** — a bag of named fields (called *properties*). It holds everything known about the current player before any real account exists. Notice `isGuest: true`: identity in Phase 1 is guest-first, and "signing up" merely flips this to `false`. `stats` is a nested object and `history` is an array (an ordered list). This object lives only in the browser's memory and disappears on refresh, which is exactly the intended guest behavior.

### 7.3 The screen router

The router is the function `go(screen)`. Simplified:

```js
function go(screen, { fromBack = false } = {}) {
  // ...manage an "overlay stack" so Settings/Account can be backed out of...
  current = screen;
  $$('.screen').forEach((el) => {
    el.toggleAttribute('data-active', el.dataset.screen === screen);
  });
  const [title, meta] = STATUS[screen] ?? ['AMYGDALA', ''];
  $('#statusTitle').textContent = title;
  // ...position the dog, move keyboard focus, narrate the screen...
}
```

Techniques on display:
- `{ fromBack = false } = {}` is **destructuring a parameter with a default**: the function accepts an options object, pulls `fromBack` out of it, defaults it to `false`, and if no object is passed at all uses an empty one.
- `toggleAttribute('data-active', condition)` adds the attribute when the condition is true and removes it when false — this is what actually shows/hides screens.
- `el.dataset.screen` is how JavaScript reads the `data-screen` HTML attribute (the `dataset` property exposes all `data-*` attributes).
- `STATUS[screen] ?? ['AMYGDALA', '']` uses the **nullish coalescing operator** `??`, which supplies a fallback only when the left side is `null` or `undefined`. `const [title, meta] = ...` is **array destructuring**, pulling the first two array items into two named variables.
- `.textContent = ...` sets the visible text of an element safely (it does not interpret HTML, so it cannot be tricked into injecting markup).

There is also an **overlay stack** (`overlayStack`, an array used with `.push()` and `.pop()`): Settings and Account are treated as detours layered on top of wherever you were, and "BACK"/Escape returns you there. This is a **Last-In-First-Out (LIFO) stack** — the last screen you layered on is the first one you return through.

Keyboard handling is wired with `document.addEventListener('keydown', ...)`: pressing **Escape** backs out of an overlay, and on the table screen the keys **H/S/D** trigger hit/stand/double. `addEventListener('event', handlerFunction)` is the standard way to run a function when something happens (a click, a keypress, typing in a field).

### 7.4 The boot animation

`runBoot()` prints a fake terminal boot log (`> booting phosphor display`, `> loading deck · 52 cards`, …) one line at a time using `setTimeout`. `setTimeout(fn, ms)` schedules a function to run once after a delay in milliseconds; chaining it produces the typed-out effect. Crucially, if the user's reduce-motion preference is on, the animation is skipped and only the final line is shown. There is also a **Skip** button. This "always skippable, respects reduce-motion" pattern recurs throughout.

### 7.5 Room codes and simulated table-mates

```js
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () =>
  Array.from({ length: 6 }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join('');
```

- `Array.from({ length: 6 }, generatorFn)` builds a 6-element array, calling the generator for each slot. Here each slot picks a random character.
- `Math.random()` returns a decimal from 0 up to (not including) 1; multiplying by the alphabet length and applying `Math.floor` (round down) yields a random valid index. `.join('')` concatenates the six characters into one string.
- The alphabet deliberately omits `0/O/1/I` because codes get read aloud and retyped, and those glyphs are easy to confuse.

The other seats are `BOTS` — hard-coded fake players. Comments throughout mark every place a real server would replace this: search the file for `SERVER:` and you find the exact "seams." For example, creating a room is currently `session.roomCode = makeCode();` with the comment `// SERVER: the room is created server-side and the code comes back with it.`

### 7.6 The game loop: betting → table → result

The play cycle is driven by three functions — `openBetting()`, `runTurn()`, and `showResult()` — plus a shared **turn timer**.

- **`openBetting()`** shows the betting screen, wires the chip buttons (`addBet`), schedules the bots to place their bets after short delays with `setTimeout`, and starts a countdown clock. If you never bet, the clock's timeout auto-places a small bet and deals you in so an idle player cannot stall the table.
- **`runTurn()`** is the heart of the loop. It looks at `state.turn` (whose turn it is). If it is your turn, it renders the table, asks the dog to prompt you, and starts the turn clock (which auto-stands you if it expires). If it is a bot's turn, it applies a simple strategy — `hit` while under 17, otherwise `stand` — paced with `setTimeout` so you can watch it. When there are no players left to act, it calls `showResult()`.
- **`showResult()`** reads the scored hand, shows a banner (WIN / BLACKJACK ×1.5 / PUSH / DEALER WINS / BUST), updates your `session.stats` and `session.history`, and asks the dog to react appropriately.

The timer helpers show a clean pattern:

```js
function startClock(el, seconds, onTimeout) {
  stopClock();
  let left = seconds;
  const paint = () => { el.textContent = `0:${String(Math.max(left, 0)).padStart(2, '0')}`; };
  paint();
  timer = setInterval(() => {
    left--;
    paint();
    if (left <= 0) { stopClock(); onTimeout(); }
  }, 1000);
}
```

- `setInterval(fn, 1000)` runs `fn` every 1000 ms (one second) until cancelled. `clearInterval` (inside `stopClock`) cancels it.
- `onTimeout` is a **callback** — a function passed in as an argument so the timer can "call back" into whatever the caller wants done when time runs out (auto-stand, auto-deal).
- The template string `` `0:${String(left).padStart(2, '0')}` `` uses **template literals** (backticks) with `${...}` interpolation to build text like `0:07`. `padStart(2, '0')` left-pads a number to two digits.

### 7.7 Rendering cards and the fanned hand

`cardEl(card)` returns an HTML string for one card. `fan(cards)` lays several cards in an arc by computing, for each card, a rotation angle and a vertical lift based on its position, then writing those numbers into **CSS custom properties** (`--fan`, `--lift`) on the element. The actual movement is done by CSS, not JavaScript — JS only supplies the numbers. This separation means the reduce-motion setting can disable the animation purely in CSS without JS involvement.

Importantly, `renderTable()` reads its data from `blackjack.engine.view(state, 'you')`, **not** from the raw `state`. That `view()` call is the anti-cheat boundary (explained fully in §8.5): it is the redacted version of the game a player is allowed to see, with the deck removed and the dealer's face-down card blanked out.

### 7.8 The account "sign up" (important honesty note)

```js
$('#signup').addEventListener('click', () => {
  const email = $('#email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { /* highlight the field, stop */ return; }
  session.isGuest = false;
  renderAccount();
  dog.say('account');
});
```

This is **not real authentication**. It checks the typed email against a **regular expression** (`/^\S+@\S+\.\S+$/`, explained in §11), and if the shape looks like an email it simply sets `session.isGuest = false`. No password, no server, no verification. It is a placeholder for the real Supabase-based sign-up planned for a later phase (§12). This is called out plainly because the request asked specifically about auth: in the built product, there is no auth yet — only a guest identity and a stub.

---

## 8. `game_rules/blackjack/engine.mjs` — the rules engine

This is the most important logic file and the one written most carefully. Its defining property: it is **pure**. Every function takes a state object and returns a new/updated state; it never touches the page (no DOM), never talks to a network, and has no visual concerns. The header comment says it is written so it can be **moved to the future server untouched**. Purity is what makes that possible and also what makes the logic testable in isolation.

### 8.1 Cards, ranks, suits

```js
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = [
  { id: 'S', glyph: '♠', fill: 'solid' },
  { id: 'H', glyph: '♡', fill: 'outline' },
  { id: 'D', glyph: '♢', fill: 'outline' },
  { id: 'C', glyph: '♣', fill: 'solid' },
];
```

Each suit records whether it renders as a **solid** or **outline** glyph. This solves a real design problem: on a monochrome green screen you cannot use red vs. black to tell suits apart, so spades/clubs are drawn filled and hearts/diamonds hollow, always beside the rank letter. `freshDeck()` builds all 52 cards by looping every suit against every rank.

### 8.2 Shuffling — the Fisher–Yates algorithm

```js
function shuffle(deck) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

This is the **Fisher–Yates shuffle**, the standard correct way to randomize an array so every ordering is equally likely. It walks from the last index down, and for each position swaps it with a randomly chosen earlier-or-equal position. `deck.slice()` first makes a copy so the original is not mutated. The line `[out[i], out[j]] = [out[j], out[i]]` is a **destructuring swap** — it exchanges two array elements in one statement without a temporary variable. On a real server, this comment notes, this is the *only* place card order is decided, and that order never leaves the server.

### 8.3 Hand value and "soft" hands

```js
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') { aces++; total += 11; }
    else if (['K','Q','J'].includes(card.rank)) total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
```

Blackjack's one tricky rule is the **Ace**, worth 11 or 1. The technique here: count every ace as 11 first, then, while the hand is over 21 and an ace is still counted high, subtract 10 (demoting that ace from 11 to 1). When it finishes, if any ace is still counted as 11 the hand is **soft** (it cannot bust on the next card), which the return value reports as `soft: true`. `export` in front of the function means other files may import it — the UI uses it to label hands.

### 8.4 The game-state schema

`createState(players, settings)` returns the full state object — the **schema** (the agreed shape of the data) for a Blackjack table:

```js
{
  game: 'blackjack',
  phase: 'betting',          // 'betting' -> 'playing' -> 'dealer' -> 'resolved'
  deck: shuffle(freshDeck()),// SERVER-ONLY: never sent to a client
  dealer: { cards: [], revealed: false },
  turn: null,                // id of the player whose turn it is, or null
  settings: { startingChips: 1000, tableSpeed: 'normal' },
  players: [ {
    id, nickname, isYou,
    chips, bet: 0, cards: [],
    status: 'betting',       // 'betting' -> 'playing' -> 'standing'/'bust'/'blackjack'
    result: null,            // 'win' | 'loss' | 'push' | 'bust' | 'blackjack'
    payout: 0,
  } ],
  results: null,
}
```

Two fields carry a **finite-state-machine** discipline. `phase` is the state of the whole table and only ever moves `betting → playing → dealer → resolved`. Each player's `status` similarly moves through a fixed set. Writing legal transitions as named string values (rather than scattered booleans) is what keeps the game logic unambiguous — at any moment there is exactly one phase and one status per player.

### 8.5 `apply()` — the single move dispatcher, and `legalMoves()`

Every action funnels through one function:

```js
function apply(state, playerId, move, arg) {
  switch (move) {
    case 'bet':      return placeBet(state, playerId, arg);
    case 'deal':     return deal(state);
    case 'hit':      return hit(state, playerId);
    case 'stand':    return stand(state, playerId);
    case 'double':   return double(state, playerId);
    case 'nextHand': return nextHand(state);
    default: throw new Error(`Unknown move: ${move}`);
  }
}
```

A `switch` statement branches on the `move` string and routes to the matching handler; an unrecognized move `throw`s an error (raises an exception that stops execution). Having a **single entry point** for all moves is exactly what a server needs: every player action arrives as `apply(state, who, what)`, gets validated, and updates the one authoritative state.

`legalMoves(state, playerId)` returns the list of moves currently allowed (e.g. `['hit','stand','double']`). The UI uses it to enable/disable buttons, and the move handlers use it to reject illegal actions. `double` is only offered on the first two cards and only if you can cover the extra bet; `split` is intentionally left out of version 1 but its place in the shape is reserved.

The handlers enforce the actual rules: `hit` draws a card and busts you if you exceed 21; `double` takes exactly one card, doubles the bet, and ends your turn; `playDealer` makes the dealer draw to 16 and **stand on all 17s including soft 17**; `resolve` compares every player's hand to the dealer and writes each `result` and `payout`, paying blackjack at **3:2** (`Math.round(bet * 1.5)`). One careful detail in `draw()`: if the deck empties mid-hand, it rebuilds a fresh shoe **minus the cards already on the table**, so a reshuffle can never duplicate a card that is currently in play.

### 8.6 `view()` — the anti-cheat boundary

```js
function view(state, playerId) {
  return {
    ...state,
    deck: undefined,                 // the deck is removed entirely
    deckCount: state.deck.length,    // only the count is shared
    dealer: {
      ...state.dealer,
      cards: state.dealer.revealed
        ? state.dealer.cards
        : state.dealer.cards.map((card, i) => (i === 0 ? card : null)), // hole card -> null
      /* ...total computed only from the visible card(s)... */
    },
    players: state.players.map((p) => ({ ...p, total: handValue(p.cards).total, soft: handValue(p.cards).soft })),
    you: playerId,
  };
}
```

This is the single most important security idea in the project. The raw `state` contains secrets a player must never see: the **entire remaining deck** (knowing it would let you predict every card) and the dealer's **hole card** (the face-down card). `view()` produces a **redacted copy**: the deck is set to `undefined` (only a count survives), and if the dealer has not revealed yet, the hole card is replaced with `null` — not merely hidden with CSS, but actually absent from the data. The `...state` and `...p` are the **spread operator**, which copies all properties of an object into a new object so the original is left untouched. In today's browser-only build this is enforced only by discipline (the code chooses to call `view()`); on the planned server it becomes the *only* thing allowed to cross the network, so cheating by inspecting network traffic or browser memory becomes structurally impossible.

### 8.7 The exported interface

At the bottom, the module exports a **default object** with a fixed set of members:

```js
export default {
  id: 'blackjack', name: 'Blackjack', minPlayers: 1, maxPlayers: 6,
  createState, legalMoves, apply, isHandOver, resolve, view, handValue,
};
```

This object *is* the plug-in contract from `game_rules/README.md`. Any future game (Rummy, Poker) must export an object of the same shape, and then the core can drive it identically. `{ createState, legalMoves, ... }` is **shorthand property syntax** — writing a variable name alone is equivalent to `createState: createState`.

---

## 9. `app/dog.mjs` — the narrator state machine

The dog is a small **finite-state machine** paired with the **observer pattern**. It decides *when* to speak and *which mood (state)* to wear, but it never contains the words — those are looked up from the line data.

```js
export class Dog {
  #lines;
  #settings;
  #listeners = new Set();
  #timer = null;
  #lastLine = new Map();

  state = 'idle';
  line = '';

  constructor(lines, settings) { this.#lines = lines; this.#settings = settings; }

  subscribe(fn) { this.#listeners.add(fn); fn(this); return () => this.#listeners.delete(fn); }
  #emit() { for (const fn of this.#listeners) fn(this); }

  say(event) { /* look up the event, set state + a line, notify listeners, auto-settle */ }
  settle() { /* return to idle, clear the line */ }
  skip() { this.settle(); }
}
```

Techniques and concepts:
- `class` defines a **class** — a template for objects that bundles data (fields) with behavior (methods). `new Dog(lines, settings)` creates an **instance**.
- The `#` prefix (`#lines`, `#emit`) marks **truly private** class members: they are invisible and inaccessible outside the class. This enforces that the outside world talks to the dog *only* through `say`, `settle`, `skip`, and `subscribe`.
- `#listeners = new Set()` holds callback functions. A **`Set`** is a collection with no duplicates. This is the **observer (publish/subscribe) pattern**: other code calls `dog.subscribe(fn)` to be notified whenever the dog changes; `#emit()` loops the set and calls each one. In `app.mjs`, the subscriber updates the DOM — it sets the dog element's `data-state` (which the CSS uses to pick the right sprite animation) and writes the speech-bubble text.
- `#lastLine = new Map()` remembers the last line index used per event so the dog does not repeat the same line twice in a row. A **`Map`** is a key→value store. `#pick()` chooses a random line but nudges off the last one.
- The eight dog states are `idle`, `explaining`, `prompting`, `thinking`, `reacting_win`, `reacting_loss`, `reacting_neutral`, `celebrating`. A `DWELL` table gives each reacting state a lifetime in milliseconds after which the dog auto-`settle()`s back to idle; states like `prompting` use `null`, meaning "hold until the next event."
- The settings integration is elegant: **muting** silences the *words* (`this.line = ''`) but keeps the *state*, because the pose still carries meaning (whose turn it is, what happened). **Skip narration** shortcuts long `explaining` lines to idle immediately. Narration therefore never blocks play.

---

## 10. `app/settings.mjs` — preferences and browser persistence

```js
const KEY = 'amygdala.settings.v1';
const DEFAULTS = { crt: 'subtle', reduceMotion: null, reduceFlicker: false,
                   muteDog: false, skipNarration: false, masterVolume: 0.6, sfxVolume: 0.4 };

export class Settings {
  #values;
  constructor() { this.#values = { ...DEFAULTS, ...this.#read() }; }

  #read()  { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } }
  #write() { try { localStorage.setItem(KEY, JSON.stringify(this.#values)); } catch {} }

  set(key, value) { this.#values[key] = value; this.#write(); this.apply(); /* notify */ }

  get motionReduced() { return this.#values.reduceMotion ?? systemPrefersReducedMotion(); }

  apply() {
    const root = document.documentElement;
    root.classList.remove('crt--off','crt--subtle','crt--full');
    root.classList.add(`crt--${this.#values.crt}`);
    root.classList.toggle('reduce-motion', this.motionReduced);
    root.classList.toggle('reduce-flicker', this.#values.reduceFlicker || this.motionReduced);
  }
}
```

- **`localStorage`** is a browser feature that stores small string values on the user's device that survive page reloads and browser restarts. Because it only stores strings, objects are converted with **`JSON.stringify`** (object → text) when writing and **`JSON.parse`** (text → object) when reading. **JSON** (JavaScript Object Notation) is the standard text format for structured data.
- The `try { ... } catch { ... }` blocks guard against two real failures: corrupted stored data, and browsers in private mode that forbid `localStorage`. Either way the code falls back to defaults rather than crashing.
- `{ ...DEFAULTS, ...this.#read() }` merges saved values on top of defaults, so any missing preference uses its default.
- `get motionReduced()` is a **getter** — a method that is read like a property (`settings.motionReduced`, no parentheses). It implements "follow the operating system's reduce-motion setting until the user explicitly overrides it": if the stored `reduceMotion` is `null`, it defers to `systemPrefersReducedMotion()`, which reads the OS setting via `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
- `apply()` is where preferences become visible: it writes CSS classes onto the root `<html>` element, and (as shown in §6) all the CRT CSS keys off those classes. This is the bridge between the JS settings and the CSS look.

For the PRD's plan, this file is significant: the comment notes that for real accounts, the same shape would sync to the server — you would swap the `#read`/`#write` pair for an API call and nothing else would change. Guests persist locally; accounts would persist server-side.

---

## 11. Regular expressions and other syntax used repeatedly

A few syntax elements appear across the code and are worth naming for a novice:

- **Regular expressions (regex)** — patterns for matching text, written between slashes. `/^\S+@\S+\.\S+$/` (email check) reads: `^` start, `\S+` one-or-more non-space characters, `@`, more non-space, `\.` a literal dot, more non-space, `$` end. `.test(str)` returns true/false. Another example, `/[^A-Z0-9]/g`, matches any character that is *not* an uppercase letter or digit (the `^` inside `[...]` means "not"), with the `g` flag meaning "all occurrences" — used to strip illegal characters from typed room codes.
- **Ternary operator** `condition ? a : b` — a compact if/else that produces a value.
- **`.map()` / `.filter()` / `.forEach()`** — array methods. `map` transforms every element into a new array (used to turn card objects into HTML strings); `filter` keeps only elements passing a test (used to select seated players); `forEach` runs a function per element for side effects (used to attach event listeners).
- **`escape()` helper** — a small function that replaces `<`, `>`, `&`, `"` with their HTML-safe equivalents before inserting a nickname into the page, preventing a player-supplied name from injecting markup. This is a basic **cross-site-scripting (XSS) mitigation**.

---

## 12. Authentication and identity — what exists, and what is planned

The request specifically asks how the auth works. The honest, precise answer has two halves.

### 12.1 What the built product actually does (Phase 1)

There is **no real authentication** in the current code. Identity is **guest-first**:

1. **Nickname as identity.** On the identity screen you type a nickname. `readNickname()` trims it, rejects empty names, and checks it against a tiny blocked-word list (`['admin','dealer','root','moderator']`). That is the entire "sign-in." The comment is explicit that a real profanity/uniqueness filter must run **server-side on join, where it cannot be bypassed by editing the client** — client-side checks are for convenience only, never security.
2. **The "sign up" stub.** On the account screen, entering a syntactically valid email flips `session.isGuest` from `true` to `false` and re-labels the status bar `MEMBER`. No password is collected, nothing is sent anywhere, and nothing is verified. It exists to prove the *user experience* of converting a guest into a member without losing the live session (your chips, seat, and stats survive the conversion).
3. **Guest persistence is local only.** Settings are saved to `localStorage` on the device; game stats and history live in the in-memory `session` object and vanish on refresh. Nothing about a guest is stored on any server, because there is no server.

So, precisely: the **authentication technique currently in use is "none — an unauthenticated guest identity,"** with a non-functional sign-up placeholder.

### 12.2 The planned authentication (from PRD.md §7–8 and docs/server-plan.md)

The documents lock in a real auth system for the next phase, using **Supabase**. Here is how each planned piece works:

- **Supabase Auth** is a hosted authentication service built on top of a PostgreSQL database. It provides two relevant sign-in methods:
  - **Email/password** — the user registers an email and password; Supabase stores a securely **hashed** (one-way-scrambled, non-reversible) version of the password, never the plaintext, and handles email verification.
  - **OAuth** (Open Authorization) — "sign in with Google/GitHub/etc." OAuth is a protocol where the user authenticates with a third-party provider they already trust, and that provider returns a token vouching for them, so your app never sees their password.
- **JWT sessions.** After a successful login, Supabase issues a **JWT** (JSON Web Token) — a compact, cryptographically **signed** string that encodes who the user is and when it expires. "Signed" means the server can verify the token was issued by it and has not been tampered with, without storing session state itself. The browser sends this token with each request to prove identity. Because it is signed, the client cannot forge or alter it.
- **Where each identity lives.** Per PRD §8, **guest** sessions stay **in-memory on the real-time server** (the Colyseus process, §13) and are never written to the database. Only real **accounts** are persisted to Supabase's PostgreSQL database: chips/score, win-loss stats, match history, and saved settings. In other words, authentication is what promotes a player from "temporary in-memory guest" to "row in a database with durable history."
- **Guest-to-account conversion.** The plan is that a guest can sign up mid-game and keep their seat and current-hand state — the same experience the Phase 1 stub is rehearsing, but backed by a real account.
- **Row-Level Security (RLS)** is the database technique Supabase encourages: rules attached to each database table that use the verified JWT identity to ensure a logged-in user can read and write only their own rows. This is what would stop one player from reading or editing another player's stats.

To summarize the auth story cleanly: **today = unauthenticated guests + a local-only preference store + a UI-only sign-up stub; planned = Supabase Auth (email/password and OAuth) issuing signed JWT sessions, with accounts persisted in PostgreSQL under row-level security, while guests remain server-memory-only.**

---

## 13. Build, run, and deploy

### 13.1 Running locally

`package.json` declares the project as an ES-module project (`"type": "module"`) with one script, `npm start`, which runs `node serve.mjs`. **Node.js** is a runtime that executes JavaScript outside the browser (on your computer or a server). `serve.mjs` is a ~45-line **static file server**: it uses Node's built-in `http` module to answer requests, reads the requested file from disk with `fs/promises`, sets the correct **MIME type** (the `Content-Type` header telling the browser what kind of file it is — e.g. `text/html`, `image/png`, `font/woff2`), and serves it. It also refuses any path that tries to escape the project folder (`if (!full.startsWith(ROOT)) 403 Forbidden`) — a **path-traversal** guard.

### 13.2 Screenshots for design review

The only installed dependency is **Puppeteer** (`devDependencies`), a library that drives a headless (invisible) Chrome browser from code. `screenshot.mjs` opens the running app in headless Chrome and saves a PNG into `temporary screenshots/`, used to compare the build against the original wireframe. It is a **dev dependency** — needed only during development, never shipped to users.

### 13.3 Deployment to Vercel

**Vercel** is a hosting platform. `vercel.json` configures it:

```json
{ "framework": null, "installCommand": "", "buildCommand": "", "outputDirectory": "." }
```

- `framework: null`, empty install and build commands: this tells Vercel there is **nothing to build** — just publish the files as-is. This is possible only because the project has no build step. (It also avoids dragging Puppeteer/Chromium into the deploy, since the install step is skipped.)
- `outputDirectory: "."` serves the repository root.
- The `headers` section sets caching (`Cache-Control: ... immutable` for brand assets so browsers cache them for a year) and a security header (`X-Content-Type-Options: nosniff`, which stops browsers from guessing file types).

`.vercelignore` is critical for a static deploy: because a static host serves **every file it ships**, anything not excluded would be publicly downloadable. So it holds back dev tooling (`serve.mjs`, `screenshot.mjs`, `node_modules`), the asset-generation Python scripts and their large source images, the internal docs (`PRD.md`, `CLAUDE.md`, the wireframe), and — importantly — the original desktop font `AMORIA-...otf`. Only the web `.woff2` version of the font ships, because serving a web font is normal licensed use while republishing the installable desktop font file is not permitted by font licenses.

### 13.4 The planned server topology (why hosting splits in two)

`docs/server-plan.md` records a key finding: Vercel **cannot** host the real-time game server. A Colyseus room is many WebSocket connections sharing one long-lived in-memory process that broadcasts to each other, and Vercel's serverless functions pin each connection to a separate short-lived instance with no cross-instance broadcast. The plan therefore uses **three services, all on free tiers**: **Vercel** for the Next.js web app, **Render.com** for the persistent Colyseus Node process (a plain always-on server that supports WebSockets), and **Supabase** for the database and auth. A **WebSocket** is a persistent two-way connection between browser and server (unlike ordinary web requests, which are one-shot), and it is what makes live multiplayer possible.

---

## 14. The planned technology stack (for context)

None of this is built yet, but it is "locked in" per the PRD and explains where the current code is heading:

- **Next.js** — a **React** framework. **React** is a JavaScript library for building user interfaces out of reusable **components** (self-contained pieces of UI). Next.js adds routing, server-side rendering, and API routes on top. Chosen because the project already deploys to Vercel (Next.js's maker), and because the current hand-written screen router and DOM manipulation would be replaced by React components.
- **TypeScript** — JavaScript plus **static types**. A "type" annotation declares the expected shape of a value (e.g. this variable is a number, this object has these fields), and a compiler checks them before the code runs, catching mismatches early. It is chosen specifically so the browser and server can **share one definition** of the room/game state; in a real-time game, a client and server that quietly disagree about the data shape is a classic bug source. The current pure-JavaScript engine would be "ported" to TypeScript largely unchanged.
- **Tailwind CSS** — a styling approach using many tiny single-purpose utility classes directly in markup. The plan keeps the hand-tuned CRT CSS as global styles and uses Tailwind only for new layout.
- **Colyseus** — a TypeScript framework purpose-built for authoritative, room-based multiplayer. "Authoritative" means the server is the single source of truth for game state, so clients cannot cheat. It synchronizes a special `Schema` object to every connected client. The plan keeps the pure-object engine in a private server field and copies only the *public* fields into the synced `Schema` after each move — which makes the `view()` redaction from §8.6 a structural guarantee rather than a convention.
- **Supabase** — hosted PostgreSQL + Auth (covered in §12).

---

## 15. Quick glossary

- **DOM (Document Object Model)** — the browser's live, in-memory representation of the page that JavaScript reads and changes.
- **ES module** — a `.js`/`.mjs` file using `import`/`export`.
- **Pure function** — a function whose output depends only on its inputs and which changes nothing outside itself; the engine is written this way.
- **State machine** — a system that is always in exactly one of a fixed set of named states, moving between them on defined events (the `phase`, player `status`, and the dog all use this).
- **Observer / pub-sub** — objects "subscribe" to be notified when another object changes (the dog and settings both `subscribe`).
- **Schema** — the agreed shape of a data object (the game state in §8.4; the account/room/player models in PRD §8).
- **Anti-cheat boundary / redaction** — removing secret data before it can reach a client (`view()`).
- **JWT** — a signed token proving who a logged-in user is, planned via Supabase.
- **WebSocket** — a persistent two-way browser↔server connection for live updates, planned via Colyseus.
- **Static deploy** — publishing plain files with no server-side build or runtime, as Phase 1 does on Vercel.

---

*Prepared from the actual source of the Amygdala repository (Phase 1 front-end build). Anything described as "planned" comes from `PRD.md` and `docs/server-plan.md` and is not yet implemented; everything else is present in the code today.*
