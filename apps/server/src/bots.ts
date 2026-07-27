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
