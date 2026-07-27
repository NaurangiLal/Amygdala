// Integration tests — the real proof of Stage B.
//
// These boot the actual server config, connect real clients over the loopback
// transport, and play a hand end to end. They assert the guarantees a hostile
// client would try to break: the deck never arrives, the hole card stays hidden
// until reveal, and a move out of turn is refused by the server rather than the
// UI.

import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type ColyseusTestServer } from '@colyseus/testing';

import appConfig from '../src/app.config.ts';

// One server for the whole file. Booting per test races on the port (rapid
// boot/shutdown cycles reset the connection); booting once and creating a fresh
// room per test gives both isolation and a stable transport.
let colyseus: ColyseusTestServer;
const open: AnyClient[] = [];

before(async () => {
  colyseus = await boot(appConfig);
});
after(async () => {
  await colyseus.shutdown();
});
afterEach(async () => {
  // Disconnect every client so its room disposes before the next test, and no
  // stray reconnection timer outlives the test that armed it.
  await Promise.all(open.splice(0).map((c) => c.leave(true).catch(() => {})));
  await new Promise((r) => setTimeout(r, 50));
});

/** Track a client so afterEach tears it down. */
function track<T extends AnyClient>(c: T): T {
  open.push(c);
  return c;
}

// --- helpers ---------------------------------------------------------------

// The SDK can't infer our decorator-free schema, so it types room state as
// `unknown`. In a test that just reads synced fields, `any` state is the honest
// shape to work with — the assertions are the real type check.
type AnyClient = Omit<Awaited<ReturnType<ColyseusTestServer['sdk']['joinOrCreate']>>, 'state'> & {
  state: any;
};

/** Resolve once the client's synced state satisfies `pred`, or reject on
 *  timeout. Checks immediately and on every patch, so it can't miss a change
 *  that already landed. */
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

const START = 1000;
const opts = (nickname: string) => ({ nickname, startingChips: START, tableSpeed: 'fast', maxPlayers: 6 });

/** Three human clients in one fresh room (DESIRED_SEATS is 3, so no bots join).
 *  `create` guarantees a new room, isolating each test from the last. */
async function threeAtATable(): Promise<AnyClient[]> {
  const c1 = track(await colyseus.sdk.create('blackjack', opts('alice')));
  const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob')));
  const c3 = track(await colyseus.sdk.joinById(c1.roomId, opts('carol')));
  const clients = [c1, c2, c3];
  await Promise.all(clients.map((c) => waitFor(c, (s) => s.players?.size === 3, 'three seats')));
  return clients;
}

// --- tests -----------------------------------------------------------------

test('a lone visitor is seated at a full table of bots', async () => {
    const c = track(await colyseus.sdk.create('blackjack', opts('solo')));
    await waitFor(c, (s) => s.players?.size === 3, 'table filled to three');
    const room: any = colyseus.getRoomById(c.roomId);
    const bots = [...room.state.players.values()].filter((p: any) => p.isBot);
    assert.equal(bots.length, 2, 'a solo human should get two bot table-mates');
    assert.equal(room.state.phase, 'betting', 'the hand should open on its own');
});

test('three clients play a full hand to resolution', async () => {
    const clients = await threeAtATable();
    const room: any = colyseus.getRoomById(clients[0]!.roomId);

    // Everyone bets; the room deals once all three are in.
    for (const c of clients) c.send('bet', 100);
    await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'playing', 'hand dealt')));

    // Drive turns: whoever is on turn stands, until the hand resolves. A guard
    // bounds the loop so a stuck turn fails the test instead of hanging.
    for (let step = 0; step < 30 && room.state.phase === 'playing'; step++) {
      const turnId = room.state.turn;
      const actor = clients.find((c) => c.sessionId === turnId);
      if (actor) {
        actor.send('stand');
        await waitFor(actor, (s) => s.turn !== turnId || s.phase !== 'playing', 'turn advances');
      } else {
        break;
      }
    }

    await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'resolved', 'hand resolved')));
    assert.equal(room.state.results.length, 3, 'every seat should have a result');
    for (const c of clients) {
      const me = c.state.players.get(c.sessionId);
      assert.ok(me, 'each client can find its own seat by sessionId');
      assert.ok(['win', 'loss', 'push', 'bust', 'blackjack'].includes(me.result), 'a real outcome');
    }
});

