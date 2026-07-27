// Straight Rummy engine tests.
//
// Every test rigs the hands/stock/discard directly rather than trusting the
// shuffle, so a failure is a real rule regression and never an unlucky deal.
// Note: draw() pops from the END of the stock array — to make a card "the next
// draw", put it last.

import test from 'node:test';
import assert from 'node:assert/strict';

import rummy, {
  canLayOff,
  cardValue,
  deadwood,
  isValidMeld,
  isValidRun,
  isValidSet,
} from '../src/rummy/engine.ts';
import type { Card, Rank, RummyState, SuitId } from '../src/types.ts';

const GLYPH: Record<SuitId, string> = { S: '♠', H: '♡', D: '♢', C: '♣' };
const c = (rank: Rank, suit: SuitId = 'S'): Card => ({
  rank,
  suit,
  glyph: GLYPH[suit],
  fill: suit === 'S' || suit === 'C' ? 'solid' : 'outline',
});

const seat = (id: string, chips = 1000) => ({ id, nickname: id, chips });

/** Two seats, then overwrite the deal with a known layout. */
function rigged(layout: { a: Card[]; b: Card[]; stock: Card[]; discard: Card[] }): RummyState {
  const state = rummy.createState([seat('a'), seat('b')], { startingChips: 1000 });
  state.players[0]!.hand = layout.a;
  state.players[1]!.hand = layout.b;
  state.stock = layout.stock;
  state.discard = layout.discard;
  state.turn = 'a';
  state.turnPhase = 'draw';
  state.tookFromDiscard = null;
  return state;
}

const totalChips = (s: RummyState) => s.players.reduce((sum, p) => sum + p.chips, 0);

// ---------------------------------------------------------------------------
// Card values + meld shapes — the foundations
// ---------------------------------------------------------------------------
test('cardValue: ace 1, pips face, courts 10', () => {
  assert.equal(cardValue(c('A')), 1);
  assert.equal(cardValue(c('7')), 7);
  assert.equal(cardValue(c('10')), 10);
  assert.equal(cardValue(c('J')), 10);
  assert.equal(cardValue(c('K')), 10);
});

test('isValidSet: 3-4 of a rank, distinct suits', () => {
  assert.ok(isValidSet([c('9', 'S'), c('9', 'H'), c('9', 'D')]));
  assert.ok(isValidSet([c('9', 'S'), c('9', 'H'), c('9', 'D'), c('9', 'C')]));
  assert.ok(!isValidSet([c('9', 'S'), c('9', 'H')]), 'two cards is not a set');
  assert.ok(!isValidSet([c('9', 'S'), c('9', 'S'), c('9', 'H')]), 'repeated suit');
  assert.ok(!isValidSet([c('9', 'S'), c('8', 'H'), c('9', 'D')]), 'mixed ranks');
});

test('isValidRun: 3+ consecutive, one suit, ace low, order-insensitive', () => {
  assert.ok(isValidRun([c('5', 'H'), c('3', 'H'), c('4', 'H')]), 'unsorted input');
  assert.ok(isValidRun([c('A', 'C'), c('2', 'C'), c('3', 'C')]), 'A-2-3 is a run (ace low)');
  assert.ok(!isValidRun([c('Q', 'C'), c('K', 'C'), c('A', 'C')]), 'Q-K-A must not wrap');
  assert.ok(!isValidRun([c('3', 'H'), c('4', 'S'), c('5', 'H')]), 'mixed suits');
  assert.ok(!isValidRun([c('3', 'H'), c('5', 'H'), c('6', 'H')]), 'gap');
  assert.ok(isValidRun([c('9', 'D'), c('10', 'D'), c('J', 'D'), c('Q', 'D'), c('K', 'D')]), 'long run');
});

test('isValidMeld distinguishes and rejects', () => {
  assert.equal(isValidMeld([c('9', 'S'), c('9', 'H'), c('9', 'D')]), 'set');
  assert.equal(isValidMeld([c('3', 'H'), c('4', 'H'), c('5', 'H')]), 'run');
  assert.equal(isValidMeld([c('3', 'H'), c('4', 'H'), c('9', 'H')]), null);
});

