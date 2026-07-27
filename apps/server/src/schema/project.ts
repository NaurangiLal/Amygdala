// Copy the authoritative engine state into the synced Schema.
//
// The redaction — drop the deck, hide the hole card — already happened in
// engine.view() (Stage A, tested). project() takes that redacted view and does
// nothing but copy it into the Schema, so there is exactly one place that
// decides what a client may see, and this file cannot reintroduce a leak: the
// view has no deck, and the Schema has no field for one.
//
// Updates happen in place. Colyseus sends only what changed, so mutating the
// existing player entries (rather than rebuilding the map every tick) keeps
// each patch to the handful of fields that actually moved.

import blackjack from '@amygdala/game-rules/blackjack';
import type { BlackjackState as EngineState } from '@amygdala/game-rules/types';
import {
  BlackjackState,
  CardSchema,
  PlayerSchema,
  ResultSchema,
} from './BlackjackState.ts';

/** Room-level facts the pure engine doesn't track. */
export interface SeatMeta {
  isBot: boolean;
  connected: boolean;
}

function fillCard(target: CardSchema, card: { rank: string; suit: string; glyph: string; fill: string } | null): void {
  if (card === null) {
    // The dealer's hole card: present as a face-down back, its value absent.
    target.rank = '';
    target.suit = '';
    target.glyph = '';
    target.fill = '';
    target.faceDown = true;
    return;
  }
  target.rank = card.rank;
  target.suit = card.suit;
  target.glyph = card.glyph;
  target.fill = card.fill;
  target.faceDown = false;
}

/** Rewrite a card ArraySchema in place: reuse existing slots, add/trim to fit. */
function syncCards(
  arr: CardSchema[],
  cards: ({ rank: string; suit: string; glyph: string; fill: string } | null)[],
): void {
  while (arr.length > cards.length) arr.pop();
  for (let i = 0; i < cards.length; i++) {
    let slot = arr[i];
    if (!slot) {
      slot = new CardSchema();
      arr.push(slot);
    }
    fillCard(slot, cards[i]!);
  }
}

/**
 * Mutate `state` (the Schema) to match the engine's `rawState`.
 * `meta(id)` supplies room-level facts (bot? connected?) the engine doesn't own.
 * `deadline` is the epoch-ms expiry of the running timer, 0 if none.
 */
export function project(
  state: BlackjackState,
  rawState: EngineState,
  meta: (id: string) => SeatMeta,
  deadline: number,
): void {
  // The redacted client view — no deck, hole card nulled until reveal.
  const view = blackjack.view(rawState, '');

  state.phase = view.phase;
  state.turn = view.turn ?? '';
  state.deckCount = view.deckCount;
  state.deadline = deadline;

  state.settings.startingChips = view.settings.startingChips;
  state.settings.tableSpeed = view.settings.tableSpeed;

  state.dealer.revealed = view.dealer.revealed;
  state.dealer.total = view.dealer.total;
  syncCards(state.dealer.cards, view.dealer.cards);

  // Players — update in place, keyed by seat id (the Colyseus sessionId).
  const seen = new Set<string>();
  for (const p of view.players) {
    seen.add(p.id);
    let sp = state.players.get(p.id);
    if (!sp) {
      sp = new PlayerSchema();
      sp.id = p.id;
      state.players.set(p.id, sp);
    }
    const m = meta(p.id);
    sp.nickname = p.nickname;
    sp.isBot = m.isBot;
    sp.connected = m.connected;
    sp.chips = p.chips;
    sp.bet = p.bet;
    sp.status = p.status;
    sp.result = p.result ?? '';
    sp.payout = p.payout;
    sp.total = p.total;
    sp.soft = p.soft;
    syncCards(sp.cards, p.cards);
  }
  // Drop seats that left the table entirely.
  for (const id of [...state.players.keys()]) {
    if (!seen.has(id)) state.players.delete(id);
  }

  // Results — rebuilt each resolution; small and only changes at hand end.
  while (state.results.length > 0) state.results.pop();
  if (view.results) {
    for (const r of view.results) {
      const rs = new ResultSchema();
      rs.id = r.id;
      rs.result = r.result ?? '';
      rs.payout = r.payout;
      rs.chips = r.chips;
      state.results.push(rs);
    }
  }
}
