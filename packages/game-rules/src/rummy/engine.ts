// Straight Rummy rules engine (PRD §5.4, Phase 2).
// Pure functions over a state object — no DOM, no network, no framework. Same
// contract as the Blackjack engine: apply() is the gate (every rule enforced
// here, because moves arrive off a socket), view() is the redaction boundary
// (opponents' hands and the stock never cross the wire).
//
// The variant, pinned down so the tests mean something:
// - Single 52-card deck, ace LOW (A-2-3 is a run, Q-K-A is not).
// - Deal: 10 cards each for 2 players, 7 for 3-4, 6 for 5-6. One card is
//   flipped to start the discard pile; the rest is the stock.
// - A turn is draw (stock or discard top) → any number of melds/lay-offs →
//   one discard, which passes the turn. The card taken from the discard pile
//   may not be discarded straight back the same turn (anti-stall).
// - Melds: sets of 3-4 of a rank (distinct suits), runs of 3+ consecutive in
//   one suit. Lay-offs extend ANY meld on the table, yours or not.
// - Going out: the moment your hand is empty — by discard, meld, or lay-off —
//   the hand ends and you win.
// - Scoring: losers each lose their deadwood (A=1, pips face value, courts
//   10); the winner gains the sum of all of it. Chips are the running score.
// - An empty stock recycles the discard pile (all but its top card),
//   reshuffled. When there's nothing to recycle either, stock draws are
//   refused (the discard draw still stands) — a stalemate can never be
//   *chosen* by a player who'd rather void the hand than pay their deadwood.
// - Stalemate happens only when the table proves it's stuck: a full round of
//   turns with the stock exhausted and nobody melding or laying off. Then
//   everyone pushes and chips stay put.

import type {
  Card,
  ClientRummyView,
  GameEngine,
  Rank,
  RoomSettings,
  RummyArg,
  RummyMeld,
  RummyMove,
  RummyPlayer,
  RummyState,
  SeatInput,
  SuitFill,
  SuitId,
} from '../types.ts';

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: { id: SuitId; glyph: string; fill: SuitFill }[] = [
  { id: 'S', glyph: '♠', fill: 'solid' },
  { id: 'H', glyph: '♡', fill: 'outline' },
  { id: 'D', glyph: '♢', fill: 'outline' },
  { id: 'C', glyph: '♣', fill: 'solid' },
];

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/** rank order for runs — ace low, no wrap-around. */
const order = (rank: Rank): number => RANKS.indexOf(rank);

/** Deadwood value of one card: ace 1, pips face value, courts 10. */
export function cardValue(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return Number(card.rank);
}

export const cardKey = (card: Card): string => card.rank + card.suit;

export function deadwood(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + cardValue(c), 0);
}

/** 3-4 cards, one rank, no repeated suit (a single deck can't repeat one, but
 *  the move arg comes off a socket — validate, don't assume). */
export function isValidSet(cards: Card[]): boolean {
  if (cards.length < 3 || cards.length > 4) return false;
  const rank = cards[0]!.rank;
  if (!cards.every((c) => c.rank === rank)) return false;
  return new Set(cards.map((c) => c.suit)).size === cards.length;
}

/** 3+ cards, one suit, consecutive ranks (ace low). Order given doesn't
 *  matter — the meld is stored sorted. */
export function isValidRun(cards: Card[]): boolean {
  if (cards.length < 3) return false;
  const suit = cards[0]!.suit;
  if (!cards.every((c) => c.suit === suit)) return false;
  const idx = cards.map((c) => order(c.rank)).sort((a, b) => a - b);
  return idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
}

export function isValidMeld(cards: Card[]): 'set' | 'run' | null {
  if (isValidSet(cards)) return 'set';
  if (isValidRun(cards)) return 'run';
  return null;
}

