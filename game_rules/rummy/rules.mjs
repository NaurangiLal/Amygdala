// Client-side Rummy helpers — meld shape checks only (PRD §5.4).
//
// WHY THIS EXISTS, AND WHY THE DUPLICATION IS SAFE:
// the browser can't run the TypeScript package, so these mirror
// packages/game-rules/src/rummy/engine.ts. They are used ONLY to light up
// buttons — "is this selection a valid meld yet?" — never to decide an
// outcome. The server re-validates every move and is the only authority, so
// if these ever drift the worst case is a button that looks wrong and a move
// the server refuses. Keep them in sync anyway; the rules are short.

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Ace is LOW: A-2-3 is a run, Q-K-A is not. */
const order = (rank) => RANKS.indexOf(rank);

export const cardKey = (card) => card.rank + card.suit;

export function cardValue(card) {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return Number(card.rank);
}

export const deadwood = (hand) => hand.reduce((sum, c) => sum + cardValue(c), 0);

/** 3-4 of a rank, no repeated suit. */
export function isValidSet(cards) {
  if (cards.length < 3 || cards.length > 4) return false;
  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) return false;
  return new Set(cards.map((c) => c.suit)).size === cards.length;
}

/** 3+ consecutive in one suit, order-insensitive. */
export function isValidRun(cards) {
  if (cards.length < 3) return false;
  const suit = cards[0].suit;
  if (!cards.every((c) => c.suit === suit)) return false;
  const idx = cards.map((c) => order(c.rank)).sort((a, b) => a - b);
  return idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
}

export function isValidMeld(cards) {
  if (isValidSet(cards)) return 'set';
  if (isValidRun(cards)) return 'run';
  return null;
}

/** Would this table meld still be valid with `card` added? */
export function canLayOff(meld, card) {
  if (!meld?.cards?.length) return false;
  if (meld.kind === 'set') {
    return (
      meld.cards.length < 4 &&
      card.rank === meld.cards[0].rank &&
      !meld.cards.some((c) => c.suit === card.suit)
    );
  }
  if (card.suit !== meld.cards[0].suit) return false;
  const idx = meld.cards.map((c) => order(c.rank)).sort((a, b) => a - b);
  const v = order(card.rank);
  return v === idx[0] - 1 || v === idx[idx.length - 1] + 1;
}

/** Sort a hand the way a player would hold it: by suit, then rank. */
export function sortHand(cards) {
  const suits = ['S', 'H', 'D', 'C'];
  return [...cards].sort(
    (a, b) => suits.indexOf(a.suit) - suits.indexOf(b.suit) || order(a.rank) - order(b.rank),
  );
}