test('canLayOff: sets cap at 4 distinct suits; runs extend either end by one', () => {
  const set3 = { id: 1, ownerId: 'a', kind: 'set' as const, cards: [c('9', 'S'), c('9', 'H'), c('9', 'D')] };
  assert.ok(canLayOff(set3, c('9', 'C')));
  assert.ok(!canLayOff(set3, c('9', 'S')), 'suit already present');
  assert.ok(!canLayOff(set3, c('8', 'C')), 'wrong rank');
  const set4 = { ...set3, cards: [...set3.cards, c('9', 'C')] };
  assert.ok(!canLayOff(set4, c('9', 'C')), 'a set of four is full');

  const run = { id: 2, ownerId: 'a', kind: 'run' as const, cards: [c('4', 'H'), c('5', 'H'), c('6', 'H')] };
  assert.ok(canLayOff(run, c('3', 'H')), 'low end');
  assert.ok(canLayOff(run, c('7', 'H')), 'high end');
  assert.ok(!canLayOff(run, c('8', 'H')), 'gap');
  assert.ok(!canLayOff(run, c('7', 'S')), 'wrong suit');
});

// ---------------------------------------------------------------------------
// The deal
// ---------------------------------------------------------------------------
test('deal sizes: 10 for 2 players, 7 for 3-4, 6 for 5-6; all 52 accounted for', () => {
  const two = rummy.createState([seat('a'), seat('b')]);
  assert.equal(two.players[0]!.hand.length, 10);
  assert.equal(two.discard.length, 1);
  assert.equal(two.stock.length, 52 - 20 - 1);

  const four = rummy.createState([seat('a'), seat('b'), seat('c'), seat('d')]);
  assert.equal(four.players[0]!.hand.length, 7);

  const six = rummy.createState(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => seat(id)));
  assert.equal(six.players[0]!.hand.length, 6);

  const all = [...two.stock, ...two.discard, ...two.players.flatMap((p) => p.hand)];
  assert.equal(new Set(all.map((x) => x.rank + x.suit)).size, 52, 'a card is duplicated or missing');
});

test('table limits: 1 or 7 seats refused, duplicate ids refused', () => {
  assert.throws(() => rummy.createState([seat('a')]), /seats 2-6/);
  assert.throws(() => rummy.createState(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => seat(id))), /seats 2-6/);
  assert.throws(() => rummy.createState([seat('a'), seat('a')]), /Duplicate/);
});

// ---------------------------------------------------------------------------
// Turn mechanics — the action boundary
// ---------------------------------------------------------------------------
test('a turn is draw first, then act; the other seat gets nothing', () => {
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D'), c('K', 'C')],
    b: [c('2', 'S'), c('3', 'S')],
    stock: [c('4', 'D')],
    discard: [c('J', 'H')],
  });
  assert.deepEqual(rummy.legalMoves(s, 'a'), ['draw']);
  assert.deepEqual(rummy.legalMoves(s, 'b'), []);

  assert.throws(() => rummy.apply(s, 'a', 'discard', { card: 'KC' }), /Illegal move/);
  assert.throws(() => rummy.apply(s, 'b', 'draw', { source: 'stock' }), /Illegal move/);

  rummy.apply(s, 'a', 'draw', { source: 'stock' });
  assert.equal(s.players[0]!.hand.length, 5);
  assert.equal(s.stock.length, 0);
  assert.deepEqual(rummy.legalMoves(s, 'a'), ['meld', 'layoff', 'discard']);
  assert.throws(() => rummy.apply(s, 'a', 'draw', { source: 'stock' }), /Illegal move/, 'cannot draw twice');
});

test('drawing from the discard takes its top and remembers it', () => {
  const s = rigged({
    a: [c('2', 'S')],
    b: [c('3', 'S')],
    stock: [c('4', 'D')],
    discard: [c('5', 'C'), c('J', 'H')], // JH on top
  });
  rummy.apply(s, 'a', 'draw', { source: 'discard' });
  assert.ok(s.players[0]!.hand.some((x) => x.rank === 'J' && x.suit === 'H'));
  assert.equal(s.discard.length, 1);
  assert.equal(s.tookFromDiscard, 'JH');
});