/** Would this meld still be valid with `card` added? (The lay-off test.) */
export function canLayOff(meld: RummyMeld, card: Card): boolean {
  // Exported for client-side pre-checks, so it must not crash on garbage.
  if (meld.cards.length === 0) return false;
  if (meld.kind === 'set') {
    return (
      meld.cards.length < 4 &&
      card.rank === meld.cards[0]!.rank &&
      !meld.cards.some((c) => c.suit === card.suit)
    );
  }
  // run: must extend one end by exactly one rank, same suit
  if (card.suit !== meld.cards[0]!.suit) return false;
  const idx = meld.cards.map((c) => order(c.rank)).sort((a, b) => a - b);
  const v = order(card.rank);
  return v === idx[0]! - 1 || v === idx[idx.length - 1]! + 1;
}

function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit: suit.id, glyph: suit.glyph, fill: suit.fill });
  }
  return deck;
}

function shuffle(deck: Card[]): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const HAND_SIZE = (seats: number): number => (seats === 2 ? 10 : seats <= 4 ? 7 : 6);

function player(state: RummyState, id: string): RummyPlayer {
  const found = state.players.find((p) => p.id === id);
  if (!found) throw new Error(`No such player: ${id}`);
  return found;
}

/** Take named cards out of a hand, or throw if any is missing — a move that
 *  references a card you don't hold must fail atomically, changing nothing. */
function takeFromHand(p: RummyPlayer, keys: string[]): Card[] {
  const taken: Card[] = [];
  const hand = [...p.hand];
  for (const key of keys) {
    const i = hand.findIndex((c) => cardKey(c) === key);
    if (i === -1) throw new Error(`Card ${key} is not in your hand.`);
    taken.push(hand.splice(i, 1)[0]!);
  }
  p.hand = hand;
  return taken;
}

function createState(seats: SeatInput[], settings: Partial<RoomSettings> = {}): RummyState {
  const resolved: RoomSettings = {
    startingChips: settings.startingChips ?? 1000,
    tableSpeed: settings.tableSpeed ?? 'normal',
  };
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    throw new Error(`Rummy seats ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${seats.length}.`);
  }
  if (new Set(seats.map((s) => s.id)).size !== seats.length) {
    throw new Error('Duplicate player id at the table.');
  }

  const state: RummyState = {
    game: 'rummy',
    phase: 'playing',
    turn: null,
    turnPhase: 'draw',
    tookFromDiscard: null,
    turnProgress: false,
    dryTurns: 0,
    stock: [],
    discard: [],
    melds: [],
    nextMeldId: 1,
    handNumber: 0,
    settings: resolved,
    players: seats.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isYou: Boolean(p.isYou),
      chips: p.chips ?? resolved.startingChips,
      hand: [],
      result: null,
      deadwood: 0,
      payout: 0,
    })),
    results: null,
  };
  dealHand(state);
  return state;
}

/** Deal (or re-deal) a hand into an existing table. */
function dealHand(state: RummyState): void {
  const deck = shuffle(freshDeck());
  const size = HAND_SIZE(state.players.length);
  for (const p of state.players) {
    p.hand = deck.splice(0, size);
    p.result = null;
    p.deadwood = 0;
    p.payout = 0;
  }
  state.discard = deck.splice(0, 1);
  state.stock = deck;
  state.melds = [];
  state.nextMeldId = 1;
  state.phase = 'playing';
  state.turnPhase = 'draw';
  state.tookFromDiscard = null;
  state.turnProgress = false;
  state.dryTurns = 0;
  state.results = null;
  // First draw rotates each hand so the advantage moves around the table.
  state.turn = state.players[state.handNumber % state.players.length]!.id;
}

function requireTurn(state: RummyState, playerId: string, phase: RummyState['turnPhase']): RummyPlayer {
  if (state.phase !== 'playing') throw new Error('The hand is over.');
  if (state.turn !== playerId) throw new Error(`Illegal move for ${playerId}.`);
  if (state.turnPhase !== phase) throw new Error(`Illegal move for ${playerId}.`);
  return player(state, playerId);
}

