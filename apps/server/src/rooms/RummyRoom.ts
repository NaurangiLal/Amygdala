// The authoritative Rummy room.
//
// Same architecture as BlackjackRoom — the engine (R1) decides what is legal;
// this room decides when things happen. Same hardened lifecycle, too: the
// table only seats connected humans, pauses when none are connected, holds a
// dropped player's seat under a reconnection grace window, and never lets a
// timer outlive the phase that armed it.
//
// The one structural difference is secrecy. Blackjack has two secrets shared
// by everyone (deck, hole card); rummy hides every hand from every OTHER
// player. The broadcast schema therefore contains no hands at all — only
// counts — and each player's own cards go out as a targeted "hand" message.
// An opponent's hand can't leak through the sync layer because there is no
// field it could occupy.

import { Room, type Client, CloseCode } from '@colyseus/core';
import rummy from '@amygdala/game-rules/rummy';
import type { Card, RummyState as EngineState, RummyArg } from '@amygdala/game-rules/types';

import { RummyState } from '../schema/RummyState.ts';
import { projectRummy } from '../schema/projectRummy.ts';
import { makeBots, rummyBotMove } from '../bots.ts';

interface RosterSeat {
  id: string;
  nickname: string;
  isBot: boolean;
  connected: boolean;
  chips: number;
}

// Seconds per human turn. Rummy turns are bigger than blackjack turns (draw +
// think + discard), so the clocks run longer.
const TURN_SECONDS: Record<string, number> = { slow: 45, normal: 30, fast: 15 };

const DESIRED_SEATS = 3;
const MIN_SEATS = 2; // rummy needs an opponent — the engine refuses 1
const MAX_SEATS = 6;
const MIN_CHIPS = 5;
const RESULT_LINGER = 6; // rummy results carry more to read than blackjack's
const RECONNECT_WINDOW = 30;
/** A forced turn (timeout / disconnected seat) is played by the bot policy;
 *  this caps the loop in case of a policy/engine disagreement. */
const MAX_FORCED_STEPS = 20;

export interface JoinOptions {
  nickname?: string;
  startingChips?: number;
  tableSpeed?: string;
  maxPlayers?: number;
}

export class RummyRoom extends Room<{ state: RummyState }> {
  private engine: EngineState | null = null;
  private roster = new Map<string, RosterSeat>();
  private startingChips = 1000;
  private tableSpeed = 'normal';
  private handCounter = 0;
  // Successful engine moves this hand. A human joining while it's still 0
  // (nobody has even drawn) reforms the hand to include them, instead of
  // making them watch a hand they aren't in.
  private movesMade = 0;
  private timers = new Set<{ clear: () => void }>();
  private deadline = 0;
  private rng: () => number = Math.random;

  override onCreate(options: JoinOptions): void {
    this.startingChips = clampChips(options.startingChips);
    this.tableSpeed = TURN_SECONDS[options.tableSpeed ?? ''] ? options.tableSpeed! : 'normal';
    this.maxClients = clampSeats(options.maxPlayers);

    this.setState(new RummyState());
    this.state.settings.startingChips = this.startingChips;
    this.state.settings.tableSpeed = this.tableSpeed;

    this.onMessage('draw', (client, arg: RummyArg) => this.onMove(client, 'draw', arg));
    this.onMessage('meld', (client, arg: RummyArg) => this.onMove(client, 'meld', arg));
    this.onMessage('layoff', (client, arg: RummyArg) => this.onMove(client, 'layoff', arg));
    this.onMessage('discard', (client, arg: RummyArg) => this.onMove(client, 'discard', arg));
  }

  override onJoin(client: Client, options: JoinOptions): void {
    this.roster.set(client.sessionId, {
      id: client.sessionId,
      nickname: sanitizeNickname(options.nickname) || 'player',
      isBot: false,
      connected: true,
      chips: this.startingChips,
    });
    // A joiner waits for the next hand (rummy hands can't grow seats
    // mid-play) — unless the hand is untouched (no move made yet), in which
    // case it reforms to seat them now. Idle and finished tables start fresh.
    const fresh = this.engine !== null && this.engine.phase === 'playing' && this.movesMade === 0;
    if (this.engine === null || this.engine.phase === 'resolved' || fresh) {
      this.openHand();
    } else {
      this.sync();
    }
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const seat = this.roster.get(client.sessionId);
    if (!seat) return;
    seat.connected = false;
    // If it was their turn, the bot policy finishes it so the table never
    // waits a full clock on someone who's gone.
    if (this.engine?.phase === 'playing' && this.engine.turn === client.sessionId) {
      this.forceTurn(client.sessionId);
    } else {
      this.sync();
    }

    const consented = code === CloseCode.CONSENTED;
    if (!consented) {
      try {
        await this.allowReconnection(client, RECONNECT_WINDOW);
        const back = this.roster.get(client.sessionId);
        if (back) back.connected = true;
        if (this.engine === null || this.engine.phase === 'resolved') this.openHand();
        else {
          this.sendHand(client.sessionId);
          this.sync();
        }
        return;
      } catch {
        // window elapsed — free the seat
      }
    }
    this.roster.delete(client.sessionId);
    if (this.connectedHumans() === 0) this.clearPending();
    this.sync();
  }