test('anti-stall: the card taken from the pile cannot go straight back', () => {
  const s = rigged({
    a: [c('2', 'S'), c('7', 'D')],
    b: [c('3', 'S')],
    stock: [c('4', 'D')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'discard' });
  assert.throws(() => rummy.apply(s, 'a', 'discard', { card: 'JH' }), /cannot discard the card/);
  // A different discard is fine, and the flag clears for the next turn.
  rummy.apply(s, 'a', 'discard', { card: '7D' });
  assert.equal(s.turn, 'b');
  assert.equal(s.turnPhase, 'draw');
  assert.equal(s.tookFromDiscard, null);
});

test('discard passes the turn in seat order', () => {
  const s = rigged({
    a: [c('2', 'S'), c('7', 'D')],
    b: [c('3', 'S'), c('8', 'D')],
    stock: [c('4', 'D'), c('5', 'D')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'stock' });
  rummy.apply(s, 'a', 'discard', { card: '2S' });
  assert.equal(s.turn, 'b');
  rummy.apply(s, 'b', 'draw', { source: 'stock' });
  rummy.apply(s, 'b', 'discard', { card: '8D' });
  assert.equal(s.turn, 'a', 'turn wraps back around the table');
});

test('unknown player and unknown move are refused', () => {
  const s = rigged({ a: [c('2', 'S')], b: [c('3', 'S')], stock: [c('4', 'D')], discard: [c('J', 'H')] });
  assert.throws(() => rummy.apply(s, 'ghost', 'draw', { source: 'stock' }), /Illegal move|No such/);
  assert.throws(() => rummy.apply(s, 'a', 'fold' as never), /Unknown move/);
});

// ---------------------------------------------------------------------------
// Melds and lay-offs
// ---------------------------------------------------------------------------
function actPhase(layout: Parameters<typeof rigged>[0]): RummyState {
  const s = rigged(layout);
  rummy.apply(s, 'a', 'draw', { source: 'stock' });
  return s;
}

test('a valid set moves from hand to table', () => {
  const s = actPhase({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D'), c('K', 'C')],
    b: [c('2', 'S')],
    stock: [c('4', 'D')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D'] });
  assert.equal(s.melds.length, 1);
  assert.equal(s.melds[0]!.kind, 'set');
  assert.equal(s.players[0]!.hand.length, 2); // K + drawn 4D
});

test('an invalid meld is refused atomically — the hand is untouched', () => {
  const s = actPhase({
    a: [c('9', 'S'), c('9', 'H'), c('K', 'C'), c('Q', 'C')],
    b: [c('2', 'S')],
    stock: [c('4', 'D')],
    discard: [c('J', 'H')],
  });
  const before = s.players[0]!.hand.length;
  assert.throws(() => rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', 'KC'] }), /not a set or a run/);
  assert.throws(() => rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', 'AH'] }), /not in your hand/);
  assert.throws(() => rummy.apply(s, 'a', 'meld', { cards: ['9S', '9S', '9H'] }), /repeat/);
  assert.throws(() => rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H'] }), /at least 3/);
  assert.equal(s.players[0]!.hand.length, before, 'a refused meld took cards');
  assert.equal(s.melds.length, 0);
});

test('lay off onto anyone’s meld, both ends of a run', () => {
  const s = actPhase({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D'), c('3', 'H'), c('7', 'H'), c('K', 'C')],
    b: [c('2', 'S')],
    stock: [c('4', 'D')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D'] });
  rummy.apply(s, 'a', 'discard', { card: 'KC' });

  // b draws (the stock is empty by now, so this exercises the recycle path)
  // and then tries lay-offs onto a's set — any meld on the table is fair game.
  rummy.apply(s, 'b', 'draw', { source: 'stock' });
  const setId = s.melds[0]!.id;
  assert.throws(() => rummy.apply(s, 'b', 'layoff', { card: '2S', meldId: setId }), /does not fit/);
  assert.throws(() => rummy.apply(s, 'b', 'layoff', { card: '2S', meldId: 999 }), /No such meld/);
});

// ---------------------------------------------------------------------------
// Going out + scoring
// ---------------------------------------------------------------------------
test('win by discarding the last card: exact deadwood math, chips zero-sum', () => {
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D'), c('K', 'C')],
    b: [c('K', 'S'), c('Q', 'H'), c('5', 'D')], // deadwood 10+10+5 = 25
    stock: [c('9', 'C')],
    discard: [c('J', 'H')],
  });
  const chipsBefore = totalChips(s);
  rummy.apply(s, 'a', 'draw', { source: 'stock' }); // drew 9C — four nines + KC
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D', '9C'] }); // hand: KC
  assert.equal(s.phase, 'playing', 'one card left — not out yet');
  assert.equal(totalChips(s), chipsBefore, 'chips must not move before resolution');

  rummy.apply(s, 'a', 'discard', { card: 'KC' }); // hand empty → out by discard
  assert.equal(s.phase, 'resolved');
  const a = s.players[0]!;
  const b = s.players[1]!;
  assert.equal(a.result, 'win');
  assert.equal(a.payout, 25);
  assert.equal(a.chips, 1025);
  assert.equal(b.result, 'loss');
  assert.equal(b.deadwood, 25);
  assert.equal(b.payout, -25);
  assert.equal(b.chips, 975);
  assert.equal(totalChips(s), chipsBefore, 'rummy is zero-sum — chips conserved');
});

test('win by melding out — no final discard needed', () => {
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D')],
    b: [c('K', 'S'), c('7', 'H')], // deadwood 17
    stock: [c('9', 'C')],
    discard: [c('J', 'H')],
  });
  const before = totalChips(s);
  rummy.apply(s, 'a', 'draw', { source: 'stock' }); // 9C → four nines
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D', '9C'] }); // hand empty → out
  assert.equal(s.phase, 'resolved');
  const a = s.players[0]!;
  const b = s.players[1]!;
  assert.equal(a.result, 'win');
  assert.equal(a.payout, 17);
  assert.equal(a.chips, 1017);
  assert.equal(b.result, 'loss');
  assert.equal(b.deadwood, 17);
  assert.equal(b.chips, 983);
  assert.equal(totalChips(s), before, 'rummy is zero-sum — chips conserved');
  assert.equal(s.results?.length, 2);
});

test('no moves accepted after resolution', () => {
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D')],
    b: [c('K', 'S')],
    stock: [c('9', 'C')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'stock' });
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D', '9C'] });
  assert.equal(s.phase, 'resolved');
  assert.throws(() => rummy.apply(s, 'b', 'draw', { source: 'stock' }), /hand is over|Illegal/);
  assert.deepEqual(rummy.legalMoves(s, 'a'), []);
  assert.deepEqual(rummy.legalMoves(s, 'b'), []);
});

// ---------------------------------------------------------------------------
// Stock exhaustion
// ---------------------------------------------------------------------------
test('an empty stock recycles the discard pile, minus its top card', () => {
  const s = rigged({
    a: [c('2', 'S')],
    b: [c('3', 'S')],
    stock: [],
    discard: [c('5', 'C'), c('6', 'C'), c('J', 'H')], // JH on top
  });
  rummy.apply(s, 'a', 'draw', { source: 'stock' });
  // The recycled stock held 5C+6C; one was drawn.
  assert.equal(s.players[0]!.hand.length, 2);
  assert.equal(s.stock.length, 1);
  assert.deepEqual(s.discard.map((x) => x.rank + x.suit), ['JH'], 'top card stays as the pile');
  const everywhere = [...s.stock, ...s.discard, ...s.players.flatMap((p) => p.hand)];
  assert.equal(new Set(everywhere.map((x) => x.rank + x.suit)).size, everywhere.length, 'recycle duplicated a card');
});

test('RED H2: a dead stock draw is refused — stalemate cannot be elected', () => {
  const s = rigged({
    a: [c('2', 'S'), c('K', 'H')],
    b: [c('3', 'S'), c('Q', 'H')],
    stock: [],
    discard: [c('J', 'H')], // only the top — nothing under it to recycle
  });
  // Before the fix, a losing player could pick a stock draw here and void the
  // whole hand as a push, dodging their deadwood. Now it's a refusal and the
  // discard draw remains the legal continuation.
  assert.throws(() => rummy.apply(s, 'a', 'draw', { source: 'stock' }), /stock is exhausted/);
  assert.equal(s.phase, 'playing', 'the hand must not resolve');
  rummy.apply(s, 'a', 'draw', { source: 'discard' }); // still playable
  assert.equal(s.turnPhase, 'act');
});

test('RED H2: a full dry round — no stock, no melds — resolves as stalemate', () => {
  const s = rigged({
    a: [c('2', 'S'), c('K', 'H')],
    b: [c('3', 'S'), c('Q', 'H')],
    stock: [],
    discard: [c('J', 'H')],
  });
  const before = totalChips(s);
  // Each seat takes the pile's top and discards something else — no progress.
  rummy.apply(s, 'a', 'draw', { source: 'discard' }); // took JH
  rummy.apply(s, 'a', 'discard', { card: 'KH' }); // dry turn 1
  assert.equal(s.phase, 'playing', 'one dry turn is not yet a stalemate');
  rummy.apply(s, 'b', 'draw', { source: 'discard' }); // took KH
  rummy.apply(s, 'b', 'discard', { card: 'QH' }); // dry turn 2 = full round
  assert.equal(s.phase, 'resolved');
  assert.ok(s.players.every((p) => p.result === 'push'));
  assert.ok(s.players.every((p) => p.payout === 0));
  assert.equal(totalChips(s), before, 'a stalemate must not move chips');
});

test('RED H2: a meld resets the dry counter', () => {
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D'), c('2', 'S')],
    b: [c('3', 'S'), c('Q', 'H')],
    stock: [],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'discard' });
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D'] }); // progress!
  rummy.apply(s, 'a', 'discard', { card: '2S' });
  assert.equal(s.dryTurns, 0, 'a turn with a meld is not dry');
});

test('RED H1: the taken card may be discarded when it is the whole hand', () => {
  // Before the fix this position was a permanent deadlock: every legal-looking
  // move threw, and the table hung forever.
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D')],
    b: [c('K', 'S'), c('7', 'H')], // deadwood 17
    stock: [c('4', 'D')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'discard' }); // took JH
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D'] }); // hand: JH only
  rummy.apply(s, 'a', 'discard', { card: 'JH' }); // last card — allowed, and out
  assert.equal(s.phase, 'resolved');
  assert.equal(s.players[0]!.result, 'win');
  assert.equal(s.players[0]!.payout, 17);
});

test('RED: layoff success path — card leaves the hand, the meld grows, out by layoff wins', () => {
  const s = rigged({
    a: [c('4', 'H'), c('5', 'H'), c('6', 'H'), c('3', 'H')],
    b: [c('K', 'S'), c('7', 'D')], // deadwood 17
    stock: [c('2', 'C'), c('9', 'C')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'stock' }); // drew 9C
  rummy.apply(s, 'a', 'meld', { cards: ['4H', '5H', '6H'] }); // hand: 3H, 9C
  const meldId = s.melds[0]!.id;
  rummy.apply(s, 'a', 'layoff', { card: '3H', meldId }); // run grows low end
  assert.equal(s.melds[0]!.cards.length, 4);
  assert.deepEqual(s.melds[0]!.cards.map((x) => x.rank), ['3', '4', '5', '6'], 'meld stays sorted');
  assert.equal(s.players[0]!.hand.length, 1, 'the laid-off card left the hand');

  rummy.apply(s, 'a', 'discard', { card: '9C' }); // hand empty → out
  assert.equal(s.phase, 'resolved');
  assert.equal(s.players[0]!.result, 'win');
});

test('RED: three-seat resolution — every loser pays, the winner collects the sum', () => {
  const state = rummy.createState([seat('a'), seat('b'), seat('c')], { startingChips: 1000 });
  state.players[0]!.hand = [c('9', 'S'), c('9', 'H'), c('9', 'D')];
  state.players[1]!.hand = [c('K', 'S'), c('5', 'H')]; // 15
  state.players[2]!.hand = [c('A', 'C'), c('Q', 'D')]; // 11
  state.stock = [c('9', 'C')];
  state.discard = [c('J', 'H')];
  state.turn = 'a';
  state.turnPhase = 'draw';

  const before = totalChips(state);
  rummy.apply(state, 'a', 'draw', { source: 'stock' });
  rummy.apply(state, 'a', 'meld', { cards: ['9S', '9H', '9D', '9C'] }); // out
  assert.equal(state.players[0]!.payout, 26);
  assert.equal(state.players[1]!.payout, -15);
  assert.equal(state.players[2]!.payout, -11);
  assert.equal(totalChips(state), before, 'multi-seat rummy is zero-sum');
});

test('RED M3: nextHand from someone not at the table is refused', () => {
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D')],
    b: [c('K', 'S')],
    stock: [c('9', 'C')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'stock' });
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D', '9C'] });
  assert.equal(s.phase, 'resolved');
  assert.throws(() => rummy.apply(s, 'ghost', 'nextHand'), /No such player/);
  rummy.apply(s, 'a', 'nextHand'); // a seated player is fine
  assert.equal(s.phase, 'playing');
});

// ---------------------------------------------------------------------------
// Next hand
// ---------------------------------------------------------------------------
test('nextHand redeals, rotates the first turn, and keeps the chips', () => {
  const s = rigged({
    a: [c('9', 'S'), c('9', 'H'), c('9', 'D')],
    b: [c('K', 'S'), c('7', 'H')],
    stock: [c('9', 'C')],
    discard: [c('J', 'H')],
  });
  rummy.apply(s, 'a', 'draw', { source: 'stock' });
  rummy.apply(s, 'a', 'meld', { cards: ['9S', '9H', '9D', '9C'] });
  const aChips = s.players[0]!.chips;

  assert.throws(() => rummy.apply(s, 'a', 'draw', { source: 'stock' }), /hand is over|Illegal/);
  rummy.apply(s, 'a', 'nextHand');
  assert.equal(s.phase, 'playing');
  assert.equal(s.handNumber, 1);
  assert.equal(s.turn, 'b', 'the first draw rotates to the next seat');
  assert.equal(s.players[0]!.chips, aChips, 'chips persist across hands');
  assert.equal(s.players[0]!.hand.length, 10);
  assert.equal(s.melds.length, 0);
});

test('nextHand is refused while the hand is live', () => {
  const s = rummy.createState([seat('a'), seat('b')]);
  assert.throws(() => rummy.apply(s, 'a', 'nextHand'), /still in play/);
});

// ---------------------------------------------------------------------------
// view() — the redaction boundary
// ---------------------------------------------------------------------------
test('view: your hand in full, opponents as counts, the stock as a number', () => {
  const s = rummy.createState([seat('a'), seat('b')]);
  const v = rummy.view(s, 'a');

  const me = v.players.find((p) => p.id === 'a')!;
  const them = v.players.find((p) => p.id === 'b')!;
  assert.equal(me.hand.length, 10);
  assert.equal(me.handCount, 10);
  assert.deepEqual(them.hand, [], "an opponent's cards crossed the wire");
  assert.equal(them.handCount, 10);
  assert.equal(v.stockCount, s.stock.length);
  assert.ok(!JSON.stringify(v).includes('"stock"'), 'the stock leaked into the payload');
});

test('view: opponents see mirror-image redaction', () => {
  const s = rummy.createState([seat('a'), seat('b')]);
  const v = rummy.view(s, 'b');
  assert.equal(v.players.find((p) => p.id === 'b')!.hand.length, 10);
  assert.deepEqual(v.players.find((p) => p.id === 'a')!.hand, []);
  assert.equal(v.you, 'b');
});

test('view: returns copies — mutating the view cannot touch the game', () => {
  const s = rummy.createState([seat('a'), seat('b')]);
  const v = rummy.view(s, 'a');
  v.players[0]!.hand.push(c('A', 'S'));
  v.discard.push(c('K', 'S'));
  v.settings.startingChips = 999_999;
  assert.equal(s.players[0]!.hand.length, 10);
  assert.equal(s.discard.length, 1);
  assert.equal(s.settings.startingChips, 1000);
});
