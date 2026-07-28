// Network layer — the client half of the authoritative server (PRD §6, §7).
//
// The Phase 1 build ran the whole game locally. This replaces that with a
// Colyseus connection: the server owns the deck, the turn order, and the chips;
// the client sends intents (bet/hit/stand/double) and re-renders whatever state
// the server pushes back. The redacted state that arrives here has no deck and
// no hole card — those never leave the server.

import { Client } from './vendor/colyseus.mjs';

/**
 * Where the Colyseus server lives. Resolution order:
 *   1. window.AMYGDALA_SERVER — set by app/config.js (edit that for production).
 *   2. localhost during local dev → ws://localhost:2567.
 *   3. otherwise null → the UI shows a "server not configured" message.
 */
export function serverUrl() {
  if (typeof window !== 'undefined' && window.AMYGDALA_SERVER) return window.AMYGDALA_SERVER;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'ws://localhost:2567';
  return null;
}

/** Room names match the game ids the server registered (app.config.ts). */
const ROOMS = { blackjack: 'blackjack', rummy: 'rummy' };

/** A dealer/player card as it arrives: a face-down hole card has empty fields —
 *  render it as a card back (null), never as a blank card. */
const cardOrBack = (c) =>
  c.faceDown || !c.rank ? null : { rank: c.rank, suit: c.suit, glyph: c.glyph, fill: c.fill };

/**
 * Reshape the synced Schema into the view-shaped object the render functions
 * already expect (players carry precomputed totals; the dealer is redacted).
 * `myId` is this client's sessionId — the seat the UI calls "you".
 */
export function adapt(s, myId) {
  const players = [];
  s.players.forEach((p, id) => {
    players.push({
      id,
      nickname: p.nickname,
      isYou: id === myId,
      isBot: p.isBot,
      connected: p.connected,
      chips: p.chips,
      bet: p.bet,
      status: p.status,
      result: p.result || null,
      payout: p.payout,
      total: p.total,
      soft: p.soft,
      cards: [...p.cards].map(cardOrBack),
    });
  });
  return {
    phase: s.phase,
    turn: s.turn || null,
    deckCount: s.deckCount,
    deadline: s.deadline,
    settings: { startingChips: s.settings.startingChips, tableSpeed: s.settings.tableSpeed },
    dealer: {
      revealed: s.dealer.revealed,
      total: s.dealer.total,
      cards: [...s.dealer.cards].map(cardOrBack),
    },
    results: s.results ? [...s.results].map((r) => ({ id: r.id, result: r.result, payout: r.payout, chips: r.chips })) : null,
    players,
  };
}

/**
 * Reshape the synced Rummy state for rendering. Note what ISN'T here: nobody
 * else's cards, because the server never sends them — an opponent is a count.
 * Your own hand arrives separately, via the private `hand` message.
 */
export function adaptRummy(s, myId) {
  const players = [];
  s.players.forEach((p, id) => {
    players.push({
      id,
      nickname: p.nickname,
      isYou: id === myId,
      isBot: p.isBot,
      connected: p.connected,
      chips: p.chips,
      handCount: p.handCount,
      result: p.result || null,
      deadwood: p.deadwood,
      payout: p.payout,
    });
  });
  return {
    game: 'rummy',
    phase: s.phase,
    turn: s.turn || null,
    turnPhase: s.turnPhase,
    deadline: s.deadline,
    stockCount: s.stockCount,
    discardCount: s.discardCount,
    discardTop: s.hasDiscardTop ? { ...s.discardTop } : null,
    melds: [...s.melds].map((m) => ({
      id: m.id,
      ownerId: m.ownerId,
      kind: m.kind,
      cards: [...m.cards].map((c) => ({ rank: c.rank, suit: c.suit, glyph: c.glyph, fill: c.fill })),
    })),
    settings: { startingChips: s.settings.startingChips, tableSpeed: s.settings.tableSpeed },
    results: s.results ? [...s.results].map((r) => ({ id: r.id, result: r.result, payout: r.payout, chips: r.chips })) : null,
    players,
  };
}

export class Net {
  constructor() {
    this.client = null;
    this.room = null;
    this.myId = null;
    this.game = 'blackjack';
    this.onState = () => {};
    this.onLeave = () => {};
    /** Rummy only: your own cards, which never ride in the shared state. */
    this.onHand = () => {};
  }

  get roomCode() {
    return this.room?.roomId ?? null;
  }

  /** Create a new table (host) or join an existing one by its code. Resolves
   *  once connected; the first state arrives via onState right after. */
  async connect({ create, code, game = 'blackjack', nickname, startingChips, tableSpeed, maxPlayers }) {
    const url = serverUrl();
    if (!url) throw new Error('NO_SERVER');
    this.client = new Client(url);
    const options = { nickname, startingChips, tableSpeed, maxPlayers };
    this.game = game;

    // Joining by code doesn't say which game the room runs — the room itself
    // knows, and the state it sends back identifies it.
    this.room = create
      ? await this.client.create(ROOMS[game] ?? ROOMS.blackjack, options)
      : await this.client.joinById(code, options);
    this.myId = this.room.sessionId;
    if (!create) this.game = this.room.name ?? game;

    const shape = (state) =>
      this.game === 'rummy' ? adaptRummy(state, this.myId) : adapt(state, this.myId);
    this.room.onStateChange((state) => this.onState(shape(state)));
    this.room.onMessage('hand', (payload) => this.onHand(payload?.cards ?? []));
    this.room.onLeave((codeNum) => this.onLeave(codeNum));
    return this.roomCode;
  }

  send(type, payload) {
    this.room?.send(type, payload);
  }

  async leave() {
    try {
      await this.room?.leave(true);
    } catch {
      /* already gone */
    }
    this.room = null;
    this.client = null;
  }
}