  // --- hand lifecycle -------------------------------------------------------

  private openHand(): void {
    this.clearPending();
    if (this.connectedHumans() === 0) {
      this.engine = null;
      return;
    }
    this.reconcileBots();
    const active = [...this.roster.values()].filter((s) => s.isBot || s.connected);
    if (active.length < MIN_SEATS) {
      // Can't deal to one seat; wait for company (reconcileBots normally
      // guarantees company, but maxClients can pin the table small).
      this.engine = null;
      return;
    }
    for (const s of active) if (s.chips < MIN_CHIPS) s.chips = this.startingChips;

    // Rotate the seat order each hand so the first draw moves around the table.
    const rotated = [...active];
    for (let i = 0; i < this.handCounter % rotated.length; i++) rotated.push(rotated.shift()!);
    this.handCounter++;

    this.engine = rummy.createState(
      rotated.map((s) => ({ id: s.id, nickname: s.nickname, chips: s.chips })),
      { startingChips: this.startingChips, tableSpeed: this.tableSpeed as EngineState['settings']['tableSpeed'] },
    );
    this.movesMade = 0;
    this.sendAllHands();
    this.sync();
    this.runTurn();
  }

  // --- moves ----------------------------------------------------------------

  private onMove(client: Client, move: 'draw' | 'meld' | 'layoff' | 'discard', arg: RummyArg): void {
    if (!this.engine || this.engine.phase !== 'playing') return;
    if (!this.roster.get(client.sessionId)) return;
    const turnBefore = this.engine.turn;
    try {
      rummy.apply(this.engine, client.sessionId, move, sanitizeArg(arg));
    } catch {
      return; // refused — the engine is the judge
    }
    this.movesMade++;
    this.sendHand(client.sessionId);
    this.afterApply(turnBefore);
  }

  /** Shared post-move bookkeeping: resolution, turn hand-off, re-render. */
  private afterApply(turnBefore: string | null): void {
    if (!this.engine) return;
    if (this.engine.phase === 'resolved') {
      this.onResolved();
      return;
    }
    if (this.engine.turn !== turnBefore) {
      this.clearPending();
      this.runTurn();
    } else {
      this.sync();
    }
  }

  private runTurn(): void {
    if (!this.engine || this.engine.phase !== 'playing') return;
    const turn = this.engine.turn;
    if (!turn) return;
    const seat = this.roster.get(turn);

    if (seat?.isBot) {
      this.scheduleBotStep(turn);
    } else if (!seat || !seat.connected) {
      // No client behind this seat (dropped, or the roster entry is gone) —
      // nothing to wait for, so play it out rather than burn a full clock.
      this.forceTurn(turn);
      return;
    } else {
      this.arm(TURN_SECONDS[this.tableSpeed]!, () => this.forceTurn(turn));
    }
    this.sync();
  }

  /** One bot action per beat, so the table reads as someone playing. */
  private scheduleBotStep(botId: string): void {
    this.schedule(0.6 + this.rng() * 0.9, () => {
      if (!this.engine || this.engine.phase !== 'playing' || this.engine.turn !== botId) return;
      const step = rummyBotMove(this.engine, botId);
      if (!step) return;
      const turnBefore = this.engine.turn;
      try {
        rummy.apply(this.engine, botId, step.move, step.arg);
      } catch {
        // Policy/engine disagreement — never wedge the table on a bot.
        this.forceTurn(botId);
        return;
      }
      this.movesMade++;
      if (rummy.isHandOver(this.engine)) {
        this.onResolved();
        return;
      }
      if (this.engine.turn === turnBefore) this.scheduleBotStep(botId);
      else {
        this.clearPending();
        this.runTurn();
      }
      this.sync();
    });
  }

  /** Play out a whole turn with the bot policy — timeouts and absent seats. */
  private forceTurn(seatId: string): void {
    if (!this.engine || this.engine.phase !== 'playing' || this.engine.turn !== seatId) return;
    this.clearPending();
    let progressed = false;
    for (let i = 0; i < MAX_FORCED_STEPS; i++) {
      if (this.engine.phase !== 'playing' || this.engine.turn !== seatId) break;
      const step = rummyBotMove(this.engine, seatId);
      if (!step) break;
      try {
        rummy.apply(this.engine, seatId, step.move, step.arg);
      } catch {
        break; // give up rather than loop on a refusal
      }
      this.movesMade++;
      progressed = true;
    }
    this.sendHand(seatId);
    if (rummy.isHandOver(this.engine)) {
      this.onResolved();
      return;
    }
    if (!progressed && this.engine.turn === seatId) {
      // The seat on turn has no move the engine will accept, and there is no
      // client to wait for. Calling runTurn() here would route straight back
      // into forceTurn and recurse until the stack blows, taking the whole
      // room down — so end the hand instead. Nobody can continue; nobody pays.
      rummy.abandonHand(this.engine);
      this.onResolved();
      return;
    }
    this.runTurn();
  }

