// The authoritative Blackjack room.
//
// The engine (Stage A) decides what is legal; this room decides *when* things
// happen — whose turn, how long they have, when bots act, when the next hand
// begins. The engine is a private POJO field; after every mutation the room
// projects a redacted copy into the synced Schema, so the deck and hole card
// never leave this process (PRD §6).
//
// The room owns a persistent roster (seats + chip stacks that outlive a hand).
// Each hand is built fresh from the roster via engine.createState, so players
// can join or leave between hands without the pure engine needing any notion of
// a mutable table.

import { Room, type Client, CloseCode } from '@colyseus/core';
import blackjack from '@amygdala/game-rules/blackjack';
import type { BlackjackState as EngineState, Move } from '@amygdala/game-rules/types';

import { BlackjackState } from '../schema/BlackjackState.ts';
import { project, type SeatMeta } from '../schema/project.ts';
import { botBet, botMove, makeBots } from '../bots.ts';

interface RosterSeat {
  id: string;
  nickname: string;
  isBot: boolean;
  connected: boolean;
  chips: number;
}

interface Speed {
  betting: number;
  turn: number;
}
// Seconds. Bots act inside these windows so a hand never waits on them.
const SPEED: Record<string, Speed> = {
  slow: { betting: 25, turn: 30 },
  normal: { betting: 15, turn: 20 },
  fast: { betting: 8, turn: 10 },
};

const DESIRED_SEATS = 3; // a table that feels populated for a lone visitor
const MAX_SEATS = 6; // engine hard cap
const MIN_CHIPS = 5; // below the smallest chip = broke (blackjack pays ×1.5, so stacks drift)
const RESULT_LINGER = 4; // seconds a resolved hand stays up before the next deal
const RECONNECT_WINDOW = 30; // seconds a dropped human keeps their seat

export interface JoinOptions {
  nickname?: string;
  startingChips?: number;
  tableSpeed?: string;
  maxPlayers?: number;
}

export class BlackjackRoom extends Room<{ state: BlackjackState }> {
  private engine: EngineState | null = null;
  private roster = new Map<string, RosterSeat>();
  private startingChips = 1000;
  private tableSpeed = 'normal';
  // A single pending scheduled action (bot move, timer expiry, next hand). The
  // room is a strict state machine — at most one timer is armed at a time — so
  // one handle is enough and there's never a race between two.
  // Every armed clock timeout, tracked so a phase change can cancel all of them
  // at once. During betting this holds the close timer AND each bot's bet timer;
  // during a turn it holds one timer. Leaving any of them armed across a phase
  // change is how stale bot moves and double-deals creep in.
  private timers = new Set<{ clear: () => void }>();
  // Epoch-ms expiry of the visible timer, 0 when none; published so clients can
  // render a countdown without a per-second patch.
  private deadline = 0;
  // Deterministic-ish RNG the tests can seed; Math.random in production.
  private rng: () => number = Math.random;

  override onCreate(options: JoinOptions): void {
    this.startingChips = clampChips(options.startingChips);
    this.tableSpeed = SPEED[options.tableSpeed ?? ''] ? options.tableSpeed! : 'normal';
    this.maxClients = clampSeats(options.maxPlayers);

    this.setState(new BlackjackState());
    this.state.settings.startingChips = this.startingChips;
    this.state.settings.tableSpeed = this.tableSpeed;

    this.onMessage('bet', (client, amount: number) => this.onBet(client, amount));
    this.onMessage('hit', (client) => this.onMove(client, 'hit'));
    this.onMessage('stand', (client) => this.onMove(client, 'stand'));
    this.onMessage('double', (client) => this.onMove(client, 'double'));
  }

  override onJoin(client: Client, options: JoinOptions): void {
    this.roster.set(client.sessionId, {
      id: client.sessionId,
      nickname: sanitizeNickname(options.nickname) || 'player',
      isBot: false,
      connected: true,
      chips: this.startingChips,
    });
    // The hand can be (re)formed as long as nobody is committed yet: an idle or
    // just-finished table, or a betting round where no chips are down. That way
    // a group arriving together within the betting window all sit at the same
    // hand and the bots step aside for them. Once a bet is placed or cards are
    // out, a newcomer waits for the next hand.
    const canReform =
      this.engine === null ||
      this.engine.phase === 'resolved' ||
      (this.engine.phase === 'betting' && this.engine.players.every((p) => p.bet === 0));
    if (canReform) {
      this.openBetting();
    } else {
      this.sync();
    }
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const seat = this.roster.get(client.sessionId);
    if (!seat) return;
    seat.connected = false;
    // A disconnected seat sits out (openBetting only seats connected humans), so
    // it can't be force-bet while away. But if it was THEIR turn right now, the
    // hand would otherwise wait out the full turn clock — advance it so the
    // table doesn't freeze on someone who's gone.
    if (this.engine?.phase === 'playing' && this.engine.turn === client.sessionId) {
      this.autoStand(client.sessionId);
    } else {
      this.sync();
    }

    // A consented leave (the player closed the tab on purpose) frees the seat
    // immediately. Colyseus signals it with CloseCode.CONSENTED (4000) — NOT
    // 1000; getting this backwards holds every clean departure for the full
    // reconnection window. Any other drop — flaky wifi, a redeploy cutting every
    // socket — gets a grace window to reclaim the same seat and chips (PRD §6).
    const consented = code === CloseCode.CONSENTED;
    if (!consented) {
      try {
        await this.allowReconnection(client, RECONNECT_WINDOW);
        const back = this.roster.get(client.sessionId);
        if (back) back.connected = true;
        // Resume a table that paused itself while they were the only human.
        if (this.engine === null || this.engine.phase === 'resolved') this.openBetting();
        else this.sync();
        return;
      } catch {
        // window elapsed — fall through and free the seat
      }
    }
    this.roster.delete(client.sessionId);
    if (this.connectedHumans() === 0) {
      // Nobody real is left; stop the loop so the room can dispose rather than
      // deal bot-only hands forever.
      this.clearPending();
    }
    this.sync();
  }

