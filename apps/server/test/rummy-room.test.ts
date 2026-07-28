// RummyRoom integration tests — real server config, real clients over the
// loopback transport. The headline guarantee is structural: the broadcast
// schema has NO field for a hand, so an opponent's cards cannot arrive at the
// wrong client through the sync layer at all. Own cards arrive as a targeted
// "hand" message.

import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type ColyseusTestServer } from '@colyseus/testing';

import appConfig from '../src/app.config.ts';

type AnyClient = Omit<Awaited<ReturnType<ColyseusTestServer['sdk']['joinOrCreate']>>, 'state'> & {
  state: any;
};

let colyseus: ColyseusTestServer;
const open: AnyClient[] = [];

before(async () => {
  colyseus = await boot(appConfig, 2569);
});
after(async () => {
  await colyseus.shutdown();
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.leave(true).catch(() => {})));
  await new Promise((r) => setTimeout(r, 50));
});

function track<T extends AnyClient>(c: T): T {
  open.push(c);
  return c;
}

function waitFor(client: AnyClient, pred: (s: any) => boolean, label: string, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      try {
        return pred(client.state);
      } catch {
        return false;
      }
    };
    if (done()) return resolve();
    const timer = setTimeout(() => reject(new Error(`timeout waiting for: ${label}`)), ms);
    client.onStateChange(() => {
      if (done()) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/** Resolve with the next "hand" message this client receives. */
function nextHandMessage(client: AnyClient, ms = 8000): Promise<{ cards: any[] }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for hand message')), ms);
    (client as any).onMessage('hand', (payload: { cards: any[] }) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** True once BOTH humans are in the synced player map — waiting on
 *  players.size races the pre-reform hand (human + bot is also size 2). */
const bothIn = (a: AnyClient, b: AnyClient) => (s: any) =>
  Boolean(s.players?.get(a.sessionId) && s.players?.get(b.sessionId));

const opts = (nickname: string, maxPlayers = 6) => ({
  nickname,
  startingChips: 1000,
  tableSpeed: 'fast',
  maxPlayers,
});

test('a lone visitor gets bot company and their own cards by private message', async () => {
  const c = track(await colyseus.sdk.create('rummy', opts('solo')));
  const hand = nextHandMessage(c);
  await waitFor(c, (s) => s.players?.size === 3, 'three seats');
  const room: any = colyseus.getRoomById(c.roomId);

  const bots = [...room.state.players.values()].filter((p: any) => p.isBot);
  assert.equal(bots.length, 2, 'a solo human should get two bot table-mates');

  const mine = await hand;
  assert.equal(mine.cards.length, 7, '3 seats deal 7 cards each');
  assert.equal(room.state.players.get(c.sessionId).handCount, 7);
  assert.equal(room.state.stockCount, 52 - 21 - 1);
  assert.equal(room.state.hasDiscardTop, true);
});

test('STRUCTURAL: the broadcast schema carries no hand, for anyone', async () => {
  const c1 = track(await colyseus.sdk.create('rummy', opts('alice', 2)));
  const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob', 2)));
  await Promise.all([c1, c2].map((c) => waitFor(c, bothIn(c1, c2), 'both seated')));

  for (const c of [c1, c2]) {
    const wire = c.state.toJSON();
    for (const [id, p] of Object.entries<any>(wire.players)) {
      assert.ok(!('hand' in p), `player ${id} has a hand field in the broadcast`);
      assert.ok(!('cards' in p), `player ${id} has a cards field in the broadcast`);
      assert.equal(typeof p.handCount, 'number', 'the count is the only hand fact shared');
    }
  }
});

test('each client receives only its own cards, and they are disjoint', async () => {
  const c1 = track(await colyseus.sdk.create('rummy', opts('alice', 2)));
  const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob', 2)));
  await Promise.all([c1, c2].map((c) => waitFor(c, bothIn(c1, c2), 'seated')));

  // Listen AFTER the join-reform settled, then have the room resend both
  // hands so the two listeners are looking at the same deal.
  const h1p = nextHandMessage(c1);
  const h2p = nextHandMessage(c2);
  const room: any = colyseus.getRoomById(c1.roomId);
  room.sendAllHands();
  const [h1, h2] = await Promise.all([h1p, h2p]);
  assert.equal(h1.cards.length, 10, 'two seats deal 10 each');
  assert.equal(h2.cards.length, 10);
  const k1 = new Set(h1.cards.map((x: any) => x.rank + x.suit));
  for (const card of h2.cards) {
    assert.ok(!k1.has(card.rank + card.suit), 'the same card reached two hands');
  }
});

test('a rigged hand plays to resolution over the wire: melds, results, chips', async () => {
  const c1 = track(await colyseus.sdk.create('rummy', opts('alice', 2)));
  const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob', 2)));
  await Promise.all([c1, c2].map((c) => waitFor(c, bothIn(c1, c2), 'seated')));
  const room: any = colyseus.getRoomById(c1.roomId);

  // Rig the authoritative engine to a near-win for whoever is on turn.
  const eng = room.engine;
  const onTurn = eng.turn;
  const winner = [c1, c2].find((c) => c.sessionId === onTurn)!;
  const glyph: any = { S: '♠', H: '♡', D: '♢', C: '♣' };
  const card = (rank: string, suit: string) => ({ rank, suit, glyph: glyph[suit], fill: suit === 'S' || suit === 'C' ? 'solid' : 'outline' });
  const winnerSeat = eng.players.find((p: any) => p.id === onTurn);
  const loserSeat = eng.players.find((p: any) => p.id !== onTurn);
  winnerSeat.hand = [card('9', 'S'), card('9', 'H'), card('9', 'D')];
  loserSeat.hand = [card('K', 'S'), card('7', 'H')]; // deadwood 17
  eng.stock = [card('9', 'C')];
  eng.discard = [card('J', 'H')];
  eng.turnPhase = 'draw';
  room.sendAllHands();
  room.sync();

  winner.send('draw', { source: 'stock' });
  await waitFor(winner, (s) => s.turnPhase === 'act', 'drew');
  winner.send('meld', { cards: ['9S', '9H', '9D', '9C'] }); // out by meld
  await Promise.all([c1, c2].map((c) => waitFor(c, (s) => s.phase === 'resolved', 'resolved')));

  assert.equal(room.state.melds.length, 1);
  assert.equal(room.state.melds[0].cards.length, 4, 'the winning meld is public');
  assert.equal(room.state.players.get(winner.sessionId).result, 'win');
  assert.equal(room.state.players.get(winner.sessionId).chips, 1017);
  assert.equal(room.state.players.get(loserSeat.id).chips, 983);
  assert.equal(room.state.results.length, 2);
  // Roster persisted the outcome for the next hand.
  assert.equal(room.roster.get(winner.sessionId).chips, 1017);
});

test('out-of-turn and off-phase moves are ignored, state untouched', async () => {
  const c1 = track(await colyseus.sdk.create('rummy', opts('alice', 2)));
  const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob', 2)));
  await Promise.all([c1, c2].map((c) => waitFor(c, bothIn(c1, c2), 'seated')));
  const room: any = colyseus.getRoomById(c1.roomId);

  const offTurn = [c1, c2].find((c) => c.sessionId !== room.engine.turn)!;
  const before = JSON.stringify(room.state.toJSON());
  offTurn.send('draw', { source: 'stock' });
  offTurn.send('discard', { card: 'KS' });
  offTurn.send('meld', { cards: ['9S', '9H', '9D'] });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(JSON.stringify(room.state.toJSON()), before, 'an off-turn move changed the table');
});

test('a discard hands the turn across in the synced state', async () => {
  const c1 = track(await colyseus.sdk.create('rummy', opts('alice', 2)));
  const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob', 2)));
  await Promise.all([c1, c2].map((c) => waitFor(c, bothIn(c1, c2), 'seated')));
  const room: any = colyseus.getRoomById(c1.roomId);

  const onTurn = [c1, c2].find((c) => c.sessionId === room.engine.turn)!;
  const other = [c1, c2].find((c) => c !== onTurn)!;
  const handP = nextHandMessage(onTurn);
  onTurn.send('draw', { source: 'stock' });
  await waitFor(onTurn, (s) => s.turnPhase === 'act', 'acting');
  const hand = await handP;
  onTurn.send('discard', { card: hand.cards[0].rank + hand.cards[0].suit });
  await waitFor(other, (s) => s.turn === other.sessionId, 'turn passed');
  assert.equal(room.state.turnPhase, 'draw');
  assert.ok(room.state.deadline > Date.now(), 'the new turn has a visible clock');
});

test('RED: a forced turn that cannot progress ends the hand instead of blowing the stack', async () => {
  // The wedge: forceTurn made no progress → called runTurn() → the seat was
  // still disconnected → forceTurn again → infinite recursion, "Maximum call
  // stack size exceeded", room process down. Now it abandons the hand.
  const c1 = track(await colyseus.sdk.create('rummy', opts('alice', 2)));
  const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob', 2)));
  await Promise.all([c1, c2].map((c) => waitFor(c, bothIn(c1, c2), 'seated')));
  const room: any = colyseus.getRoomById(c1.roomId);

  const seatId = room.engine.turn;
  room.roster.get(seatId).connected = false; // a dropped human on turn
  // Rig a position with no legal draw at all, so the bot policy's every move
  // is refused by the engine.
  room.engine.stock = [];
  room.engine.discard = [];

  const chipsBefore = room.engine.players.reduce((n: number, p: any) => n + p.chips, 0);
  room.forceTurn(seatId); // must return, not recurse
  assert.equal(room.engine.phase, 'resolved', 'a stuck hand should end, not hang');
  assert.ok(
    room.engine.players.every((p: any) => p.result === 'push'),
    'an abandoned hand pays nobody',
  );
  assert.equal(
    room.engine.players.reduce((n: number, p: any) => n + p.chips, 0),
    chipsBefore,
    'abandoning a hand must not move chips',
  );
});
