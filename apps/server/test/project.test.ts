// project() is the copy from authoritative engine state into the synced Schema.
// The one thing it must never do is leak: no deck, and no hole card before the
// dealer reveals. These tests inspect the Schema's serialized form — toJSON()
// is the shape that actually encodes to clients.

import test from 'node:test';
import assert from 'node:assert/strict';

import blackjack from '@amygdala/game-rules/blackjack';
import type { BlackjackState as EngineState, Card, Rank, SuitId } from '@amygdala/game-rules/types';

import { BlackjackState } from '../src/schema/BlackjackState.ts';
import { project } from '../src/schema/project.ts';

const GLYPH: Record<SuitId, string> = { S: '♠', H: '♡', D: '♢', C: '♣' };
const card = (rank: Rank, suit: SuitId = 'S'): Card => ({
  rank,
  suit,
  glyph: GLYPH[suit],
  fill: suit === 'S' || suit === 'C' ? 'solid' : 'outline',
});
const stack = (s: EngineState, order: Card[]): void => {
  s.deck = order.slice().reverse();
};
const meta = () => ({ isBot: false, connected: true });

function dealtHand(): { raw: EngineState; state: BlackjackState } {
  const raw = blackjack.createState([{ id: 'you', nickname: 'you' }], { startingChips: 1000 });
  stack(raw, [card('K', 'H'), card('9', 'D'), card('K', 'C'), card('7', 'S'), card('5', 'H')]);
  blackjack.apply(raw, 'you', 'bet', 100);
  blackjack.apply(raw, 'you', 'deal');
  const state = new BlackjackState();
  project(state, raw, meta, 0);
  return { raw, state };
}

test('project: the deck never appears in the synced state', () => {
  const { state } = dealtHand();
  const json = JSON.stringify(state.toJSON());
  assert.ok(!json.includes('"deck"'), 'deck present in synced payload');
  // The fixture stacks a 5-card shoe; 4 are dealt, so 1 remains. The point is
  // that the count is shared while the cards are not.
  assert.equal(state.deckCount, 1, 'count is fine to share, contents are not');
});

test('project: the hole card is face-down until reveal, its value absent', () => {
  // Stack a hand where the hole card is a rank that appears NOWHERE else on the
  // table (a 3), so "does this rank show up in the payload?" is an unconditional
  // test with no escape hatch. Player K,9; dealer 10(up), 3(hole).
  const raw = blackjack.createState([{ id: 'you', nickname: 'you' }], { startingChips: 1000 });
  stack(raw, [card('K', 'H'), card('9', 'D'), card('10', 'C'), card('3', 'S'), card('5', 'H')]);
  blackjack.apply(raw, 'you', 'bet', 100);
  blackjack.apply(raw, 'you', 'deal');
  const state = new BlackjackState();
  project(state, raw, meta, 0);

  assert.equal(state.dealer.revealed, false);
  assert.equal(state.dealer.cards.length, 2);

  const up = state.dealer.cards[0]!;
  const hole = state.dealer.cards[1]!;
  assert.equal(up.faceDown, false, 'the upcard must be visible');
  assert.equal(up.rank, '10', 'the upcard should serialize normally');

  assert.equal(hole.faceDown, true, 'the hole card must be face-down');
  assert.equal(hole.rank, '', 'hole card rank leaked');
  assert.equal(hole.suit, '', 'hole card suit leaked');

  // The real hole card is a 3 server-side. That rank must appear NOWHERE in the
  // serialized payload — no substring escape, since 3 is on no other card.
  assert.equal(raw.dealer.cards[1]!.rank, '3', 'fixture sanity: hole card is a 3');
  const json = JSON.stringify(state.toJSON());
  assert.ok(!json.includes('"3"'), 'the hidden hole card value appears in the payload');

  // Upcard total only — a full total would leak the hole card as surely as the card.
  assert.equal(state.dealer.total, 10);
});

test('project: revealing the dealer syncs the full hand and total', () => {
  const { raw, state } = dealtHand();
  blackjack.apply(raw, 'you', 'stand'); // resolves, dealer reveals + draws to 17+
  project(state, raw, meta, 0);

  assert.equal(state.dealer.revealed, true);
  for (const c of state.dealer.cards) {
    assert.equal(c.faceDown, false, 'a card stayed face-down after reveal');
    assert.ok(c.rank !== '', 'a revealed card has no rank');
  }
  assert.equal(state.dealer.total, blackjack.handValue(raw.dealer.cards).total);
});

test('project: player hand, totals, and bet cross over intact', () => {
  const { state } = dealtHand();
  const you = state.players.get('you')!;
  assert.equal(you.total, 19); // K + 9
  assert.equal(you.soft, false);
  assert.equal(you.bet, 100);
  assert.equal(you.chips, 900);
  assert.equal(you.status, 'playing');
  assert.equal(you.cards.length, 2);
});

test('project: in-place updates reuse card slots rather than piling up', () => {
  const { raw, state } = dealtHand();
  const before = state.players.get('you')!.cards.length;
  blackjack.apply(raw, 'you', 'hit'); // K,9,5 = 24 bust → one more card
  project(state, raw, meta, 0);
  const you = state.players.get('you')!;
  assert.equal(you.cards.length, before + 1, 'card count did not track the engine');
  // No stale/duplicated slots — every slot has a real rank.
  for (const c of you.cards) assert.ok(c.rank !== '', 'a player card slot went blank');
});

test('project: null engine result maps to empty string, not the literal null', () => {
  const { state } = dealtHand();
  // Mid-hand, before resolution: result must be '' (schema strings are not nullable).
  assert.equal(state.players.get('you')!.result, '');
  assert.equal(state.results.length, 0);
});

test('project: a seat that leaves is dropped from the synced map', () => {
  const raw = blackjack.createState(
    [{ id: 'a', nickname: 'a' }, { id: 'b', nickname: 'b' }],
    { startingChips: 1000 },
  );
  const state = new BlackjackState();
  project(state, raw, meta, 0);
  assert.equal(state.players.size, 2);

  // Simulate seat b leaving the engine table.
  raw.players = raw.players.filter((p) => p.id !== 'b');
  project(state, raw, meta, 0);
  assert.equal(state.players.size, 1);
  assert.ok(state.players.get('a'));
  assert.ok(!state.players.get('b'), 'a departed seat lingered in the synced state');
});

test('project: deadline is carried through for the client countdown', () => {
  const { raw, state } = dealtHand();
  project(state, raw, meta, 1_720_000_000_000);
  assert.equal(state.deadline, 1_720_000_000_000);
});
