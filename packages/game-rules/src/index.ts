// Game registry. The room lifecycle asks this module for a game and gets back a
// uniform engine — it never imports a game folder directly (PRD §4).

import blackjack from './blackjack/engine.ts';
import blackjackLines from './blackjack/lines.ts';
import type { AnyGameEngine, DogLine } from './types.ts';

export * from './types.ts';
export { handValue } from './blackjack/engine.ts';
export { BLACKJACK_LINES, SHELL_LINES } from './blackjack/lines.ts';
export type { DogEvent } from './blackjack/lines.ts';

export interface CatalogEntry {
  id: string;
  name: string;
  /** Which build phase ships it; null for modules with no scheduled home yet. */
  phase: number | null;
  available: boolean;
  /** Typed to the shared interface, not to Blackjack — a catalog that only
   *  accepts Blackjack would have to change to admit Rummy, which is the
   *  coupling the registry exists to avoid (PRD §4). */
  engine: AnyGameEngine | null;
  lines: Record<string, DogLine> | null;
}

export const CATALOG: CatalogEntry[] = [
  { id: 'blackjack', name: 'Blackjack', phase: 1, available: true, engine: blackjack, lines: blackjackLines },
  // Phase 2. Surfaces in the UI as disabled until the engine lands.
  { id: 'rummy', name: 'Rummy', phase: 2, available: false, engine: null, lines: null },
  // Future modules — the folder shape already accepts them (PRD §4).
  { id: 'bluff', name: 'Bluff', phase: null, available: false, engine: null, lines: null },
  { id: 'poker', name: 'Poker', phase: null, available: false, engine: null, lines: null },
  { id: 'teen-patti', name: 'Teen Patti', phase: null, available: false, engine: null, lines: null },
];

export const getGame = (id: string): CatalogEntry | null => CATALOG.find((g) => g.id === id) ?? null;
export const playableGames = (): CatalogEntry[] => CATALOG.filter((g) => g.available);

export { blackjack };
