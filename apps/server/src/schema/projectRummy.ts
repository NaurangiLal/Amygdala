// Copy the authoritative rummy engine state into the synced Schema.
//
// Routed through engine.view() like Blackjack's project(), so redaction lives
// in exactly one place — and then narrowed FURTHER: view() gives one player's
// hand, but the broadcast schema takes no hands at all (they go out as
// per-client messages instead). This file copies public facts only, and the
// schema has no field a hand could even fit in.

import rummy from '@amygdala/game-rules/rummy';
import type { RummyState as EngineState } from '@amygdala/game-rules/types';
import type { SeatMeta } from './project.ts';
import { CardSchema, MeldSchema, ResultSchema, RummyPlayerSchema, RummyState } from './RummyState.ts';

function fillCard(target: CardSchema, card: { rank: string; suit: string; glyph: string; fill: string }): void {
  target.rank = card.rank;
  target.suit = card.suit;
  target.glyph = card.glyph;
  target.fill = card.fill;
  target.faceDown = false;
}

export function projectRummy(
  state: RummyState,
  rawState: EngineState,
  meta: (id: string) => SeatMeta,
  deadline: number,
): void {
  // '' as the viewer id: the resulting view carries no hand at all, so this
  // projection never even holds a private card.
  const view = rummy.view(rawState, '');

  state.phase = view.phase;
  state.turn = view.turn ?? '';
  state.turnPhase = view.turnPhase;
  state.deadline = deadline;
  state.stockCount = view.stockCount;
  state.discardCount = view.discard.length;

  const top = view.discard[view.discard.length - 1];
  state.hasDiscardTop = Boolean(top);
  if (top) fillCard(state.discardTop, top);

  state.settings.startingChips = view.settings.startingChips;
  state.settings.tableSpeed = view.settings.tableSpeed;

  // Melds — public, rebuilt in place by id.
  while (state.melds.length > view.melds.length) state.melds.pop();
  for (let i = 0; i < view.melds.length; i++) {
    let slot = state.melds[i];
    if (!slot) {
      slot = new MeldSchema();
      state.melds.push(slot);
    }
    const m = view.melds[i]!;
    slot.id = m.id;
    slot.ownerId = m.ownerId;
    slot.kind = m.kind;
    while (slot.cards.length > m.cards.length) slot.cards.pop();
    for (let j = 0; j < m.cards.length; j++) {
      let cs = slot.cards[j];
      if (!cs) {
        cs = new CardSchema();
        slot.cards.push(cs);
      }
      fillCard(cs, m.cards[j]!);
    }
  }

  // Players — counts and public results only. There is no hand field to fill.
  const seen = new Set<string>();
  for (const p of view.players) {
    seen.add(p.id);
    let sp = state.players.get(p.id);
    if (!sp) {
      sp = new RummyPlayerSchema();
      sp.id = p.id;
      state.players.set(p.id, sp);
    }
    const m = meta(p.id);
    sp.nickname = p.nickname;
    sp.isBot = m.isBot;
    sp.connected = m.connected;
    sp.chips = p.chips;
    sp.handCount = p.handCount;
    sp.result = p.result ?? '';
    // Deadwood is a secret while the hand is live — the engine only fills it
    // at resolution, and this just mirrors that.
    sp.deadwood = p.deadwood;
    sp.payout = p.payout;
  }
  for (const id of [...state.players.keys()]) {
    if (!seen.has(id)) state.players.delete(id);
  }

  // Results — small, rebuilt on resolution.
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
