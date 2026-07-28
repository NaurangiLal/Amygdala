// Server-side CPU seats.
//
// In Phase 1 the "other players" were faked in the browser. Authoritative play
// moves them here: a bot is just a seat the server drives, indistinguishable
// from a human over the wire (no bot logic ever reaches a client). They exist
// so a lone visitor still sits at a full, live table (the agreed solo-play
// behaviour) and so a room below its minimum still plays.
//
// The policy is deliberately plain — this is table dressing, not an opponent to
// beat. It mirrors the basic-strategy-ish choices the Phase 1 client made.

import blackjack from '@amygdala/game-rules/blackjack';
import type { BlackjackState, Move } from '@amygdala/game-rules/types';

export interface Bot {
  id: string;
  nickname: string;
}

const BOT_NAMES = ['player_two', 'player_three', 'dealer_bot', 'the_regular', 'night_owl'];

/** Stable bot identities for a room; ids are namespaced so they can never
 *  collide with a Colyseus sessionId. */
export function makeBots(count: number): Bot[] {
  const bots: Bot[] = [];
  for (let i = 0; i < count && i < BOT_NAMES.length; i++) {
    bots.push({ id: `bot:${i}`, nickname: BOT_NAMES[i]! });
  }
  return bots;
}

/** A bot's bet: a chip off a small ladder it can actually afford. Rebuy is the
 *  room's job, not the bot's — this only ever returns something legal. */
export function botBet(chips: number, rng: () => number): number {
  const ladder = [25, 50, 100];
  const pick = ladder[Math.floor(rng() * ladder.length)]!;
  return Math.min(pick, chips);
}

/**
 * The move a bot makes when it's on turn. Pure function of the public hand —
 * it never peeks at the deck or the hole card, same rule as a human.
 * Returns the chosen legal move, or null if it somehow has none.
 */
export function botMove(state: BlackjackState, botId: string): Move | null {
  const legal = blackjack.legalMoves(state, botId);
  if (legal.length === 0) return null;
  const seat = state.players.find((p) => p.id === botId);
  if (!seat) return null;

  const { total, soft } = blackjack.handValue(seat.cards);
  // Stand on a soft 18+ or hard 17+, otherwise draw. No doubling — a bot that
  // never doubles is duller and safer than one that mismanages its stack.
  if (soft ? total >= 18 : total >= 17) {
    return legal.includes('stand') ? 'stand' : legal[0]!;
  }
  return legal.includes('hit') ? 'hit' : legal[0]!;
}

// ---------------------------------------------------------------------------
// Rummy bot policy (Phase 2). Pure functions over the engine state — the bot
// reads its own hand server-side (the server owns all hands; nothing here
// touches the wire). Deliberately plain, same philosophy as the blackjack
// policy above: table dressing, not an opponent to fear.
// ---------------------------------------------------------------------------

import { canLayOff, cardKey, cardValue, isValidMeld } from '@amygdala/game-rules/rummy';
import type { Card, RummyArg, RummyMove, RummyState } from '@amygdala/game-rules/types';

/** Every 3-card combination of the hand that forms a valid meld. Hands cap at
 *  11 cards, so brute force over triples (≤165) is nothing. */
function findMeld(hand: Card[]): string[] | null {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        const triple = [hand[i]!, hand[j]!, hand[k]!];
        if (isValidMeld(triple)) return triple.map(cardKey);
      }
    }
  }
  return null;
}

/** Would taking the discard's top card let the bot meld immediately? */
function topCompletesMeld(hand: Card[], top: Card): boolean {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (isValidMeld([hand[i]!, hand[j]!, top])) return true;
    }
  }
  return false;
}

/**
 * The bot's next rummy move, one step at a time — the room applies it, syncs,
 * and asks again, so a watching player sees the bot think in beats rather than
 * teleport through its turn. Returns null only when it isn't the bot's turn.
 */
export function rummyBotMove(
  state: RummyState,
  botId: string,
): { move: RummyMove; arg: RummyArg } | null {
  if (state.phase !== 'playing' || state.turn !== botId) return null;
  const seat = state.players.find((p) => p.id === botId);
  if (!seat) return null;

  if (state.turnPhase === 'draw') {
    const top = state.discard[state.discard.length - 1];
    const useDiscard = top && topCompletesMeld(seat.hand, top);
    // A dead stock (nothing to recycle) refuses stock draws — fall back to the
    // pile so the bot always has a legal draw.
    const stockDead = state.stock.length === 0 && state.discard.length <= 1;
    return { move: 'draw', arg: { source: useDiscard || stockDead ? 'discard' : 'stock' } };
  }

  // Act phase: meld if possible, else lay off, else discard the priciest card.
  const meld = findMeld(seat.hand);
  if (meld) return { move: 'meld', arg: { cards: meld } };

  for (const card of seat.hand) {
    for (const m of state.melds) {
      // Don't lay off the taken card if it's our last — discarding it wins.
      if (canLayOff(m, card)) return { move: 'layoff', arg: { card: cardKey(card), meldId: m.id } };
    }
  }

  // Discard: highest deadwood first, never the taken card unless it's all we have.
  const candidates = seat.hand.filter(
    (c) => cardKey(c) !== state.tookFromDiscard || seat.hand.length === 1,
  );
  const pool = candidates.length > 0 ? candidates : seat.hand;
  const worst = pool.reduce((a, b) => (cardValue(b) > cardValue(a) ? b : a));
  return { move: 'discard', arg: { card: cardKey(worst) } };
}
