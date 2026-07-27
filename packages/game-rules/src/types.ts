// Shared vocabulary for every card game. The server runs the engines; the
// client imports these types so the two can't quietly disagree about the shape
// of a hand (PRD §7 — the reason TypeScript was chosen).

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type SuitId = 'S' | 'H' | 'D' | 'C';

/** Monochrome palette can't use colour to separate suits, so the glyph carries
 *  it: spades/clubs solid, hearts/diamonds outlined (PRD §5.6). */
export type SuitFill = 'solid' | 'outline';

export interface Card {
  rank: Rank;
  suit: SuitId;
  glyph: string;
  fill: SuitFill;
}

export interface HandValue {
  total: number;
  /** An ace is still counting as 11 — the hand can take a card without busting. */
  soft: boolean;
}

export type GamePhase = 'betting' | 'playing' | 'dealer' | 'resolved';
export type PlayerStatus = 'betting' | 'playing' | 'standing' | 'bust' | 'blackjack';
export type HandResult = 'win' | 'loss' | 'push' | 'bust' | 'blackjack';
export type Move = 'bet' | 'deal' | 'hit' | 'stand' | 'double' | 'nextHand';

export interface RoomSettings {
  startingChips: number;
  tableSpeed: 'slow' | 'normal' | 'fast';
}

export interface Player {
  id: string;
  nickname: string;
  /** True for the local player in the Phase 1 prototype. The server identifies
   *  seats by id instead, so this is presentation-only and never a rules input. */
  isYou: boolean;
  chips: number;
  bet: number;
  cards: Card[];
  status: PlayerStatus;
  result: HandResult | null;
  payout: number;
}

export interface Dealer {
  cards: Card[];
  revealed: boolean;
}

export interface HandOutcome {
  id: string;
  result: HandResult | null;
  payout: number;
  chips: number;
}

/**
 * Authoritative state. Lives only on the server — `deck` is the reason.
 * Never send this to a client; send `view(state, playerId)` instead.
 */
export interface BlackjackState {
  game: 'blackjack';
  phase: GamePhase;
  deck: Card[];
  dealer: Dealer;
  turn: string | null;
  settings: RoomSettings;
  players: Player[];
  results: HandOutcome[] | null;
}

/** A player as the client sees them — hand totals precomputed for rendering. */
export interface ClientPlayer extends Player {
  total: number;
  soft: boolean;
}

export interface ClientDealer {
  /** The hole card reads `null` until the dealer reveals. Not "hidden by the
   *  UI" — genuinely absent from the payload, so devtools shows nothing. */
  cards: (Card | null)[];
  revealed: boolean;
  /** Upcard total while face-down; full total once revealed. */
  total: number;
}

/**
 * What actually crosses the wire (PRD §6). `deck` is typed `never` rather than
 * merely omitted so that reading it is a compile error, not an undefined —
 * the anti-cheat boundary is checked by the compiler instead of by discipline.
 */
export interface ClientView extends Omit<BlackjackState, 'deck' | 'dealer' | 'players'> {
  deck?: never;
  deckCount: number;
  dealer: ClientDealer;
  players: ClientPlayer[];
  you: string;
}

/** The interface every game plugs into, so the room lifecycle never imports a
 *  game folder directly (PRD §4). Blackjack today, Rummy in Phase 2.
 *
 *  TArg is what a move carries over the wire: a number for Blackjack (the bet),
 *  richer objects for Rummy (which cards to meld, where to lay off). Engines
 *  must treat it as untrusted — it comes straight off a socket. */
export interface GameEngine<TState, TMove extends string = string, TArg = unknown> {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  createState(players: SeatInput[], settings?: Partial<RoomSettings>): TState;
  legalMoves(state: TState, playerId: string): TMove[];
  apply(state: TState, playerId: string, move: TMove, arg?: TArg): TState;
  isHandOver(state: TState): boolean;
  view(state: TState, playerId: string): unknown;
}

