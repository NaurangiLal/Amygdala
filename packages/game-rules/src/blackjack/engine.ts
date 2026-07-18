// Blackjack rules engine (PRD §5.3).
// Pure functions over a state object — no DOM, no network, no framework. This
// module is the authority on what a legal hand is; the Colyseus room owns it
// and copies only public fields into the synced schema (PRD §7).

import type {
  BlackjackState,
  Card,
  ClientView,
  GameEngine,
  HandValue,
  Move,
  Player,
  Rank,
  RoomSettings,
  SeatInput,
  SuitFill,
  SuitId,
} from '../types.ts';

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// Suit rule (PRD §5.6): spades/clubs render solid, hearts/diamonds outlined.
const SUITS: { id: SuitId; glyph: string; fill: SuitFill }[] = [
  { id: 'S', glyph: '♠', fill: 'solid' },
  { id: 'H', glyph: '♡', fill: 'outline' },
  { id: 'D', glyph: '♢', fill: 'outline' },
  { id: 'C', glyph: '♣', fill: 'solid' },
];

const BLACKJACK_PAYOUT = 1.5;
const DEALER_STANDS_ON = 17;
const TEN_VALUED: Rank[] = ['K', 'Q', 'J'];
const MIN_PLAYERS = 1;
const MAX_PLAYERS = 6;

function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit: suit.id, glyph: suit.glyph, fill: suit.fill });
  }
  return deck;
}

// Fisher-Yates. On the server this is the only place cards get ordered, and the
// result never leaves it.
function shuffle(deck: Card[]): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // Non-null asserted: i and j are both in range by construction, but
    // noUncheckedIndexedAccess can't see that.
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Aces count 11 until that would bust, then 1. */
export function handValue(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces++;
      total += 11;
    } else if (TEN_VALUED.includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards: Card[]): boolean => cards.length === 2 && handValue(cards).total === 21;
const isBust = (cards: Card[]): boolean => handValue(cards).total > 21;

function createState(seats: SeatInput[], settings: Partial<RoomSettings> = {}): BlackjackState {
  // Spreading `...settings` would let an explicit `undefined` (a blank field in
  // a room form) overwrite the default and leave every seat on undefined chips.
  // `??` per field can't be overwritten that way.
  const resolved: RoomSettings = {
    startingChips: settings.startingChips ?? 1000,
    tableSpeed: settings.tableSpeed ?? 'normal',
  };
  // The seat limit is a rule, not documentation. Beyond ~6 seats a single shoe
  // can't cover a hand, and the deal would fail halfway with stakes already
  // taken — so the table is refused before any chips move.
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    throw new Error(`Blackjack seats ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${seats.length}.`);
  }
  const ids = new Set(seats.map((s) => s.id));
  if (ids.size !== seats.length) throw new Error('Duplicate player id at the table.');

  return {
    game: 'blackjack',
    phase: 'betting', // betting -> playing -> dealer -> resolved
    deck: shuffle(freshDeck()), // server-only, never sent to a client
    dealer: { cards: [], revealed: false },
    turn: null,
    settings: resolved,
    players: seats.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isYou: Boolean(p.isYou),
      chips: p.chips ?? resolved.startingChips,
      bet: 0,
      cards: [],
      status: 'betting', // betting -> playing -> standing/bust/blackjack
      result: null, // win | loss | push | bust | blackjack
      payout: 0,
    })),
    results: null,
  };
}

/** Unknown ids are a rejection, not a crash — the server takes player ids
 *  straight off the wire, so this is the first thing a bad actor can lie about. */
function player(state: BlackjackState, id: string): Player {
  const found = state.players.find((p) => p.id === id);
  if (!found) throw new Error(`No such player: ${id}`);
  return found;
}

function draw(state: BlackjackState): Card {
  if (state.deck.length === 0) {
    // Mid-hand reshoe: a fresh 52 would duplicate cards already on the table,
    // so rebuild the shoe minus everything currently in play.
    const inPlay = new Set(
      [...state.dealer.cards, ...state.players.flatMap((p) => p.cards)].map((c) => c.rank + c.suit),
    );
    state.deck = shuffle(freshDeck().filter((c) => !inPlay.has(c.rank + c.suit)));
  }
  const card = state.deck.pop();
  // Only reachable if all 52 cards are simultaneously in play, which needs more
  // seats than maxPlayers allows. Loud beats a silent undefined.
  if (!card) throw new Error('Shoe exhausted: every card is already in play.');
  return card;
}