test('the deck never crosses the wire', async () => {
    const clients = await threeAtATable();
    for (const c of clients) c.send('bet', 100);
    await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'playing', 'dealt')));

    for (const c of clients) {
      const wire = JSON.stringify(c.state.toJSON());
      assert.ok(!wire.includes('"deck"'), 'deck present in a client payload');
      assert.ok(c.state.deckCount > 0, 'the count is shared even though the cards are not');
    }
});

test("the dealer's hole card stays hidden until the hand resolves", async () => {
    const clients = await threeAtATable();
    const c = clients[0]!;
    for (const cl of clients) cl.send('bet', 100);
    await waitFor(c, (s) => s.phase === 'playing', 'dealt');

    // Mid-hand: two dealer cards, the second face-down with no rank/suit.
    const dealer = c.state.dealer;
    assert.equal(dealer.cards.length, 2);
    assert.equal(dealer.cards[0].faceDown, false, 'the upcard must be visible');
    assert.equal(dealer.cards[1].faceDown, true, 'the hole card must be face-down');
    assert.equal(dealer.cards[1].rank, '', 'the hole card rank leaked to the client');
    assert.equal(dealer.cards[1].suit, '', 'the hole card suit leaked to the client');
    // The whole payload must not contain the hidden card — check the upcard's
    // presence proves cards DO serialize, so an empty hole card is real hiding.
    assert.ok(dealer.cards[0].rank !== '', 'sanity: the upcard serializes normally');

    // Play out; once resolved the hole card must be revealed.
    const room: any = colyseus.getRoomById(c.roomId);
    for (let step = 0; step < 30 && room.state.phase === 'playing'; step++) {
      const actor = clients.find((cl) => cl.sessionId === room.state.turn);
      if (!actor) break;
      const turnId = room.state.turn;
      actor.send('stand');
      await waitFor(actor, (s) => s.turn !== turnId || s.phase !== 'playing', 'advance');
    }
    await waitFor(c, (s) => s.phase === 'resolved', 'resolved');
    assert.equal(c.state.dealer.revealed, true, 'dealer should be revealed at resolution');
    for (const card of c.state.dealer.cards) {
      assert.equal(card.faceDown, false, 'a dealer card stayed face-down after reveal');
      assert.ok(card.rank !== '', 'a revealed dealer card has no rank');
    }
});

test('a move out of turn is refused by the server', async () => {
    const clients = await threeAtATable();
    const room: any = colyseus.getRoomById(clients[0]!.roomId);
    for (const c of clients) c.send('bet', 100);
    await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'playing', 'dealt')));

    const onTurn = clients.find((c) => c.sessionId === room.state.turn)!;
    const offTurn = clients.find((c) => c.sessionId !== room.state.turn)!;
    const before = offTurn.state.players.get(offTurn.sessionId)!.cards.length;
    const beforeStatus = offTurn.state.players.get(offTurn.sessionId)!.status;

    // The off-turn client tries to hit. The server must ignore it.
    offTurn.send('hit');
    // Give the server a beat to (not) process it.
    await new Promise((r) => setTimeout(r, 300));

    const seat = room.state.players.get(offTurn.sessionId);
    assert.equal(seat.cards.length, before, 'an out-of-turn hit dealt a card');
    assert.equal(seat.status, beforeStatus, 'an out-of-turn move changed the seat');
    assert.equal(room.state.turn, onTurn.sessionId, 'the turn moved off the player whose turn it was');
});

test('an unaffordable bet is refused; a legal one sticks', async () => {
    const clients = await threeAtATable();
    const room: any = colyseus.getRoomById(clients[0]!.roomId);
    const c = clients[0]!;

    c.send('bet', 999_999); // more than the stack
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(room.state.players.get(c.sessionId).bet, 0, 'an unaffordable bet was accepted');

    c.send('bet', 100);
    await waitFor(c, (s) => s.players.get(c.sessionId).bet === 100, 'legal bet registers');
});

// --- state-machine coverage (the paths Red found untested) -----------------

/** Bet, then stand every seat in turn until the hand resolves. */
async function playToResolution(clients: AnyClient[], room: any): Promise<void> {
  for (const c of clients) c.send('bet', 100);
  await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'playing', 'dealt')));
  for (let step = 0; step < 40 && room.state.phase === 'playing'; step++) {
    const turnId = room.state.turn;
    const actor = clients.find((c) => c.sessionId === turnId);
    if (!actor) break;
    actor.send('stand');
    await waitFor(actor, (s) => s.turn !== turnId || s.phase !== 'playing', 'advance');
  }
  await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'resolved', 'resolved')));
}