/**
 * A game in the registry, before anyone knows which game it is.
 *
 * The state parameter is deliberately `any`: the catalog holds Blackjack beside
 * Rummy beside Poker, whose states have nothing in common, and the whole point
 * of the registry is that the room lifecycle looks a game up without naming it.
 * Typing the catalog to a concrete state would put every future game's type
 * into this file — exactly the coupling §4 exists to prevent. Callers narrow
 * after lookup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameEngine = GameEngine<any, any>;

export interface SeatInput {
  id: string;
  nickname: string;
  isYou?: boolean;
  chips?: number;
}

// ---------------------------------------------------------------------------
// Rummy (Phase 2, PRD §5.4) — straight rummy: draw, meld sets/runs, lay off,
// discard; first hand to empty wins the round, scored on opponents' deadwood.
// ---------------------------------------------------------------------------

/** Which half of a turn the player on turn is in: they must draw first, then
 *  may meld / lay off any number of times before ending with a discard. */
export type RummyTurnPhase = 'draw' | 'act';
export type RummyPhase = 'playing' | 'resolved';
export type RummyMove = 'draw' | 'meld' | 'layoff' | 'discard' | 'nextHand';

/** What a rummy move carries. Cards are referenced by key (`rank + suit`,
 *  e.g. "10H") — unique in a single deck, so nothing else is needed. */
export interface RummyArg {
  /** draw: where from. */
  source?: 'stock' | 'discard';
  /** meld: the 3+ hand cards being laid down. */
  cards?: string[];
  /** layoff + discard: the single hand card in question. */
  card?: string;
  /** layoff: which table meld it extends. */
  meldId?: number;
}

export interface RummyMeld {
  id: number;
  /** Who laid it down (display only — anyone may lay off onto any meld). */
  ownerId: string;
  kind: 'set' | 'run';
  cards: Card[];
}

export interface RummyPlayer {
  id: string;
  nickname: string;
  isYou: boolean;
  chips: number;
  hand: Card[];
  result: 'win' | 'loss' | 'push' | null;
  /** Deadwood points left when the hand ended; the winner's is 0. */
  deadwood: number;
  payout: number;
}

/** Authoritative rummy state. `stock` and every `hand` but your own are the
 *  secrets — view() strips them (PRD §6). */
export interface RummyState {
  game: 'rummy';
  phase: RummyPhase;
  turn: string | null;
  turnPhase: RummyTurnPhase;
  /** Card taken from the discard this turn — it may not be discarded straight
   *  back (the classic anti-stall rule), unless it is the last card in hand. */
  tookFromDiscard: string | null;
  /** Did the player on turn meld or lay off this turn? Feeds the dead-pile
   *  counter below. */
  turnProgress: boolean;
  /** Consecutive turns that ended with an exhausted stock and no meld/lay-off.
   *  A full round of them (one per seat) means nobody can or will advance the
   *  hand — it resolves as a stalemate rather than looping forever. */
  dryTurns: number;
  stock: Card[];
  discard: Card[];
  melds: RummyMeld[];
  nextMeldId: number;
  /** Rotates by one seat each hand so first-draw advantage moves around. */
  handNumber: number;
  settings: RoomSettings;
  players: RummyPlayer[];
  results: HandOutcome[] | null;
}

/** A rummy player as an OPPONENT sees them: hand reduced to a count. */
export interface ClientRummyPlayer extends Omit<RummyPlayer, 'hand'> {
  handCount: number;
  /** Full cards only for the viewer's own seat; empty for everyone else. */
  hand: Card[];
}

export interface ClientRummyView extends Omit<RummyState, 'stock' | 'players'> {
  stock?: never;
  stockCount: number;
  players: ClientRummyPlayer[];
  you: string;
}

/** Dog narration, stored as data so it stays editable and localizable (PRD §5.5). */
export type DogState =
  | 'idle'
  | 'explaining'
  | 'prompting'
  | 'thinking'
  | 'reacting_win'
  | 'reacting_loss'
  | 'reacting_neutral'
  | 'celebrating';

export interface DogLine {
  state: DogState;
  lines: string[];
}
