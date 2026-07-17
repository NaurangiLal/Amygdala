// Blackjack rules engine (PRD §5.3).
// Pure functions over a state object — no DOM, no network. This module is written
// to move to the Colyseus server untouched (PRD §7); the browser prototype just
// happens to call it locally for now.

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// Suit rule (PRD §5.6): spades/clubs render solid, hearts/diamonds outlined.
const SUITS = [
  { id: 'S', glyph: '♠', fill: 'solid' },
  { id: 'H', glyph: '♡', fill: 'outline' },
  { id: 'D', glyph: '♢', fill: 'outline' },
  { id: 'C', glyph: '♣', fill: 'solid' },
];

const BLACKJACK_PAYOUT = 1.5;
const DEALER_STANDS_ON = 17;

function freshDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit: suit.id, glyph: suit.glyph, fill: suit.fill });
  }
  return deck;
}

// Fisher-Yates. On the server this is the only place cards get ordered, and the
// result never leaves it.
function shuffle(deck) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Aces count 11 until that would bust, then 1. Returns the best total plus
// whether an ace is still counting as 11 (a "soft" hand).
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces++;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
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

const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
const isBust = (cards) => handValue(cards).total > 21;

function createState(players, settings = {}) {
  return {
    game: 'blackjack',
    phase: 'betting', // betting -> playing -> dealer -> resolved
    deck: shuffle(freshDeck()), // server-only, never sent to a client
    dealer: { cards: [], revealed: false },
    turn: null,
    settings: { startingChips: 1000, tableSpeed: 'normal', ...settings },
    players: players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isYou: Boolean(p.isYou),
      chips: p.chips ?? settings.startingChips ?? 1000,
      bet: 0,
      cards: [],
      status: 'betting', // betting -> playing -> standing/bust/blackjack
      result: null, // win | loss | push | bust | blackjack
      payout: 0,
    })),
    results: null,
  };
}

const player = (state, id) => state.players.find((p) => p.id === id);
const draw = (state) => {
  if (state.deck.length === 0) {
    // Mid-hand reshoe: a fresh 52 would duplicate cards already on the table,
    // so rebuild the shoe minus everything currently in play.
    const inPlay = new Set(
      [...state.dealer.cards, ...state.players.flatMap((p) => p.cards)]
        .map((c) => c.rank + c.suit),
    );
    state.deck = shuffle(freshDeck().filter((c) => !inPlay.has(c.rank + c.suit)));
  }
  return state.deck.pop();
};

function placeBet(state, playerId, amount) {
  const p = player(state, playerId);
  if (state.phase !== 'betting') throw new Error('Betting is closed.');
  if (amount > p.chips) throw new Error('Not enough chips.');
  p.bet = amount;
  return state;
}

// Everyone who bet gets two cards; dealer gets one up, one down.
function deal(state) {
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

const nextTurn = (state) => state.players.find((p) => p.status === 'playing')?.id ?? null;

function legalMoves(state, playerId) {
  if (state.phase === 'betting') return ['bet'];
  if (state.phase !== 'playing' || state.turn !== playerId) return [];
  const p = player(state, playerId);
  if (p.status !== 'playing') return [];

  const moves = ['hit', 'stand'];
  // Double: first decision only, and you must be able to cover the bet.
  if (p.cards.length === 2 && p.chips >= p.bet) moves.push('double');
  // Split is dimmed in v1 (PRD §5.3) — the shape is here for when it lands.
  return moves;
}

function hit(state, playerId) {
  const p = player(state, playerId);
  p.cards.push(draw(state));
  if (isBust(p.cards)) {
    p.status = 'bust';
    advance(state);
  }
  return state;
}

function stand(state, playerId) {
  player(state, playerId).status = 'standing';
  advance(state);
  return state;
}

// Double: one card, double the bet, turn ends either way.
function double(state, playerId) {
  const p = player(state, playerId);
  p.chips -= p.bet;
  p.bet *= 2;
  p.cards.push(draw(state));
  p.status = isBust(p.cards) ? 'bust' : 'standing';
  advance(state);
  return state;
}

function advance(state) {
  state.turn = nextTurn(state);
  if (state.turn === null) playDealer(state);
}

// Dealer draws to 16, stands on all 17s — including soft 17.
function playDealer(state) {
  state.phase = 'dealer';
  state.dealer.revealed = true;

  // If every player already busted, the dealer doesn't need to draw.
  const contested = state.players.some((p) => ['standing', 'blackjack'].includes(p.status));
  if (contested) {
    while (handValue(state.dealer.cards).total < DEALER_STANDS_ON) {
      state.dealer.cards.push(draw(state));
    }
  }
  return resolve(state);
}

function resolve(state) {
  const dealerTotal = handValue(state.dealer.cards).total;
  const dealerBust = dealerTotal > 21;
  const dealerBJ = isBlackjack(state.dealer.cards);

  for (const p of state.players) {
    if (p.bet === 0) continue;
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
function nextHand(state) {
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

function apply(state, playerId, move, arg) {
  switch (move) {
    case 'bet': return placeBet(state, playerId, arg);
    case 'deal': return deal(state);
    case 'hit': return hit(state, playerId);
    case 'stand': return stand(state, playerId);
    case 'double': return double(state, playerId);
    case 'nextHand': return nextHand(state);
    default: throw new Error(`Unknown move: ${move}`);
  }
}

// The anti-cheat boundary (PRD §6). Everything a client receives goes through here:
// the deck is dropped, and the dealer's hole card is nulled until it's revealed.
function view(state, playerId) {
  return {
    ...state,
    deck: undefined,
    deckCount: state.deck.length,
    dealer: {
      ...state.dealer,
      cards: state.dealer.revealed
        ? state.dealer.cards
        : state.dealer.cards.map((card, i) => (i === 0 ? card : null)),
      total: state.dealer.revealed
        ? handValue(state.dealer.cards).total
        : state.dealer.cards.length
          ? handValue(state.dealer.cards.slice(0, 1)).total
          : 0,
    },
    players: state.players.map((p) => ({ ...p, total: handValue(p.cards).total, soft: handValue(p.cards).soft })),
    you: playerId,
  };
}

export default {
  id: 'blackjack',
  name: 'Blackjack',
  minPlayers: 1,
  maxPlayers: 6,
  createState,
  legalMoves,
  apply,
  isHandOver: (state) => state.phase === 'resolved',
  resolve,
  view,
  handValue,
};