  // --- betting -------------------------------------------------------------

  private openBetting(): void {
    this.clearPending();
    // Pause rather than deal to an empty house: a table with no connected human
    // stops until one arrives or reconnects (onLeave/onJoin resume it). This is
    // what stops bot-only hands looping while a dropped player is under grace.
    if (this.connectedHumans() === 0) {
      this.engine = null;
      return;
    }
    this.reconcileBots();
    // Seat only players who can actually act: connected humans and bots. A
    // disconnected human keeps their roster seat and chips but sits this hand
    // out, so the betting sweep can never force-bet someone who isn't there.
    const active = [...this.roster.values()].filter((s) => s.isBot || s.connected);
    // Rebuy anyone broke among those being dealt in.
    for (const s of active) if (s.chips < MIN_CHIPS) s.chips = this.startingChips;
    const seats = active.map((s) => ({ id: s.id, nickname: s.nickname, chips: s.chips }));
    this.engine = blackjack.createState(seats, {
      startingChips: this.startingChips,
      tableSpeed: this.tableSpeed as EngineState['settings']['tableSpeed'],
    });

    // Arm the close timer first — arm() clears all timers, so scheduling the
    // bots before it would wipe them.
    this.arm(SPEED[this.tableSpeed]!.betting, () => this.closeBetting());
    this.scheduleBotBets();
    this.sync();
  }

  private onBet(client: Client, amount: number): void {
    if (!this.engine || this.engine.phase !== 'betting') return;
    if (!this.roster.get(client.sessionId)) return;
    try {
      blackjack.apply(this.engine, client.sessionId, 'bet', Math.trunc(amount));
    } catch {
      return; // engine refused (closed, unaffordable, malformed) — ignore
    }
    this.sync();
    this.maybeCloseBetting();
  }

  private scheduleBotBets(): void {
    // Each bot commits within the betting window, staggered so the table reads
    // as live rather than instant.
    for (const seat of this.roster.values()) {
      if (!seat.isBot) continue;
      const delay = 0.8 + this.rng() * 2.2;
      this.schedule(delay, () => {
        if (!this.engine || this.engine.phase !== 'betting') return;
        const p = this.engine.players.find((x) => x.id === seat.id);
        if (!p || p.bet > 0) return;
        try {
          blackjack.apply(this.engine, seat.id, 'bet', botBet(p.chips, this.rng));
        } catch {
          return;
        }
        this.sync();
        this.maybeCloseBetting();
      });
    }
  }

  private maybeCloseBetting(): void {
    if (!this.engine || this.engine.phase !== 'betting') return;
    if (this.engine.players.every((p) => p.bet > 0)) this.closeBetting();
  }

  private closeBetting(): void {
    this.clearPending();
    if (!this.engine || this.engine.phase !== 'betting') return;

    // Sweep in idle connected humans with a minimum affordable bet so one
    // undecided player can't stall the table.
    for (const p of this.engine.players) {
      if (p.bet > 0) continue;
      const seat = this.roster.get(p.id);
      // Bots had their own window; a disconnected seat must never be force-bet
      // (openBetting shouldn't have seated it, but defend the money path here).
      if (seat?.isBot || !seat?.connected) continue;
      const amount = p.chips >= 25 ? 25 : MIN_CHIPS;
      if (p.chips >= amount) {
        try {
          blackjack.apply(this.engine, p.id, 'bet', amount);
        } catch {
          /* leave them out */
        }
      }
    }

    if (!this.engine.players.some((p) => p.bet > 0)) {
      // Nobody staked anything (a lone human who sat out, no bots). Re-open.
      this.openBetting();
      return;
    }
    blackjack.apply(this.engine, this.engine.players[0]!.id, 'deal');
    this.syncChipsToRoster();
    this.sync();
    this.runTurn();
  }

  // --- play ----------------------------------------------------------------

  private onMove(client: Client, move: Move): void {
    if (!this.engine || this.engine.phase !== 'playing') return;
    try {
      blackjack.apply(this.engine, client.sessionId, move);
    } catch {
      return; // out of turn, illegal, or unaffordable — the engine is the judge
    }
    this.clearPending();
    this.sync();
    this.runTurn();
  }