  private onResolved(): void {
    this.clearPending();
    if (this.engine) {
      for (const p of this.engine.players) {
        const seat = this.roster.get(p.id);
        if (seat) seat.chips = p.chips;
      }
    }
    this.sync();
    this.schedule(RESULT_LINGER, () => this.openHand());
  }

  // --- hands over the wire --------------------------------------------------

  /** A player's own cards, as a targeted message — never in the broadcast. */
  private sendHand(seatId: string): void {
    if (!this.engine) return;
    const client = this.clients.getById(seatId);
    if (!client) return;
    const seat = this.engine.players.find((p) => p.id === seatId);
    if (!seat) return;
    client.send('hand', { cards: seat.hand.map((c: Card) => ({ ...c })) });
  }

  private sendAllHands(): void {
    if (!this.engine) return;
    for (const p of this.engine.players) this.sendHand(p.id);
  }

  // --- roster & bots (same rules as BlackjackRoom) -------------------------

  private reconcileBots(): void {
    const humans = this.connectedHumans();
    // Fill toward a lively table, but never past the room's own player cap —
    // a "2 player" table means two seats total, not two humans plus bots.
    const cap = Math.min(MAX_SEATS, this.maxClients) - humans;
    const wantBots = Math.max(
      0,
      Math.min(Math.max(MIN_SEATS - humans, DESIRED_SEATS - humans), cap),
    );
    const currentBots = [...this.roster.values()].filter((s) => s.isBot);
    for (let i = currentBots.length - 1; i >= wantBots; i--) {
      this.roster.delete(currentBots[i]!.id);
    }
    let have = Math.min(currentBots.length, wantBots);
    for (const bot of makeBots(MAX_SEATS)) {
      if (have >= wantBots) break;
      if (this.roster.has(bot.id)) continue;
      this.roster.set(bot.id, {
        id: bot.id,
        nickname: bot.nickname,
        isBot: true,
        connected: true,
        chips: this.startingChips,
      });
      have++;
    }
  }

  private connectedHumans(): number {
    let n = 0;
    for (const s of this.roster.values()) if (!s.isBot && s.connected) n++;
    return n;
  }

  // --- timers & projection (identical discipline to BlackjackRoom) ---------

  private arm(seconds: number, fn: () => void): void {
    this.clearPending();
    this.deadline = Date.now() + seconds * 1000;
    this.schedule(seconds, () => {
      this.deadline = 0;
      fn();
    });
  }

  private schedule(seconds: number, fn: () => void): void {
    const handle = this.clock.setTimeout(() => {
      this.timers.delete(entry);
      fn();
    }, seconds * 1000);
    const entry = { clear: () => handle.clear() };
    this.timers.add(entry);
  }

  private clearPending(): void {
    for (const t of this.timers) t.clear();
    this.timers.clear();
    this.deadline = 0;
  }

  private sync(): void {
    if (!this.engine) return;
    projectRummy(this.state, this.engine, (id) => {
      const seat = this.roster.get(id);
      return { isBot: seat?.isBot ?? false, connected: seat?.connected ?? false };
    }, this.deadline);
  }
}

// --- option/arg hygiene: everything arrives off the wire --------------------

function clampChips(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 1000;
  return Math.max(100, Math.min(100_000, n));
}
function clampSeats(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : MAX_SEATS;
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, n));
}
function sanitizeNickname(v: unknown): string {
  if (typeof v !== 'string') return '';
  let out = '';
  for (const ch of v.replace(/[<>]/g, '')) {
    if (ch.charCodeAt(0) >= 32) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 20);
}
/** Keep only the fields a move may carry, with the types they must have —
 *  the engine validates values, this stops prototype-pollution-shaped junk. */
function sanitizeArg(v: unknown): RummyArg {
  if (typeof v !== 'object' || v === null) return {};
  const o = v as Record<string, unknown>;
  const out: RummyArg = {};
  if (o.source === 'stock' || o.source === 'discard') out.source = o.source;
  if (Array.isArray(o.cards)) out.cards = o.cards.filter((x): x is string => typeof x === 'string').slice(0, 14);
  if (typeof o.card === 'string') out.card = o.card;
  if (typeof o.meldId === 'number' && Number.isFinite(o.meldId)) out.meldId = o.meldId;
  return out;
}