function placeBet(state: BlackjackState, playerId: string, amount: number): BlackjackState {
  if (state.phase !== 'betting') throw new Error('Betting is closed.');
  const p = player(state, playerId);
  // `amount > chips` alone lets through everything that isn't a positive
  // integer: -500 passes the check, is skipped by deal() (bet > 0) so the seat
  // gets no cards, then still settles in resolve() — minting chips from a hand
  // that was never played. NaN slips through the same gap and poisons the stack
  // permanently, since every later arithmetic op stays NaN.
  if (!Number.isInteger(amount)) throw new Error('Bet must be a whole number of chips.');
  if (amount < 0) throw new Error('Bet cannot be negative.');
  if (amount > p.chips) throw new Error('Not enough chips.');
  p.bet = amount;
  return state;
}

// Everyone who bet gets two cards; dealer gets one up, one down.
function deal(state: BlackjackState): BlackjackState {
  const seated = state.players.filter((p) => p.bet > 0);
  if (seated.length === 0) throw new Error('No bets placed.');

  for (const p of seated) {
    p.chips -= p.bet;
    p.cards = [draw(state), draw(state)];
    p.status = 'playing';
    p.result = null;
    p.payout = 0;
  }
  state.dealer = { cards: [draw(state), draw(state)], revealed: false };
  state.phase = 'playing';

  for (const p of seated) if (isBlackjack(p.cards)) p.status = 'blackjack';

  state.turn = nextTurn(state);
  if (state.turn === null) return playDealer(state);
  return state;
}

const nextTurn = (state: BlackjackState): string | null =>
  state.players.find((p) => p.status === 'playing')?.id ?? null;

function legalMoves(state: BlackjackState, playerId: string): Move[] {
  if (state.phase === 'betting') return ['bet'];
  if (state.phase !== 'playing' || state.turn !== playerId) return [];
  const p = player(state, playerId);
  if (p.status !== 'playing') return [];

  const moves: Move[] = ['hit', 'stand'];
  // Double: first decision only, and you must be able to cover the bet.
  if (p.cards.length === 2 && p.chips >= p.bet) moves.push('double');
  // Split is dimmed in v1 (PRD §5.3) — the shape is here for when it lands.
  return moves;
}

function hit(state: BlackjackState, playerId: string): BlackjackState {
  const p = player(state, playerId);
  p.cards.push(draw(state));
  if (isBust(p.cards)) {
    p.status = 'bust';
    advance(state);
  }
  return state;
}

function stand(state: BlackjackState, playerId: string): BlackjackState {
  player(state, playerId).status = 'standing';
  advance(state);
  return state;
}

// Double: one card, double the bet, turn ends either way.
function double(state: BlackjackState, playerId: string): BlackjackState {
  const p = player(state, playerId);
  p.chips -= p.bet;
  p.bet *= 2;
  p.cards.push(draw(state));
  p.status = isBust(p.cards) ? 'bust' : 'standing';
  advance(state);
  return state;
}

function advance(state: BlackjackState): void {
  state.turn = nextTurn(state);
  if (state.turn === null) playDealer(state);
}

// Dealer draws to 16, stands on all 17s — including soft 17.
function playDealer(state: BlackjackState): BlackjackState {
  state.phase = 'dealer';
  state.dealer.revealed = true;

  // If every player already busted, the dealer doesn't need to draw.
  const contested = state.players.some((p) => p.status === 'standing' || p.status === 'blackjack');
  if (contested) {
    while (handValue(state.dealer.cards).total < DEALER_STANDS_ON) {
      state.dealer.cards.push(draw(state));
    }
  }
  return resolve(state);
}

function resolve(state: BlackjackState): BlackjackState {
  const dealerTotal = handValue(state.dealer.cards).total;
  const dealerBust = dealerTotal > 21;
  const dealerBJ = isBlackjack(state.dealer.cards);

  for (const p of state.players) {
    // Matches the `bet > 0` filter deal() and results use. Testing `=== 0`
    // instead let a non-positive bet settle for chips while staying absent
    // from the results the client renders.
    if (p.bet <= 0) continue;
    const total = handValue(p.cards).total;

    if (p.status === 'bust') {
      p.result = 'bust';
      p.payout = -p.bet;
    } else if (p.status === 'blackjack' && !dealerBJ) {
      p.result = 'blackjack';
      p.payout = Math.round(p.bet * BLACKJACK_PAYOUT);
      p.chips += p.bet + p.payout;
    } else if (dealerBJ && p.status !== 'blackjack') {
      p.result = 'loss';
      p.payout = -p.bet;
    } else if (dealerBJ && p.status === 'blackjack') {
      p.result = 'push';
      p.payout = 0;
      p.chips += p.bet;
    } else if (dealerBust || total > dealerTotal) {
      p.result = 'win';
      p.payout = p.bet;
      p.chips += p.bet * 2;
    } else if (total === dealerTotal) {
      p.result = 'push';
      p.payout = 0;
      p.chips += p.bet;
    } else {
      p.result = 'loss';
      p.payout = -p.bet;
    }
  }

  state.phase = 'resolved';
  state.turn = null;
  state.results = state.players
    .filter((p) => p.bet > 0)
    .map((p) => ({ id: p.id, result: p.result, payout: p.payout, chips: p.chips }));
  return state;
}