function draw(state: RummyState, playerId: string, arg?: RummyArg): RummyState {
  const p = requireTurn(state, playerId, 'draw');
  const source = arg?.source;
  if (source !== 'stock' && source !== 'discard') throw new Error('draw needs a source.');

  if (source === 'discard') {
    const top = state.discard.pop();
    if (!top) throw new Error('The discard pile is empty.');
    p.hand.push(top);
    state.tookFromDiscard = cardKey(top);
  } else {
    if (state.stock.length === 0) {
      // Recycle everything under the discard's top card. If there's nothing to
      // recycle either, the stock draw is REFUSED, not a stalemate — a player
      // who is losing must not be able to elect a stalemate and void the hand
      // while a legal discard draw exists. The dead-pile round counter below
      // is what actually ends an unwinnable hand.
      if (state.discard.length <= 1) {
        throw new Error('The stock is exhausted — draw from the discard.');
      }
      const top = state.discard.pop()!;
      state.stock = shuffle(state.discard);
      state.discard = [top];
    }
    p.hand.push(state.stock.pop()!);
  }
  state.turnPhase = 'act';
  return state;
}

function meld(state: RummyState, playerId: string, arg?: RummyArg): RummyState {
  const p = requireTurn(state, playerId, 'act');
  const keys = arg?.cards;
  if (!Array.isArray(keys) || keys.length < 3) throw new Error('A meld needs at least 3 cards.');
  if (new Set(keys).size !== keys.length) throw new Error('A meld cannot repeat a card.');

  // Validate BEFORE mutating the hand, so an invalid meld changes nothing.
  const cards = keys.map((key) => {
    const c = p.hand.find((x) => cardKey(x) === key);
    if (!c) throw new Error(`Card ${key} is not in your hand.`);
    return c;
  });
  const kind = isValidMeld(cards);
  if (!kind) throw new Error('Those cards are not a set or a run.');

  takeFromHand(p, keys);
  state.turnProgress = true;
  const sorted = [...cards].sort((a, b) => order(a.rank) - order(b.rank));
  state.melds.push({ id: state.nextMeldId++, ownerId: playerId, kind, cards: sorted });

  if (p.hand.length === 0) return resolve(state, playerId);
  return state;
}

function layoff(state: RummyState, playerId: string, arg?: RummyArg): RummyState {
  const p = requireTurn(state, playerId, 'act');
  if (!arg?.card || typeof arg.meldId !== 'number') throw new Error('layoff needs a card and a meld.');
  const target = state.melds.find((m) => m.id === arg.meldId);
  if (!target) throw new Error('No such meld on the table.');

  const card = p.hand.find((c) => cardKey(c) === arg.card);
  if (!card) throw new Error(`Card ${arg.card} is not in your hand.`);
  if (!canLayOff(target, card)) throw new Error('That card does not fit that meld.');

  takeFromHand(p, [arg.card]);
  state.turnProgress = true;
  target.cards = [...target.cards, card].sort((a, b) => order(a.rank) - order(b.rank));

  if (p.hand.length === 0) return resolve(state, playerId);
  return state;
}

function discard(state: RummyState, playerId: string, arg?: RummyArg): RummyState {
  const p = requireTurn(state, playerId, 'act');
  if (!arg?.card) throw new Error('discard needs a card.');
  // Anti-stall: the card taken from the pile can't go straight back — UNLESS
  // it is the whole hand. Without that escape, a player who melds down to
  // exactly the taken card has no legal move at all and the table deadlocks
  // (and discarding your last card is going out, which is always allowed).
  if (arg.card === state.tookFromDiscard && p.hand.length > 1) {
    throw new Error('You cannot discard the card you just took from the pile.');
  }
  const [card] = takeFromHand(p, [arg.card]);
  state.discard.push(card!);

  if (p.hand.length === 0) return resolve(state, playerId);

  // Dead-pile terminator: a turn that ends with the stock exhausted and no
  // meld or lay-off made is a "dry" turn. A full round of them means the
  // table is just cycling the pile — stalemate rather than an endless loop.
  if (state.stock.length === 0 && !state.turnProgress) {
    state.dryTurns++;
    if (state.dryTurns >= state.players.length) return stalemate(state);
  } else {
    state.dryTurns = 0;
  }

  // Turn passes.
  const i = state.players.findIndex((x) => x.id === playerId);
  state.turn = state.players[(i + 1) % state.players.length]!.id;
  state.turnPhase = 'draw';
  state.tookFromDiscard = null;
  state.turnProgress = false;
  return state;
}

