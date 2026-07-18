// Blackjack engine tests.
//
// Two jobs. First, pin the four bugs Agent Red found in the Phase 1 frontend —
// until now those were guarded by nothing but the fixes themselves, so any
// future edit could silently undo them. Second, guard the TypeScript port:
// these assert behaviour that must be identical before and after the move.
//
// Every test stacks the deck rather than shuffling, so a failure means a real
// regression and never an unlucky seed.

import test from 'node:test';
import assert from 'node:assert/strict';

import engine, { handValue } from '../src/blackjack/engine.ts';
import type { BlackjackState, Card, Rank, SuitId } from '../src/types.ts';

const GLYPH: Record<SuitId, string> = { S: '♠', H: '♡', D: '♢', C: '♣' };

/** One card. */
const c = (rank: Rank, suit: SuitId = 'S'): Card => ({
  rank,
  suit,
  glyph: GLYPH[suit],
  fill: suit === 'S' || suit === 'C' ? 'solid' : 'outline',
});

/**
 * Stack the shoe so cards come out in the order written. `draw()` pops from the
 * end, so the array is reversed — tests read in dealing order, which is how
 * anyone reasoning about a hand actually thinks.
 */
function stackDeck(state: BlackjackState, drawOrder: Card[]): void {
  state.deck = drawOrder.slice().reverse();
}

const seat = (id: string, chips = 1000) => ({ id, nickname: id, chips });

/** A two-player table (you + dealer opponent) with a known shoe. */
function table(drawOrder: Card[], chips = 1000): BlackjackState {
  const state = engine.createState([seat('you', chips)], { startingChips: chips });
  stackDeck(state, drawOrder);
  return state;
}

// ---------------------------------------------------------------------------
// Hand values — the foundation everything else rests on
// ---------------------------------------------------------------------------
test('handValue: face cards are ten', () => {
  assert.equal(handValue([c('K'), c('Q')]).total, 20);
});

test('handValue: ace is 11 until it would bust, then 1', () => {
  assert.deepEqual(handValue([c('A'), c('9')]), { total: 20, soft: true });
  // 11 + 9 + 5 would be 25, so the ace drops to 1.
  assert.deepEqual(handValue([c('A'), c('9'), c('5')]), { total: 15, soft: false });
});

test('handValue: multiple aces only one stays high', () => {
  // A+A = 12 (11 + 1), not 22.
  assert.deepEqual(handValue([c('A'), c('A')]), { total: 12, soft: true });
  assert.deepEqual(handValue([c('A'), c('A'), c('9')]), { total: 21, soft: true });
});

test('handValue: empty hand is zero, not NaN', () => {
  assert.deepEqual(handValue([]), { total: 0, soft: false });
});