// Fresh hand, same seats and chip stacks.
function nextHand(state: BlackjackState): BlackjackState {
  state.phase = 'betting';
  state.dealer = { cards: [], revealed: false };
  state.turn = null;
  state.results = null;
  for (const p of state.players) {
    p.bet = 0;
    p.cards = [];
    p.status = 'betting';
    p.result = null;
    p.payout = 0;
  }
  if (state.deck.length < 20) state.deck = shuffle(freshDeck());
  return state;
}

/**
 * The only way to change a hand — and the action half of the anti-cheat
 * boundary (PRD §6).
 *
 * `legalMoves()` describes what a seat may do; until now nothing *enforced* it,
 * because the Phase 1 client was the only caller and its UI was the gate. A
 * server takes these straight off a socket, so every rule the UI used to imply
 * is checked here: act out of turn, act on a settled hand, double a stack you
 * can't cover, or deal twice, and the move is refused rather than applied.
 */
function apply(state: BlackjackState, playerId: string, move: Move, arg?: number): BlackjackState {
  switch (move) {
    case 'bet':
      if (typeof arg !== 'number') throw new Error('bet requires an amount.');
      return placeBet(state, playerId, arg);

    case 'deal':
      // Guards the re-deal that would charge every stake a second time.
      if (state.phase !== 'betting') throw new Error('The hand is already dealt.');
      return deal(state);

    case 'nextHand':
      if (state.phase !== 'resolved') throw new Error('The hand is still in play.');
      return nextHand(state);

    case 'hit':
    case 'stand':
    case 'double': {
      const legal = legalMoves(state, playerId);
      if (!legal.includes(move)) {
        // One message for every refusal: a rejected move must not reveal
        // whether it failed on turn order, phase, or affordability.
        throw new Error(`Illegal move '${move}' for ${playerId}.`);
      }
      if (move === 'hit') return hit(state, playerId);
      if (move === 'stand') return stand(state, playerId);
      return double(state, playerId);
    }

    default:
      throw new Error(`Unknown move: ${String(move)}`);
  }
}

/**
 * The information half of the anti-cheat boundary (PRD §6). Everything a client
 * receives goes through here: the deck is dropped and the dealer's hole card is
 * nulled until reveal.
 *
 * `ClientView` types `deck` as `never`, so returning the deck is a compile
 * error. That guarantee is real but narrow — `dealer.total` is an ordinary
 * number, and a full total on a face-down hand leaks the hole card just as
 * completely as the card would. The compiler cannot express that; the tests
 * pin it instead.
 *
 * Every array and object is rebuilt rather than spread through. A shallow copy
 * hands the caller live references into authoritative state — harmless while
 * the only consumer is JSON on its way to a socket, but a write primitive into
 * the running game the moment anything in-process keeps a view (the Stage B
 * bots will).
 */
function view(state: BlackjackState, playerId: string): ClientView {
  const { deck: _deck, ...rest } = state;
  const copyCard = (card: Card): Card => ({ ...card });
  return {
    // Key order matches the Phase 1 engine so a serialised view is
    // byte-identical — snapshot and golden-file comparisons stay meaningful
    // across the port. Overriding an existing key keeps its original position.
    ...rest,
    settings: { ...state.settings },
    results: state.results?.map((r) => ({ ...r })) ?? null,
    deckCount: state.deck.length,
    dealer: {
      ...state.dealer,
      cards: state.dealer.revealed
        ? state.dealer.cards.map(copyCard)
        : state.dealer.cards.map((card, i) => (i === 0 ? copyCard(card) : null)),
      total: state.dealer.revealed
        ? handValue(state.dealer.cards).total
        : state.dealer.cards.length
          ? handValue(state.dealer.cards.slice(0, 1)).total
          : 0,
    },
    players: state.players.map((p) => ({
      ...p,
      cards: p.cards.map(copyCard),
      total: handValue(p.cards).total,
      soft: handValue(p.cards).soft,
    })),
    you: playerId,
  };
}

const blackjack = {
  id: 'blackjack',
  name: 'Blackjack',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createState,
  legalMoves,
  apply,
  isHandOver: (state: BlackjackState): boolean => state.phase === 'resolved',
  resolve,
  view,
  handValue,
};

// Compile-time proof that this fits the shared registry interface, so a game
// that drifts from the shape the room lifecycle expects breaks here rather than
// at the call site. Assigned via a variable rather than `satisfies` on the
// literal: excess-property checking would reject `resolve` and `handValue`,
// which callers legitimately use — the registry only needs the common surface.
const _registryShape: GameEngine<BlackjackState, Move> = blackjack;
void _registryShape;

export default blackjack;