test('chips persist across hands rather than resetting each deal', async () => {
    const clients = await threeAtATable();
    const room: any = colyseus.getRoomById(clients[0]!.roomId);

    await playToResolution(clients, room);
    // Snapshot every seat's chips at the end of hand one.
    const afterHand1 = new Map<string, number>();
    for (const c of clients) afterHand1.set(c.sessionId, room.roster.get(c.sessionId).chips);
    // Someone must have won or lost — otherwise this test proves nothing.
    assert.ok([...afterHand1.values()].some((v) => v !== START), 'no chips moved; test is vacuous');

    // Next hand opens after the linger; seats must be seeded from those stacks,
    // not reset to the starting chips.
    await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'betting', 'next hand', 9000)));
    for (const c of clients) {
      const seatChips = room.engine.players.find((p: any) => p.id === c.sessionId).chips;
      assert.equal(seatChips, afterHand1.get(c.sessionId), 'a stack reset between hands');
    }
});

test('the table advances when the player on turn leaves', async () => {
    const clients = await threeAtATable();
    const room: any = colyseus.getRoomById(clients[0]!.roomId);
    for (const c of clients) c.send('bet', 100);
    await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'playing', 'dealt')));

    const turnId = room.state.turn;
    const leaver = clients.find((c) => c.sessionId === turnId)!;
    // The player whose turn it is closes the tab. The hand must not freeze for
    // the full turn clock — the turn advances (or the hand resolves) at once.
    await leaver.leave(true);
    open.splice(open.indexOf(leaver), 1); // afterEach shouldn't double-leave it
    await new Promise((r) => setTimeout(r, 400));
    assert.notEqual(room.state.turn, turnId, 'the turn stayed on a player who left');
});

test('the table advances when the on-turn player drops without consent', async () => {
    // The grace path (leave(false)) — distinct from the consented leave above.
    // A dropped-but-held seat on turn must still advance, not wait out the clock.
    const clients = await threeAtATable();
    const room: any = colyseus.getRoomById(clients[0]!.roomId);
    for (const c of clients) c.send('bet', 100);
    await Promise.all(clients.map((c) => waitFor(c, (s) => s.phase === 'playing', 'dealt')));

    const turnId = room.state.turn;
    const leaver = clients.find((c) => c.sessionId === turnId)!;
    await leaver.leave(false); // non-consented — seat held under grace
    open.splice(open.indexOf(leaver), 1);
    await new Promise((r) => setTimeout(r, 500));
    assert.notEqual(room.state.turn, turnId, 'a non-consented on-turn drop froze the table');
    // The dropped seat is marked away but still present (held under grace).
    assert.equal(room.roster.get(turnId)?.connected, false, 'the seat should be held, not freed');
});

test('a disconnected seat is not force-bet while it is away', async () => {
    // Two humans so the table keeps playing after one drops.
    const c1 = track(await colyseus.sdk.create('blackjack', opts('alice')));
    const c2 = track(await colyseus.sdk.joinById(c1.roomId, opts('bob')));
    await Promise.all([c1, c2].map((c) => waitFor(c, (s) => s.players?.size >= 2, 'seated')));
    const room: any = colyseus.getRoomById(c1.roomId);
    const aliceId = c1.sessionId;
    const before = room.roster.get(aliceId).chips;

    // Alice drops without consent — the server holds her seat under grace.
    await c1.leave(false);
    open.splice(open.indexOf(c1), 1);
    await waitFor(c2, () => room.roster.get(aliceId)?.connected === false, 'alice marked away');

    // Let a full betting round elapse (fast betting is 8s) so the sweep would
    // have force-bet her if it still ignored connection state.
    await new Promise((r) => setTimeout(r, 9000));
    assert.equal(room.roster.get(aliceId)?.chips, before, "an away player's chips were spent");
    // And she is not dealt into the hand that's now running.
    const inHand = room.engine?.players.find((p: any) => p.id === aliceId);
    assert.ok(!inHand || inHand.bet === 0, 'an away player was dealt into a hand');
});