// ---------------------------------------------------------------------------
// RED FINDING L3 — mid-hand reshoe dealt duplicate cards
// A fresh 52 ignored cards already on the table, so the same card could appear
// twice in one hand.
// ---------------------------------------------------------------------------
test('RED L3: mid-hand reshoe never deals a card already in play', () => {
  const state = table([c('K', 'H'), c('5', 'D'), c('9', 'C'), c('7', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');

  const inPlayBefore = [...state.players.flatMap((p) => p.cards), ...state.dealer.cards];
  const keys = new Set(inPlayBefore.map((card) => card.rank + card.suit));

  // Force the reshoe: empty the shoe mid-hand, then make the player draw.
  state.deck = [];
  engine.apply(state, 'you', 'hit');

  const drawn = state.players[0]!.cards.at(-1)!;
  assert.ok(
    !keys.has(drawn.rank + drawn.suit),
    `reshoe dealt ${drawn.rank}${drawn.suit}, which was already on the table`,
  );

  // And the whole table is still duplicate-free.
  const all = [...state.players.flatMap((p) => p.cards), ...state.dealer.cards];
  const allKeys = all.map((card) => card.rank + card.suit);
  assert.equal(new Set(allKeys).size, allKeys.length, 'a card appears twice on the table');
});

test('RED L3: the rebuilt shoe excludes exactly the cards in play', () => {
  const state = table([c('K', 'H'), c('5', 'D'), c('9', 'C'), c('7', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');

  const inPlay = [...state.players.flatMap((p) => p.cards), ...state.dealer.cards].length;
  state.deck = [];
  engine.apply(state, 'you', 'hit');

  // 52 minus what was on the table, minus the one just drawn.
  assert.equal(state.deck.length, 52 - inPlay - 1);
});

// ---------------------------------------------------------------------------
// RED FINDING M1 — 3:2 payouts round off the chip grain
// Math.round(bet * 1.5) puts stacks on values no chip button can bet, which is
// how a player reached the 0 < chips < 5 dead zone.
// ---------------------------------------------------------------------------
test('RED M1: blackjack pays 3:2 rounded, drifting the stack off the 5-grain', () => {
  const state = table([c('A', 'H'), c('K', 'D'), c('9', 'C'), c('7', 'S')], 1000);
  engine.apply(state, 'you', 'bet', 5);
  engine.apply(state, 'you', 'deal');

  const you = state.players[0]!;
  assert.equal(you.status, 'blackjack');
  assert.equal(you.result, 'blackjack');
  // round(5 * 1.5) = 8, not 7.5 and not 7.
  assert.equal(you.payout, 8);
  assert.equal(you.chips, 1008);
  // The point of the finding: 1008 is not divisible by 5, so repeated hands can
  // strand a stack below the smallest chip. The client must top up at < 5, not
  // at <= 0 — see app.mjs #nextHand.
  assert.notEqual(you.chips % 5, 0);
});

test('RED M1: a sub-minimum stack still cannot cover the smallest chip', () => {
  // The dead-zone state itself: 3 chips left, every chip button unaffordable.
  const state = table([c('K'), c('5')], 3);
  assert.throws(() => engine.apply(state, 'you', 'bet', 5), /Not enough chips/);
});

// ---------------------------------------------------------------------------
// RED FINDING (dealer rule) — soft 17
// The dealer must stand on ALL 17s, including soft. Drawing on soft 17 is a
// different game with different odds.
// ---------------------------------------------------------------------------
test('RED: dealer stands on soft 17 (A+6) and does not draw', () => {
  // you: K,9 = 19 (stand). dealer: A,6 = soft 17.
  const state = table([c('K', 'H'), c('9', 'D'), c('A', 'C'), c('6', 'S'), c('5', 'H')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  engine.apply(state, 'you', 'stand');

  assert.equal(state.dealer.cards.length, 2, 'dealer drew on soft 17');
  assert.deepEqual(handValue(state.dealer.cards), { total: 17, soft: true });
  assert.equal(state.players[0]!.result, 'win'); // 19 beats 17
});

test('dealer draws on hard 16 and stands once it reaches 17+', () => {
  // dealer: K,6 = hard 16 → must draw. Next card 5 → 21.
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('6', 'S'), c('5', 'H')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  engine.apply(state, 'you', 'stand');

  assert.equal(state.dealer.cards.length, 3, 'dealer stood on 16');
  assert.equal(handValue(state.dealer.cards).total, 21);
  assert.equal(state.players[0]!.result, 'loss');
});

// ---------------------------------------------------------------------------
// RED FINDING H3/M1 — the engine contract that made the client soft-lock
// placeBet throws rather than clamping. That is correct for an authoritative
// server, but it means every caller must check affordability FIRST. Pinning it
// so the server-side bot port (Stage B) doesn't reintroduce the crash.
// ---------------------------------------------------------------------------
test('RED H3: betting more than the stack throws, it does not clamp', () => {
  const state = table([c('K'), c('5')], 50);
  assert.throws(() => engine.apply(state, 'you', 'bet', 100), /Not enough chips/);
  assert.equal(state.players[0]!.bet, 0, 'a rejected bet must not be partially applied');
});

test('betting outside the betting phase is rejected', () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('7', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  assert.throws(() => engine.apply(state, 'you', 'bet', 100), /Betting is closed/);
});

test('an unknown player id is rejected, not a crash on undefined', () => {
  const state = table([c('K'), c('5')]);
  assert.throws(() => engine.apply(state, 'nobody', 'bet', 10), /No such player/);
});

// ---------------------------------------------------------------------------
// Core outcomes — did the port change how a hand resolves?
// ---------------------------------------------------------------------------
test('bust loses even when the dealer also busts', () => {
  // you: K,9 then hit 5 = 24 bust. Dealer never draws (nobody contests).
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('6', 'S'), c('5', 'H')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  engine.apply(state, 'you', 'hit');

  const you = state.players[0]!;
  assert.equal(you.status, 'bust');
  assert.equal(you.result, 'bust');
  assert.equal(you.payout, -100);
  assert.equal(you.chips, 900);
  assert.equal(state.dealer.cards.length, 2, 'dealer drew despite every player busting');
});

test('equal totals push and the bet comes home', () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('9', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  engine.apply(state, 'you', 'stand');

  const you = state.players[0]!;
  assert.equal(you.result, 'push');
  assert.equal(you.payout, 0);
  assert.equal(you.chips, 1000, 'a push must return the stake exactly');
});

test('dealer blackjack beats a drawn 21', () => {
  // you: K,5 then hit 6 = 21 (three cards). dealer: A,K = natural.
  const state = table([c('K', 'H'), c('5', 'D'), c('A', 'C'), c('K', 'S'), c('6', 'H')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  engine.apply(state, 'you', 'hit');
  engine.apply(state, 'you', 'stand');

  assert.equal(handValue(state.players[0]!.cards).total, 21);
  assert.equal(state.players[0]!.result, 'loss', 'a drawn 21 must not beat a natural');
});

test('blackjack against blackjack is a push', () => {
  const state = table([c('A', 'H'), c('K', 'D'), c('A', 'C'), c('Q', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');

  const you = state.players[0]!;
  assert.equal(you.result, 'push');
  assert.equal(you.chips, 1000);
});

test('double takes exactly one card, doubles the stake, and ends the turn', () => {
  const state = table([c('5', 'H'), c('6', 'D'), c('K', 'C'), c('7', 'S'), c('9', 'H')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  engine.apply(state, 'you', 'double');

  const you = state.players[0]!;
  assert.equal(you.cards.length, 3, 'double must take exactly one card');
  assert.equal(you.bet, 200);
  assert.equal(you.status, 'standing');
  assert.equal(handValue(you.cards).total, 20); // 5+6+9
  assert.equal(you.result, 'win'); // 20 beats dealer 17
  assert.equal(you.chips, 1200); // 1000 - 200 staked + 400 returned
});

// ---------------------------------------------------------------------------
// Legal moves — the server rejects out-of-turn play, it doesn't just grey out
// ---------------------------------------------------------------------------
test('legalMoves: betting phase offers only a bet', () => {
  const state = table([c('K'), c('5')]);
  assert.deepEqual(engine.legalMoves(state, 'you'), ['bet']);
});

test('legalMoves: double disappears after the first decision', () => {
  const state = table([c('5', 'H'), c('6', 'D'), c('K', 'C'), c('7', 'S'), c('2', 'H')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  assert.deepEqual(engine.legalMoves(state, 'you'), ['hit', 'stand', 'double']);

  engine.apply(state, 'you', 'hit'); // now three cards
  assert.deepEqual(engine.legalMoves(state, 'you'), ['hit', 'stand']);
});

test('legalMoves: no double when the stack cannot cover it', () => {
  const state = table([c('5', 'H'), c('6', 'D'), c('K', 'C'), c('7', 'S')], 100);
  engine.apply(state, 'you', 'bet', 100); // whole stack committed
  engine.apply(state, 'you', 'deal');
  assert.deepEqual(engine.legalMoves(state, 'you'), ['hit', 'stand']);
});

test('legalMoves: a player who is not on turn gets nothing', () => {
  const state = engine.createState([seat('you'), seat('p2')], { startingChips: 1000 });
  stackDeck(state, [c('K', 'H'), c('9', 'D'), c('K', 'C'), c('9', 'S'), c('7', 'H'), c('8', 'D')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'p2', 'bet', 100);
  engine.apply(state, 'you', 'deal');

  assert.equal(state.turn, 'you');
  assert.deepEqual(engine.legalMoves(state, 'p2'), [], 'off-turn player was offered moves');
});

// ---------------------------------------------------------------------------
// view() — the anti-cheat boundary (PRD §6). Stage B depends on this holding.
// ---------------------------------------------------------------------------
test('view: the deck never crosses the wire', () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('7', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');

  const v = engine.view(state, 'you');
  assert.equal(v.deck, undefined, 'the deck leaked into the client view');
  assert.ok(!Object.prototype.hasOwnProperty.call(v, 'deck') || v.deck === undefined);
  // Serialised is the form that actually ships — check there too.
  assert.ok(!JSON.stringify(v).includes('"deck"'), 'deck present in the serialised payload');
  assert.equal(v.deckCount, state.deck.length, 'count is fine to share, contents are not');
});

test("view: the dealer's hole card is null until reveal", () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('7', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');

  const hidden = engine.view(state, 'you');
  assert.equal(hidden.dealer.revealed, false);
  assert.equal(hidden.dealer.cards.length, 2);
  assert.ok(hidden.dealer.cards[0], 'the upcard must be visible');
  assert.equal(hidden.dealer.cards[1], null, 'the hole card leaked');
  // The total must describe the upcard only — a full total would leak the card
  // just as effectively as sending it.
  assert.equal(hidden.dealer.total, 10, 'dealer total leaked the hole card');

  engine.apply(state, 'you', 'stand'); // resolves the hand, reveals the dealer
  const shown = engine.view(state, 'you');
  assert.equal(shown.dealer.revealed, true);
  assert.ok(shown.dealer.cards[1], 'hole card should be visible after reveal');
  assert.equal(shown.dealer.total, 17);
});

test('view: hand totals are precomputed for every seat', () => {
  const state = table([c('A', 'H'), c('9', 'D'), c('K', 'C'), c('7', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');

  const v = engine.view(state, 'you');
  assert.equal(v.players[0]!.total, 20);
  assert.equal(v.players[0]!.soft, true);
  assert.equal(v.you, 'you');
});

test('view: an empty dealer hand reports zero, not NaN', () => {
  const state = table([c('K'), c('5')]);
  const v = engine.view(state, 'you');
  assert.equal(v.dealer.total, 0);
  assert.deepEqual(v.dealer.cards, []);
});

// ---------------------------------------------------------------------------
// Hand lifecycle
// ---------------------------------------------------------------------------
test('nextHand clears the table but keeps seats and stacks', () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('9', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  engine.apply(state, 'you', 'stand');
  const chipsAfter = state.players[0]!.chips;

  engine.apply(state, 'you', 'nextHand');

  const you = state.players[0]!;
  assert.equal(state.phase, 'betting');
  assert.equal(you.chips, chipsAfter, 'nextHand must not touch the stack');
  assert.deepEqual(you.cards, []);
  assert.equal(you.bet, 0);
  assert.equal(you.result, null);
  assert.deepEqual(state.dealer.cards, []);
  assert.equal(state.dealer.revealed, false);
  assert.equal(state.results, null);
});

test('a hand with no bets cannot be dealt', () => {
  const state = table([c('K'), c('5')]);
  assert.throws(() => engine.apply(state, 'you', 'deal'), /No bets placed/);
});

test('isHandOver only reports true once resolved', () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('9', 'S')]);
  assert.equal(engine.isHandOver(state), false);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  assert.equal(engine.isHandOver(state), false);
  engine.apply(state, 'you', 'stand');
  assert.equal(engine.isHandOver(state), true);
});

test('an unknown move is rejected', () => {
  const state = table([c('K'), c('5')]);
  // Deliberately bypassing the Move union — the server takes this off the wire.
  assert.throws(() => engine.apply(state, 'you', 'fold' as never), /Unknown move/);
});

// ---------------------------------------------------------------------------
// Deck integrity
// ---------------------------------------------------------------------------
test('a fresh shoe is 52 distinct cards', () => {
  const state = engine.createState([seat('you')]);
  assert.equal(state.deck.length, 52);
  assert.equal(new Set(state.deck.map((card) => card.rank + card.suit)).size, 52);
});

test('suits follow the filled-vs-outlined rule (PRD §5.6)', () => {
  const state = engine.createState([seat('you')]);
  for (const card of state.deck) {
    const expected = card.suit === 'S' || card.suit === 'C' ? 'solid' : 'outline';
    assert.equal(card.fill, expected, `${card.rank}${card.suit} has the wrong fill`);
  }
});

// ---------------------------------------------------------------------------
// The action boundary (PRD §6).
//
// `legalMoves()` used to be advisory — it described what a seat could do and
// nothing checked it, because the Phase 1 client was the only caller and its UI
// was the gate. A server takes moves off a socket, so each of these is a way a
// hostile client could rob the table. Every test below FAILED before the fix.
// ---------------------------------------------------------------------------

/** Two seats, both bet, dealt, `you` on turn. */
function twoSeatHand(drawOrder: Card[]): BlackjackState {
  const state = engine.createState([seat('you'), seat('p2')], { startingChips: 1000 });
  stackDeck(state, drawOrder);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'p2', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  return state;
}

test('ACTION: a seat cannot act out of turn', () => {
  const state = twoSeatHand([
    c('K', 'H'), c('9', 'D'), // you = 19
    c('K', 'C'), c('9', 'S'), // p2  = 19
    c('7', 'H'), c('8', 'D'), // dealer
  ]);
  assert.equal(state.turn, 'you');
  assert.deepEqual(engine.legalMoves(state, 'p2'), []);

  // Before the fix p2 was marked `standing` and later paid out on a hand it
  // never played.
  assert.throws(() => engine.apply(state, 'p2', 'stand'), /Illegal move/);
  assert.equal(state.players[1]!.status, 'playing', 'off-turn move changed the seat');
});

test('ACTION: no moves once the hand has resolved', () => {
  const state = twoSeatHand([
    c('K', 'H'), c('9', 'D'),
    c('K', 'C'), c('9', 'S'),
    c('7', 'H'), c('8', 'D'),
  ]);
  engine.apply(state, 'you', 'stand');
  engine.apply(state, 'p2', 'stand');
  assert.equal(state.phase, 'resolved');

  const cardsBefore = state.players[0]!.cards.length;
  assert.throws(() => engine.apply(state, 'you', 'hit'), /Illegal move/);
  assert.equal(state.players[0]!.cards.length, cardsBefore, 'a settled hand grew a card');
});

test('ACTION: cannot double a stack that cannot cover it', () => {
  const state = engine.createState([seat('you', 100)], { startingChips: 100 });
  stackDeck(state, [c('5', 'H'), c('6', 'D'), c('K', 'C'), c('7', 'S'), c('9', 'H')]);
  engine.apply(state, 'you', 'bet', 100); // whole stack committed
  engine.apply(state, 'you', 'deal');
  assert.deepEqual(engine.legalMoves(state, 'you'), ['hit', 'stand']);

  // Before the fix: 200 staked out of a 100 stack.
  assert.throws(() => engine.apply(state, 'you', 'double'), /Illegal move/);
  assert.equal(state.players[0]!.bet, 100);
  assert.equal(state.players[0]!.chips, 0);
});

test('ACTION: dealing twice cannot charge the stake again', () => {
  const state = engine.createState([seat('you')], { startingChips: 1000 });
  stackDeck(state, [c('K', 'H'), c('9', 'D'), c('K', 'C'), c('9', 'S'), c('2', 'H'), c('3', 'D')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  const chips = state.players[0]!.chips;
  const cards = state.players[0]!.cards.length;

  assert.throws(() => engine.apply(state, 'you', 'deal'), /already dealt/);
  assert.equal(state.players[0]!.chips, chips, 'a second deal charged the stake again');
  assert.equal(state.players[0]!.cards.length, cards);
});

test('ACTION: play moves are refused during the betting phase', () => {
  const state = table([c('K'), c('9'), c('5'), c('4'), c('3'), c('2')]);
  // Before the fix, five hits in the betting phase busted a seat that had no
  // bet, ran the dealer on an empty hand, and left the table `resolved` and
  // unplayable — a one-line grief for any client in the room.
  assert.throws(() => engine.apply(state, 'you', 'hit'), /Illegal move/);
  assert.throws(() => engine.apply(state, 'you', 'stand'), /Illegal move/);
  assert.equal(state.phase, 'betting');
  assert.deepEqual(state.dealer.cards, []);
});

test('ACTION: nextHand is refused while the hand is live', () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('9', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  assert.throws(() => engine.apply(state, 'you', 'nextHand'), /still in play/);
  assert.equal(state.players[0]!.cards.length, 2);
});

test('ACTION: a refusal does not say which rule it broke', () => {
  // Turn order, phase, and affordability all produce the same message, so a
  // rejected move can't be used to probe hidden state.
  const state = twoSeatHand([
    c('K', 'H'), c('9', 'D'), c('K', 'C'), c('9', 'S'), c('7', 'H'), c('8', 'D'),
  ]);
  assert.throws(() => engine.apply(state, 'p2', 'hit'), /^Error: Illegal move 'hit' for p2\.$/);
});

// ---------------------------------------------------------------------------
// Bet validation — chip integrity
// ---------------------------------------------------------------------------
test('MONEY: a negative bet is refused, not silently settled', () => {
  const state = engine.createState([seat('you'), seat('p2')], { startingChips: 1000 });
  stackDeck(state, [c('K', 'H'), c('9', 'D'), c('K', 'C'), c('6', 'S'), c('5', 'H')]);
  // Before the fix: -500 passed the affordability check, the seat was skipped
  // by deal() so it got no cards, then still settled — minting chips from a
  // hand that was never played, while absent from the results array.
  assert.throws(() => engine.apply(state, 'p2', 'bet', -500), /negative/);
  assert.equal(state.players[1]!.bet, 0);
});

test('MONEY: NaN and fractional bets are refused', () => {
  const state = table([c('K'), c('5')]);
  assert.throws(() => engine.apply(state, 'you', 'bet', NaN), /whole number/);
  assert.throws(() => engine.apply(state, 'you', 'bet', Infinity), /whole number/);
  assert.throws(() => engine.apply(state, 'you', 'bet', 12.5), /whole number/);
  assert.equal(state.players[0]!.bet, 0);
  assert.equal(state.players[0]!.chips, 1000, 'a rejected bet touched the stack');
});

test('MONEY: chips are conserved across a full hand', () => {
  // Nothing should mint or destroy chips: every seat ends at stake ± payout.
  for (const seed of [1, 2, 3]) {
    const state = engine.createState([seat('you'), seat('p2')], { startingChips: 1000 });
    stackDeck(state, [
      c('K', 'H'), c('9', 'D'),
      c('A', 'C'), c('7', 'S'),
      c('10', 'H'), c(String(seed + 4) as Rank, 'D'),
    ]);
    engine.apply(state, 'you', 'bet', 100);
    engine.apply(state, 'p2', 'bet', 50);
    engine.apply(state, 'you', 'deal');
    while (state.phase === 'playing' && state.turn) {
      engine.apply(state, state.turn, 'stand');
    }
    for (const p of state.players) {
      const staked = 1000 - p.bet;
      assert.equal(
        p.chips,
        staked + p.bet + p.payout,
        `${p.id} chips drifted: ${p.chips} != ${staked + p.bet + p.payout}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Table construction
// ---------------------------------------------------------------------------
test('TABLE: maxPlayers is enforced, not just documented', () => {
  const many = Array.from({ length: 26 }, (_, i) => seat(`p${i}`));
  // Before the fix this built fine, then threw halfway through the deal with
  // all 26 stakes already taken — chips destroyed, table unplayable.
  assert.throws(() => engine.createState(many), /seats 1-6 players/);
  assert.throws(() => engine.createState([]), /seats 1-6 players/);
});

test('TABLE: duplicate seat ids are refused', () => {
  assert.throws(() => engine.createState([seat('you'), seat('you')]), /Duplicate player id/);
});

test('TABLE: a blank startingChips falls back rather than yielding undefined', () => {
  // A room form with the field left empty produces `{ startingChips: undefined }`.
  // Spreading that over the defaults used to overwrite them, leaving every seat
  // on `undefined` chips — which then went NaN on the first bet.
  const state = engine.createState([{ id: 'you', nickname: 'you' }], {
    startingChips: undefined,
    tableSpeed: 'normal',
  });
  assert.equal(state.players[0]!.chips, 1000);
});

test('TABLE: room settings survive the port intact', () => {
  // No explicit chips on the seat — the stack must come from the room setting.
  const state = engine.createState([{ id: 'you', nickname: 'you' }], {
    startingChips: 500,
    tableSpeed: 'fast',
  });
  assert.equal(state.settings.startingChips, 500);
  assert.equal(state.settings.tableSpeed, 'fast');
  assert.equal(state.players[0]!.chips, 500);
});

test('TABLE: isYou survives the port', () => {
  const state = engine.createState([
    { id: 'you', nickname: 'you', isYou: true },
    { id: 'p2', nickname: 'p2' },
  ]);
  assert.equal(state.players[0]!.isYou, true);
  assert.equal(state.players[1]!.isYou, false, 'isYou must default to false, not undefined');
});

// ---------------------------------------------------------------------------
// view() must not hand out live references into authoritative state
// ---------------------------------------------------------------------------
test('view: returns a copy, not a window into server state', () => {
  const state = table([c('K', 'H'), c('9', 'D'), c('K', 'C'), c('7', 'S')]);
  engine.apply(state, 'you', 'bet', 100);
  engine.apply(state, 'you', 'deal');
  const v = engine.view(state, 'you');

  assert.notEqual(v.players[0]!.cards, state.players[0]!.cards, 'player cards are aliased');
  assert.notEqual(v.settings, state.settings, 'settings are aliased');
  assert.notEqual(v.dealer.cards, state.dealer.cards, 'dealer cards are aliased');
  assert.notEqual(v.players[0]!.cards[0], state.players[0]!.cards[0], 'card objects are aliased');

  // Writing through the view must not reach the real game.
  v.settings.startingChips = 999_999;
  v.players[0]!.chips = 999_999;
  v.dealer.cards.push(c('A', 'S'));
  assert.equal(state.settings.startingChips, 1000, 'view mutated server settings');
  assert.equal(state.players[0]!.chips, 900, 'view mutated a real chip stack');
  assert.equal(state.dealer.cards.length, 2, 'view grew the real dealer hand');
});

// ---------------------------------------------------------------------------
// Results + turn progression
// ---------------------------------------------------------------------------
test('results carry every seat that had a stake, and only those', () => {
  const state = twoSeatHand([
    c('K', 'H'), c('9', 'D'), // you 19
    c('K', 'C'), c('5', 'S'), // p2 15
    c('10', 'H'), c('7', 'D'), // dealer 17
  ]);
  engine.apply(state, 'you', 'stand');
  engine.apply(state, 'p2', 'stand');

  assert.equal(state.results?.length, 2);
  const you = state.results!.find((r) => r.id === 'you')!;
  const p2 = state.results!.find((r) => r.id === 'p2')!;
  assert.equal(you.result, 'win'); // 19 > 17
  assert.equal(you.payout, 100);
  assert.equal(p2.result, 'loss'); // 15 < 17
  assert.equal(p2.payout, -100);
  // results must agree with the stacks the client renders
  assert.equal(you.chips, state.players[0]!.chips);
  assert.equal(p2.chips, state.players[1]!.chips);
});

test('turn passes down the table and the dealer plays only at the end', () => {
  const state = twoSeatHand([
    c('K', 'H'), c('9', 'D'),
    c('K', 'C'), c('5', 'S'),
    c('10', 'H'), c('7', 'D'),
  ]);
  assert.equal(state.turn, 'you');
  assert.equal(state.dealer.revealed, false);

  engine.apply(state, 'you', 'stand');
  assert.equal(state.turn, 'p2', 'turn did not pass to the next seat');
  assert.equal(state.phase, 'playing');
  assert.equal(state.dealer.revealed, false, 'dealer revealed before every seat had played');

  engine.apply(state, 'p2', 'stand');
  assert.equal(state.turn, null);
  assert.equal(state.phase, 'resolved');
  assert.equal(state.dealer.revealed, true);
});

// ---------------------------------------------------------------------------
// The reshoe, reached the way production reaches it
// ---------------------------------------------------------------------------
test('RED L3: a shoe drained by real draws still deals no duplicates', () => {
  // The earlier reshoe test sets `deck = []` by hand. This one drains it the
  // way play does, so the natural trigger is covered too.
  const state = engine.createState([seat('you')], { startingChips: 100_000 });
  for (let hand = 0; hand < 40; hand++) {
    engine.apply(state, 'you', 'bet', 5);
    engine.apply(state, 'you', 'deal');
    let guard = 0;
    while (state.phase === 'playing' && state.turn && guard++ < 20) {
      const total = handValue(state.players[0]!.cards).total;
      engine.apply(state, 'you', total < 17 ? 'hit' : 'stand');
    }
    const onTable = [...state.players.flatMap((p) => p.cards), ...state.dealer.cards];
    const keys = onTable.map((card) => card.rank + card.suit);
    assert.equal(new Set(keys).size, keys.length, `duplicate card on the table in hand ${hand}`);
    engine.apply(state, 'you', 'nextHand');
  }
});