  private runTurn(): void {
    if (!this.engine) return;
    if (this.engine.phase === 'resolved') {
      this.onResolved();
      return;
    }
    const turn = this.engine.turn;
    if (!turn) return;
    const seat = this.roster.get(turn);

    if (seat?.isBot) {
      const delay = 0.7 + this.rng() * 1.3;
      this.arm(delay, () => this.playBot(turn), false);
    } else if (seat && !seat.connected) {
      // The turn reached a seat whose player is gone (dropped before it was
      // their turn). Don't hold the table on them — stand at once, same as when
      // someone drops while already on turn. If they reconnect before their turn
      // comes, `connected` is true here and they get the normal clock instead.
      this.autoStand(turn);
    } else {
      this.arm(SPEED[this.tableSpeed]!.turn, () => this.autoStand(turn));
    }
    this.sync();
  }

  private playBot(botId: string): void {
    if (!this.engine || this.engine.phase !== 'playing' || this.engine.turn !== botId) return;
    const move = botMove(this.engine, botId);
    if (move) {
      try {
        blackjack.apply(this.engine, botId, move);
      } catch {
        /* fall through to advance */
      }
    }
    this.sync();
    this.runTurn();
  }

  private autoStand(turnId: string): void {
    if (!this.engine || this.engine.phase !== 'playing' || this.engine.turn !== turnId) return;
    try {
      blackjack.apply(this.engine, turnId, 'stand');
    } catch {
      /* ignore */
    }
    this.sync();
    this.runTurn();
  }

  private onResolved(): void {
    this.clearPending();
    this.syncChipsToRoster();
    this.sync();
    // Linger on the result, then deal the next hand automatically so the table
    // keeps playing without a host.
    this.arm(RESULT_LINGER, () => this.openBetting(), false);
  }

  // --- roster & bots -------------------------------------------------------

  private reconcileBots(): void {
    // Fill toward a lively table, bounded by the engine's seat cap. Based on
    // *connected* humans, so a disconnected seat under grace doesn't crowd bots
    // out — and connectedHumans + bots can never exceed MAX_SEATS.
    const humans = this.connectedHumans();
    // Never fill past the room's own player cap — a "2 player" table means
    // two seats total, not two humans plus bots.
    const cap = Math.min(MAX_SEATS, this.maxClients) - humans;
    const wantBots = Math.max(0, Math.min(DESIRED_SEATS - humans, cap));
    const currentBots = [...this.roster.values()].filter((s) => s.isBot);

    // Trim surplus bots (humans arrived).
    for (let i = currentBots.length - 1; i >= wantBots; i--) {
      this.roster.delete(currentBots[i]!.id);
    }
    // Add bots up to the target, drawing ids not already at the table.
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

  /** Humans currently able to act. A disconnected seat under the reconnection
   *  grace still occupies the roster but doesn't count — the table pauses for
   *  them rather than playing (and spending) on their behalf. */
  private connectedHumans(): number {
    let n = 0;
    for (const s of this.roster.values()) if (!s.isBot && s.connected) n++;
    return n;
  }

  private syncChipsToRoster(): void {
    if (!this.engine) return;
    for (const p of this.engine.players) {
      const seat = this.roster.get(p.id);
      if (seat) seat.chips = p.chips;
    }
  }

  // --- timers & projection -------------------------------------------------

  /** Arm the single visible phase timer (betting clock, turn clock, result
   *  linger, next-hand). Cancels every outstanding timer first — a phase change
   *  invalidates them all — and publishes an epoch-ms expiry when `showDeadline`
   *  so clients can render a countdown. */
  private arm(seconds: number, fn: () => void, showDeadline = true): void {
    this.clearPending();
    this.deadline = showDeadline ? Date.now() + seconds * 1000 : 0;
    this.schedule(seconds, () => {
      this.deadline = 0;
      fn();
    });
  }

  /** Register a clock timeout in the tracking set so clearPending() can cancel
   *  it. Used for the phase timer and for each bot's staggered action. */
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

  /** The single write path to the synced state: project the engine into the
   *  Schema. Nothing else mutates this.state. */
  private sync(): void {
    if (!this.engine) return;
    project(this.state, this.engine, (id) => this.meta(id), this.deadline);
  }

  private meta(id: string): SeatMeta {
    const seat = this.roster.get(id);
    return { isBot: seat?.isBot ?? false, connected: seat?.connected ?? false };
  }
}

// --- option hygiene: room options arrive off the wire ----------------------

function clampChips(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 1000;
  return Math.max(100, Math.min(100_000, n));
}
function clampSeats(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : MAX_SEATS;
  return Math.max(1, Math.min(MAX_SEATS, n));
}
function sanitizeNickname(v: unknown): string {
  if (typeof v !== 'string') return '';
  // Drop angle brackets and control characters (the client escapes too —
  // defence in depth); collapse whitespace; cap the length. Letters, digits,
  // hyphens, and underscores all survive, so "player_2" stays intact.
  let out = '';
  for (const ch of v.replace(/[<>]/g, '')) {
    if (ch.charCodeAt(0) >= 32) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 20);
}
