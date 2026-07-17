// Game registry. The room lifecycle asks this module for a game and gets back a
// uniform engine — it never imports a game folder directly (PRD §4).
import blackjack from './blackjack/engine.mjs';
import blackjackLines from './blackjack/lines.mjs';

export const CATALOG = [
  { id: 'blackjack', name: 'Blackjack', phase: 1, available: true, engine: blackjack, lines: blackjackLines },
  // Phase 2. Surfaces in the UI as disabled until the engine lands.
  { id: 'rummy', name: 'Rummy', phase: 2, available: false, engine: null, lines: null },
  // Future modules — the folder shape already accepts them (PRD §4).
  { id: 'bluff', name: 'Bluff', phase: null, available: false, engine: null, lines: null },
  { id: 'poker', name: 'Poker', phase: null, available: false, engine: null, lines: null },
  { id: 'teen-patti', name: 'Teen Patti', phase: null, available: false, engine: null, lines: null },
];

export const getGame = (id) => CATALOG.find((g) => g.id === id) ?? null;
export const playableGames = () => CATALOG.filter((g) => g.available);
