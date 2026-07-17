# `game_rules/`

One folder per game. The multiplayer core never imports a game directly — it
resolves games through [`index.mjs`](index.mjs), so adding a game means adding a
folder and one registry line, and touching nothing else (PRD §4).

## What a game folder contains

| File | Role |
| --- | --- |
| `engine.mjs` | Rules engine — deals, validates moves, scores. Implements the shared interface below. |
| `rules.md` | Rule reference text — the human-readable rules the dog teaches and the players' reference displays. |
| `lines.mjs` | Dog voice lines for this game, as data (PRD §5.5). |

## The shared engine interface

Every engine exports a default object with this shape. The room lifecycle calls
these and nothing else.

```js
{
  id: 'blackjack',
  name: 'Blackjack',
  minPlayers: 1,
  maxPlayers: 6,

  createState(players, settings) -> state   // fresh table
  legalMoves(state, playerId)     -> string[]
  apply(state, playerId, move)    -> state   // validate + advance; throws on illegal
  isHandOver(state)               -> boolean
  resolve(state)                  -> state   // payouts written into state.results
  view(state, playerId)           -> state   // strip anything this player must not see
}
```

## `view()` is the anti-cheat boundary

`state` holds the deck and the dealer's hole card. It must never reach a client.
`view(state, playerId)` returns the redacted copy that is safe to send — the deck
is dropped and face-down cards become `null` (PRD §6). In this frontend
prototype the engine runs in the browser, so `view()` is enforced by convention;
when the Colyseus server lands (PRD §7), `view()` is the only thing that may
cross the wire.

## Catalog

- **blackjack** — built (Phase 1).
- **rummy** — Phase 2.
- **bluff, poker, teen patti** — future modules. The folder shape accepts them
  as-is; no core changes required.