function resolve(state: RummyState, winnerId: string): RummyState {
  let pot = 0;
  for (const p of state.players) {
    if (p.id === winnerId) continue;
    p.deadwood = deadwood(p.hand);
    p.result = 'loss';
    p.payout = -p.deadwood;
    p.chips -= p.deadwood;
    pot += p.deadwood;
  }
  const winner = player(state, winnerId);
  winner.deadwood = 0;
  winner.result = 'win';
  winner.payout = pot;
  winner.chips += pot;
  finish(state);
  return state;
}

/** Stock and discard both exhausted: nobody wins, nobody pays. */
function stalemate(state: RummyState): RummyState {
  for (const p of state.players) {
    p.deadwood = deadwood(p.hand);
    p.result = 'push';
    p.payout = 0;
  }
  finish(state);
  return state;
}

function finish(state: RummyState): void {
  state.phase = 'resolved';
  state.turn = null;
  state.tookFromDiscard = null;
  state.results = state.players.map((p) => ({
    id: p.id,
    result: p.result,
    payout: p.payout,
    chips: p.chips,
  }));
}

function nextHand(state: RummyState, playerId: string): RummyState {
  // The room auto-advances hands in practice; if a client asks directly, it
  // must at least be someone seated at this table.
  player(state, playerId);
  if (state.phase !== 'resolved') throw new Error('The hand is still in play.');
  state.handNumber++;
  dealHand(state);
  return state;
}

function legalMoves(state: RummyState, playerId: string): RummyMove[] {
  if (state.phase !== 'playing' || state.turn !== playerId) return [];
  if (state.turnPhase === 'draw') return ['draw'];
  // 'meld'/'layoff' are listed as available ACTIONS; whether a specific
  // selection is valid is apply()'s job (and the client can pre-check with the
  // exported isValidMeld/canLayOff helpers).
  return ['meld', 'layoff', 'discard'];
}

function apply(state: RummyState, playerId: string, move: RummyMove, arg?: RummyArg): RummyState {
  switch (move) {
    case 'draw': return draw(state, playerId, arg);
    case 'meld': return meld(state, playerId, arg);
    case 'layoff': return layoff(state, playerId, arg);
    case 'discard': return discard(state, playerId, arg);
    case 'nextHand': return nextHand(state, playerId);
    default: throw new Error(`Unknown move: ${String(move)}`);
  }
}

/**
 * The redaction boundary (PRD §6). Each viewer gets their own hand in full;
 * every other hand is a count; the stock is a count. Copies, not references —
 * same rule as Blackjack's view().
 */
function view(state: RummyState, playerId: string): ClientRummyView {
  const { stock: _stock, ...rest } = state;
  return {
    ...rest,
    stockCount: state.stock.length,
    discard: state.discard.map((c) => ({ ...c })),
    melds: state.melds.map((m) => ({ ...m, cards: m.cards.map((c) => ({ ...c })) })),
    settings: { ...state.settings },
    results: state.results?.map((r) => ({ ...r })) ?? null,
    players: state.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isYou: p.id === playerId,
      chips: p.chips,
      result: p.result,
      deadwood: p.deadwood,
      payout: p.payout,
      handCount: p.hand.length,
      hand: p.id === playerId ? p.hand.map((c) => ({ ...c })) : [],
    })),
    you: playerId,
  };
}

const rummy = {
  id: 'rummy',
  name: 'Rummy',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createState,
  legalMoves,
  apply,
  isHandOver: (state: RummyState): boolean => state.phase === 'resolved',
  view,
};

const _registryShape: GameEngine<RummyState, RummyMove, RummyArg> = rummy;
void _registryShape;

export default rummy;
