// Amygdala — game shell, wired to the authoritative Colyseus server (PRD §7).
//
// The server owns the deck, the turn order, and the chips. This client sends
// intents (bet/hit/stand/double) and re-renders whatever redacted state the
// server pushes back — it never sees the deck or the dealer's hole card. The
// pure engine is still imported, but only for client-side conveniences that
// don't touch hidden state: legalMoves (to enable/disable buttons) and
// handValue (unused now that the server sends totals), plus the dog's lines.

import { getGame } from '../game_rules/index.mjs';
import { Dog } from './dog.mjs';
import { Settings } from './settings.mjs';
import { Net } from './net.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const settings = new Settings();
settings.apply();

const blackjack = getGame('blackjack');
const dog = new Dog(blackjack.lines, settings);

// ---------------------------------------------------------------------------
// Session — what a guest is, before any account exists (PRD §5.1, §8)
// ---------------------------------------------------------------------------
const session = {
  nickname: 'guest',
  isGuest: true,
  chips: 1000,
  roomCode: null,
  maxPlayers: 4,
  startingChips: 1000,
  tableSpeed: 'normal',
  stats: { wins: 0, losses: 0, pushes: 0 },
  history: [],
};

let state = null; // latest redacted state from the server (adapted for render)
let selectedBet = 0; // chips staged locally before the bet is sent
let timer = null;

const net = new Net();
const myId = () => net.myId; // this client's seat id, or null before connecting
let lastPhase = null; // so the reactor only re-narrates on a real phase change

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const STATUS = {
  boot: ['AMYGDALA — TITLE', 'GUEST'],
  identity: ['IDENTITY', 'GUEST'],
  lobby: ['LOBBY', 'GUEST'],
  room: ['ROOM · WAITING', 'HOST'],
  betting: ['BLACKJACK · PLACE BETS', 'LIVE'],
  table: ['BLACKJACK · TABLE', 'LIVE'],
  result: ['BLACKJACK · RESULT', 'LIVE'],
  settings: ['SETTINGS', ''],
  account: ['ACCOUNT', ''],
};

// Which side the dog docks on, per screen (matches the wireframe).
const DOG_SIDE = {
  identity: 'right', lobby: 'left', betting: 'right',
  table: 'left', result: 'left', account: 'right',
};
const DOG_HIDDEN = ['boot', 'room', 'settings'];

let current = 'boot';

// Settings/account are detours, not destinations — remember where the player
// came from so BACK / Esc / the footer toggle always lead out again (no screen
// may be a dead end). The stack makes overlay→overlay hops LIFO: settings
// opened from account BACKs to account, not past it.
const OVERLAYS = ['settings', 'account'];
let overlayStack = [];

function go(screen, { fromBack = false } = {}) {
  if (OVERLAYS.includes(screen)) {
    if (!fromBack && current !== screen) overlayStack.push(current);
  } else {
    overlayStack = [];
  }
  current = screen;
  $$('.screen').forEach((el) => {
    el.toggleAttribute('data-active', el.dataset.screen === screen);
  });

  const [title, meta] = STATUS[screen] ?? ['AMYGDALA', ''];
  $('#statusTitle').textContent = title;
  $('#statusMeta').textContent = session.isGuest ? meta : meta.replace('GUEST', 'MEMBER');

  $('#dogwrap').hidden = DOG_HIDDEN.includes(screen);
  $('#dogwrap').dataset.side = DOG_SIDE[screen] ?? 'right';
  $('#dogwrap').dataset.screen = screen; // lets the dog dodge the command bar

  // Each screen narrates itself (PRD §5.5 — the dog is the voice of the whole UI).
  // Settle first so a line never outlives the screen that prompted it; game
  // screens get their line from the event that follows, not from here.
  dog.settle();
  const entry = { identity: 'identity', lobby: 'lobby', account: 'account', settings: 'settings' }[screen];
  if (entry) dog.say(entry);

  // Move focus to the new screen so keyboard users land in the right place.
  const target = $(`.screen[data-screen="${screen}"]`);
  target?.querySelector('input, button:not([disabled])')?.focus({ preventScroll: true });
}
window.__go = go; // used by screenshot.mjs --nav

$$('[data-go]').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.go)));

function goBack() {
  if (!OVERLAYS.includes(current)) return;
  go(overlayStack.pop() ?? 'boot', { fromBack: true });
}
$$('[data-back]').forEach((btn) => btn.addEventListener('click', goBack));

// The game is authoritative about which screen it is on, but it must never
// yank a player out of an overlay they opened — a fired timer updates where
// BACK will land instead (the hand advances underneath; you return to
// wherever the game is NOW).
function goGame(screen) {
  if (OVERLAYS.includes(current)) {
    overlayStack = [screen];
  } else {
    go(screen);
  }
}

// Esc backs out of a detour; the footer SETTINGS button is a toggle — the
// control that got you in gets you out. Esc while typing belongs to the
// field (cancel/blur), not to navigation.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  if (e.target.matches?.('input, select, textarea')) {
    e.target.blur();
    return;
  }
  goBack();
});
$('#settingsQuick').addEventListener('click', () => {
  if (current === 'settings') goBack();
  else go('settings');
});

// ---------------------------------------------------------------------------
// 1a — Boot. Optional and always skippable (PRD §5.1, §5.7).
// ---------------------------------------------------------------------------
const BOOT_LINES = [
  '> booting phosphor display',
  '> loading deck · 52 cards',
  '> waking the dog',
  '> ready',
];

let bootTimer = null;

function runBoot() {
  const log = $('#bootLog');
  const tube = $('#tube');

  // Reduce-motion gets the destination, not the journey.
  if (settings.motionReduced) {
    log.innerHTML = `${BOOT_LINES.at(-1)}<span class="caret">▮</span>`;
    $('#skipBoot').hidden = true;
    return;
  }

  tube.classList.add('powering');
  // The power-on flash is a one-shot; drop the class once it has played so it
  // can't linger on the tube for the rest of the session.
  tube.addEventListener('animationend', () => tube.classList.remove('powering'), { once: true });
  let i = 0;
  const step = () => {
    log.innerHTML = `${BOOT_LINES[i]}<span class="caret">▮</span>`;
    i++;
    if (i < BOOT_LINES.length) bootTimer = setTimeout(step, 620);
    else $('#skipBoot').hidden = true;
  };
  step();
}

$('#skipBoot').addEventListener('click', () => {
  clearTimeout(bootTimer);
  $('#tube').classList.remove('powering');
  $('#bootLog').innerHTML = `${BOOT_LINES.at(-1)}<span class="caret">▮</span>`;
  $('#skipBoot').hidden = true;
});

// ---------------------------------------------------------------------------
// 1b — Identity. Guest-first: a nickname is the whole signup (PRD §5.1).
// ---------------------------------------------------------------------------
// Deliberately small and obvious. A real filter runs server-side on join, where
// it can't be bypassed by editing the client.
const BLOCKED = ['admin', 'dealer', 'root', 'moderator'];

function readNickname() {
  const raw = $('#nickname').value.trim();
  const hint = $('#nickHint');

  if (!raw) {
    hint.textContent = 'pick a nickname first';
    hint.style.color = 'var(--amber-alert)';
    $('#nickname').focus();
    return null;
  }
  if (BLOCKED.some((w) => raw.toLowerCase().includes(w))) {
    hint.textContent = 'that name is reserved — try another';
    hint.style.color = 'var(--amber-alert)';
    $('#nickname').focus();
    return null;
  }
  hint.textContent = 'unique within room · profanity-filtered';
  hint.style.color = '';
  return raw;
}

$('#nickname').addEventListener('input', () => {
  const hint = $('#nickHint');
  hint.textContent = 'unique within room · profanity-filtered';
  hint.style.color = '';
});

$('#toCreate').addEventListener('click', () => {
  const name = readNickname();
  if (!name) return;
  session.nickname = name;
  go('lobby');
});

$('#toJoin').addEventListener('click', () => {
  const name = readNickname();
  if (!name) return;
  session.nickname = name;
  go('lobby');
  $('#codeEntry input')?.focus();
});

// ---------------------------------------------------------------------------
// 1c — Lobby. Create a room (code) or join one (code).
// ---------------------------------------------------------------------------
// Ambiguous glyphs (0/O, 1/I) are left out — codes get read aloud and retyped.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

// Creating a room is now a real server round-trip: the server mints the room
// and hands back its code. On the free tier the first connect can take ~30-50s
// while the host wakes — the button says so rather than looking hung.
$('#genCode').addEventListener('click', async () => {
  const btn = $('#genCode');
  session.maxPlayers = Number($('#maxPlayers').value);
  btn.disabled = true;
  btn.textContent = 'CONNECTING TO DEALER…';
  try {
    const code = await net.connect({
      create: true,
      nickname: session.nickname,
      startingChips: session.startingChips,
      tableSpeed: session.tableSpeed,
      maxPlayers: session.maxPlayers,
    });
    session.roomCode = code;
    $('#roomCode').textContent = code;
    btn.textContent = 'ROOM READY';
    btn.classList.remove('btn--primary');
    $('#enterRoom').hidden = false;
    dog.say('lobby');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'GENERATE CODE';
    connectError(e);
  }
});

$('#enterRoom').addEventListener('click', () => enterGame());

async function copyCode(btn) {
  if (!session.roomCode) return;
  const done = (msg) => {
    const original = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = original; }, 1400);
  };
  try {
    await navigator.clipboard.writeText(session.roomCode);
    done('COPIED');
  } catch {
    done('COPY FAILED'); // clipboard blocked (insecure context / denied permission)
  }
}
$('#copyCode').addEventListener('click', (e) => copyCode(e.currentTarget));
$('#copyCode2').addEventListener('click', (e) => copyCode(e.currentTarget));

$('#shareCode').addEventListener('click', async () => {
  if (!session.roomCode) return;
  const text = `join my Amygdala table — code ${session.roomCode}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Amygdala', text }); } catch { /* user dismissed */ }
  } else {
    copyCode($('#shareCode'));
  }
});

// Code entry: type straight through, backspace walks back, paste fills all six.
const codeInputs = $$('#codeEntry input');
codeInputs.forEach((input, i) => {
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (input.value && i < codeInputs.length - 1) codeInputs[i + 1].focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && i > 0) codeInputs[i - 1].focus();
    if (e.key === 'Enter') $('#joinRoom').click();
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    codeInputs.forEach((box, n) => { box.value = text[n] ?? ''; });
    codeInputs[Math.min(text.length, 5)].focus();
  });
});

$('#joinRoom').addEventListener('click', async () => {
  const code = codeInputs.map((i) => i.value).join('');
  if (code.length < 6) {
    codeInputs.find((i) => !i.value)?.focus();
    return;
  }
  const btn = $('#joinRoom');
  btn.disabled = true;
  btn.textContent = 'JOINING…';
  try {
    // The server validates the code; an unknown one rejects here.
    await net.connect({ create: false, code, nickname: session.nickname });
    session.roomCode = net.roomCode;
    btn.disabled = false;
    btn.textContent = 'JOIN';
    enterGame();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'JOIN';
    const hint = $('#codeHint') ?? $('#nickHint');
    if (hint) {
      hint.textContent = 'no table with that code — check and retry';
      hint.style.color = 'var(--amber-alert)';
    }
    connectError(e);
  }
});

const escape = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Segmented controls in the room set the session defaults used when a room is
// created. (The server owns a room's settings once it exists, so tuning these
// mid-room is cosmetic — they apply to the next room you create.)
bindSeg('#setMax', (v) => { session.maxPlayers = Number(v); });
bindSeg('#setSpeed', (v) => { session.tableSpeed = v; });
$('#startChips').addEventListener('change', (e) => {
  session.startingChips = Number(e.target.value);
  session.chips = session.startingChips;
});

function bindSeg(sel, onPick) {
  const group = $(sel);
  if (!group) return;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    $$('button', group).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    onPick(btn.dataset.v ?? btn.dataset.game);
  });
}

// ---------------------------------------------------------------------------
// 1d — Connected. From here the server drives everything (PRD §7).
// ---------------------------------------------------------------------------
let entered = false;

function connectError(e) {
  const msg =
    e?.message === 'NO_SERVER'
      ? 'no server configured — see app/config.js'
      : 'could not reach the dealer — is the server running?';
  const hint = $('#nickHint');
  if (hint) {
    hint.textContent = msg;
    hint.style.color = 'var(--amber-alert)';
  }
  dog.say('chips_low');
}

// Enter the live table: start reacting to server state and show whatever phase
// the room is in right now.
function enterGame() {
  entered = true;
  net.onState = onServerState;
  net.onLeave = () => {
    // The room went away (server slept, or a redeploy dropped the socket).
    if (!entered) return;
    entered = false;
    dog.say('chips_low');
    go('lobby');
  };
  if (state) onServerState(state);
}

// The single reactor: every state push routes the UI to the right screen and
// re-renders it. The server is authoritative about phase, so the client no
// longer runs a turn loop, bots, or timers of its own.
function onServerState(s) {
  state = s;
  if (!entered) return;

  if (s.phase === 'betting') {
    if (current !== 'betting') goGame('betting');
    renderBetting();
  } else if (s.phase === 'playing' || s.phase === 'dealer') {
    if (current !== 'table') {
      goGame('table');
      dog.say('hand_dealt');
    }
    renderTable();
  } else if (s.phase === 'resolved') {
    if (current !== 'result') showResult();
    else renderResultDealer();
  }
  paintDeadline();
}

// ---------------------------------------------------------------------------
// 1g — Betting round. The server runs the clock and the other seats; the client
// stages a bet locally, then sends it.
// ---------------------------------------------------------------------------
let betSent = false; // true once this hand's bet is committed to the server

function me() {
  return state?.players.find((p) => p.isYou) ?? null;
}

function renderBetting() {
  const you = me();
  if (!you) return;
  // A new betting round resets the local stage.
  if (you.bet === 0 && betSent) betSent = false;
  const staged = betSent ? you.bet : selectedBet;
  $('#betBalance').textContent = you.chips - staged;
  $('#betAmount').textContent = staged;
  renderOthersBetting();
  if (current === 'betting' && lastPhase !== 'betting') dog.say('betting_open');
  lastPhase = 'betting';
}

function addBet(amount) {
  const you = me();
  if (!you || betSent) return;
  if (selectedBet + amount > you.chips) {
    dog.say('chips_low');
    return;
  }
  selectedBet += amount;
  $('#betAmount').textContent = selectedBet;
  $('#betBalance').textContent = you.chips - selectedBet;
}

$('#chipRow').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  addBet(Number(chip.dataset.bet));
  chip.setAttribute('aria-pressed', 'true');
  setTimeout(() => chip.setAttribute('aria-pressed', 'false'), 220);
});

$('#clearBet').addEventListener('click', () => {
  if (betSent) return;
  selectedBet = 0;
  const you = me();
  $('#betAmount').textContent = '0';
  if (you) $('#betBalance').textContent = you.chips;
});

$('#dealMeIn').addEventListener('click', () => {
  if (betSent) return;
  if (selectedBet === 0) {
    dog.say('betting_open');
    return;
  }
  // The server validates every bet against its chip ledger and deals once all
  // seats are in (or the clock expires). We just commit and wait.
  betSent = true;
  net.send('bet', selectedBet);
  dog.say('bet_placed');
  $('#dealMeIn').textContent = 'WAITING FOR TABLE…';
  $('#dealMeIn').disabled = true;
});

function renderOthersBetting() {
  $('#othersBetting').innerHTML = state.players
    .filter((p) => !p.isYou)
    .map((p) =>
      p.bet > 0
        ? `<span class="hint" style="color: var(--text-strong)">${escape(p.nickname)} ✓ ${p.bet}</span>`
        : `<span class="hint">${escape(p.nickname)}${p.connected === false ? ' · away' : ' · betting…'}</span>`,
    )
    .join('');
  // Reset the round controls when a fresh betting round opens.
  if (!betSent) {
    $('#dealMeIn').textContent = 'DEAL ME IN';
    $('#dealMeIn').disabled = false;
    $('#nextHand').textContent = 'NEXT HAND';
    $('#nextHand').disabled = false;
    $$('#chipRow .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    selectedBet = 0;
  }
}

// ---------------------------------------------------------------------------
// 1e — Table
// ---------------------------------------------------------------------------
function cardEl(card, extra = '') {
  if (!card) return `<div class="card card--back ${extra}"></div>`;
  return `<div class="card ${extra}"><span class="r">${card.rank}</span><span class="s">${card.glyph}</span></div>`;
}

// Fan geometry: spread around centre, lift the middle. Set as custom properties
// so CSS owns the transform and reduce-motion can still kill the animation.
function fan(cards, cls = '') {
  const n = cards.length;
  return cards
    .map((card, i) => {
      const offset = i - (n - 1) / 2;
      const angle = offset * 8;
      const lift = -Math.abs(offset) * 3 + (n > 1 ? 6 : 0);
      return cardEl(card, `card--dealt ${cls}`).replace(
        'class="card',
        `style="--fan:${angle.toFixed(1)}deg; --lift:${lift.toFixed(0)}px; animation-delay:${i * 90}ms" class="card`,
      );
    })
    .join('');
}

// Build the same shape the engine's view() returned, from the server's already
// redacted state — legalMoves is a pure function and only reads these fields.
function pseudoState() {
  return { phase: state.phase, turn: state.turn, players: state.players };
}

let narratedTurn = null; // so a turn is narrated once, not on every patch

function renderTable() {
  // state is already the redacted view (no deck; the hole card is a card back).
  const v = state;
  const you = me();
  if (!you) return;

  $('#dealerCards').innerHTML = v.dealer.cards.map((c) => cardEl(c, 'card--dealt')).join('');
  $('#dealerTag').textContent = v.dealer.revealed ? `${v.dealer.total}` : `shows ${v.dealer.total}`;

  $('#opponents').innerHTML = v.players
    .filter((p) => !p.isYou && p.bet > 0)
    .map((p) => `
      <div class="opponent" ${v.turn === p.id ? 'data-turn' : ''}>
        ${escape(p.nickname)}
        <div class="cards">${p.cards.map((c) => cardEl(c, 'card--sm')).join('')}</div>
        <div>${opponentStatus(p)}</div>
      </div>`)
    .join('');

  $('#yourCards').innerHTML = fan(you.cards);
  $('#yourTotal').textContent = `HAND · ${you.total}${you.soft && you.total < 21 ? ' soft' : ''}`;
  $('#yourBet').textContent = `bet ${you.bet}`;

  const myTurn = v.turn === myId();
  const legal = myTurn ? blackjack.engine.legalMoves(pseudoState(), myId()) : [];
  $$('.actionbar [data-move]').forEach((btn) => {
    btn.disabled = btn.dataset.move === 'split' || !legal.includes(btn.dataset.move);
  });

  // Narrate whose turn it is, once per turn change.
  if (v.turn !== narratedTurn) {
    narratedTurn = v.turn;
    if (myTurn) {
      if (you.status === 'blackjack') dog.say('you_blackjack');
      else if (you.soft) dog.say('your_turn_soft');
      else if (you.total >= 17) dog.say('your_turn_high');
      else if (you.total <= 11) dog.say('your_turn_low');
      else dog.say('your_turn');
    } else if (v.turn) {
      dog.say('opponent_turn');
    }
  }
  lastPhase = v.phase;
}

function opponentStatus(p) {
  if (p.status === 'bust') return `<span style="color:var(--amber-alert)">bust</span>`;
  if (p.status === 'blackjack') return 'blackjack';
  if (p.status === 'standing') return `${p.total} · standing`;
  if (p.status === 'playing') return p.connected === false ? 'away…' : 'thinking…';
  return '';
}

// A move is an intent sent to the server. The server validates it, applies it,
// and pushes the new state back — the UI updates from that, not from here.
function move(kind) {
  const you = me();
  if (!you || state.turn !== myId()) return;
  if (!blackjack.engine.legalMoves(pseudoState(), myId()).includes(kind)) return;
  dog.say({ hit: 'you_hit', stand: 'you_stand', double: 'you_double' }[kind]);
  net.send(kind);
  // Freeze the actionbar until the server confirms; a duplicate send is ignored
  // server-side, but this stops a double-tap racing the patch.
  $$('.actionbar [data-move]').forEach((btn) => { btn.disabled = true; });
}

$$('.actionbar [data-move]').forEach((btn) =>
  btn.addEventListener('click', () => move(btn.dataset.move)),
);

// Keyboard: core actions are reachable without a mouse (PRD §6).
document.addEventListener('keydown', (e) => {
  if (current !== 'table' || e.target.matches('input, select')) return;
  const key = { h: 'hit', s: 'stand', d: 'double' }[e.key.toLowerCase()];
  if (key) move(key);
});

// ---------------------------------------------------------------------------
// Countdown — driven by the server's deadline, so client and server agree.
// ---------------------------------------------------------------------------
function paintDeadline() {
  stopClock();
  const el = current === 'betting' ? $('#betTimer') : current === 'table' ? $('#turnTimer') : null;
  if (!el || !state?.deadline) {
    if (el) el.textContent = '';
    return;
  }
  const paint = () => {
    const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
    el.textContent = `0:${String(left).padStart(2, '0')}`;
    el.classList.toggle('urgent', left <= 5);
    if (left <= 0) stopClock();
  };
  paint();
  timer = setInterval(paint, 500);
}

function stopClock() {
  clearInterval(timer);
  timer = null;
}

// ---------------------------------------------------------------------------
// 1h — Resolution
// ---------------------------------------------------------------------------
const BANNER = {
  win: (p) => [`YOU WIN &nbsp;·&nbsp; +${p.payout}`, 'win'],
  blackjack: (p) => [`BLACKJACK ×1.5 &nbsp;·&nbsp; +${p.payout}`, 'win'],
  push: () => ['PUSH &nbsp;·&nbsp; BET RETURNED', 'push'],
  loss: (p) => [`DEALER WINS &nbsp;·&nbsp; ${p.payout}`, 'loss'],
  bust: (p) => [`BUST &nbsp;·&nbsp; ${p.payout}`, 'bust'],
};

// Draw the resolved dealer hand + your result. Called once on entering the
// result screen; renderResultDealer re-syncs it if state arrives after.
function showResult() {
  stopClock();
  goGame('result');
  narratedTurn = null;
  renderResultDealer();

  const you = me();
  if (!you) return;

  // Stats + history. Guests keep these for the session only (PRD §5.8). The
  // server owns the chip ledger; we just reflect it.
  session.chips = you.chips;
  if (you.result === 'win' || you.result === 'blackjack') session.stats.wins++;
  else if (you.result === 'push') session.stats.pushes++;
  else if (you.result) session.stats.losses++;
  session.history.unshift({ room: session.roomCode, payout: you.payout });
  renderAccount();

  const dealerBust = state.dealer.total > 21;
  if (you.result === 'blackjack') dog.say('blackjack_payout');
  else if (you.result === 'win') dog.say(dealerBust ? 'win_dealer_bust' : 'win');
  else if (you.result === 'push') dog.say('push');
  else if (you.result === 'bust') dog.say('you_bust');
  else if (you.result) dog.say('loss');
  lastPhase = 'resolved';
}

function renderResultDealer() {
  const you = me();
  if (!you) return;
  const dealerTotal = state.dealer.total;
  $('#resultDealerCards').innerHTML = state.dealer.cards.map((c) => cardEl(c, 'card--dealt')).join('');
  $('#resultDealerTag').textContent = dealerTotal > 21 ? `${dealerTotal} · BUST` : `${dealerTotal}`;

  const banner = BANNER[you.result] ?? (() => ['HAND OVER', 'push']);
  const [text, outcome] = banner(you);
  $('#resultBanner').innerHTML = text;
  $('#resultBanner').dataset.outcome = outcome;
  $('#resultCards').innerHTML = fan(you.cards);
  $('#resultTotal').textContent = `HAND · ${you.total}`;
}

// The server auto-deals the next hand after a short linger, so NEXT HAND just
// waits for the betting round to reopen (the reactor moves the screen). It's a
// no-op nudge kept so the control still feels responsive.
$('#nextHand').addEventListener('click', () => {
  $('#nextHand').textContent = 'WAITING…';
  $('#nextHand').disabled = true;
});

// Leaving the table has to leave the server room, not just change screens — a
// data-go would keep the seat and the reactor would pull you back on the next
// patch. Stop reacting, disconnect, then return to the lobby.
$('#leaveTable').addEventListener('click', async () => {
  entered = false;
  net.onState = () => {};
  net.onLeave = () => {};
  betSent = false;
  narratedTurn = null;
  lastPhase = null;
  await net.leave();
  go('lobby');
});

// ---------------------------------------------------------------------------
// 1i — Settings
// ---------------------------------------------------------------------------
function syncSettingsUI() {
  const all = settings.all();

  $$('#setCrt button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === all.crt)));
  // role="switch" exposes its state via aria-checked (aria-pressed is for
  // toggle *buttons*) — screen readers announce the wrong state otherwise.
  $('#setMotion').setAttribute('aria-checked', String(settings.motionReduced));
  $('#motionSub').textContent = all.reduceMotion === null ? '· follows system' : '· set by you';
  $('#setFlicker').setAttribute('aria-checked', String(all.reduceFlicker));
  $('#setMute').setAttribute('aria-checked', String(all.muteDog));
  $('#setSkip').setAttribute('aria-checked', String(all.skipNarration));
  $('#setMaster').value = Math.round(all.masterVolume * 100);
  $('#setSfx').value = Math.round(all.sfxVolume * 100);
  $('#muteDogQuick').textContent = all.muteDog ? 'UNMUTE DOG' : 'MUTE DOG';
}

bindSeg('#setCrt', (v) => {
  settings.set('crt', v);
  syncSettingsUI();
});

const bindToggle = (sel, key, read = () => settings.get(key)) =>
  $(sel).addEventListener('click', () => {
    settings.set(key, !read());
    syncSettingsUI();
  });

// Reduce-motion follows the system until you touch it; then it's yours.
$('#setMotion').addEventListener('click', () => {
  settings.set('reduceMotion', !settings.motionReduced);
  syncSettingsUI();
});
bindToggle('#setFlicker', 'reduceFlicker');
bindToggle('#setMute', 'muteDog');
bindToggle('#setSkip', 'skipNarration');

$('#setMaster').addEventListener('input', (e) => settings.set('masterVolume', e.target.value / 100));
$('#setSfx').addEventListener('input', (e) => settings.set('sfxVolume', e.target.value / 100));

$('#muteDogQuick').addEventListener('click', () => {
  settings.set('muteDog', !settings.get('muteDog'));
  syncSettingsUI();
  if (settings.get('muteDog')) dog.settle();
});

// System preference changes land live if you haven't overridden them.
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
  settings.apply();
  syncSettingsUI();
});

// ---------------------------------------------------------------------------
// 1j — Account
// ---------------------------------------------------------------------------
function renderAccount() {
  $('#profileName').textContent = session.nickname;
  $('#profileMeta').textContent = `${session.isGuest ? 'guest' : 'member'} · chips ${session.chips}`;
  $('#statWins').textContent = session.stats.wins;
  $('#statLosses').textContent = session.stats.losses;
  $('#statPushes').textContent = session.stats.pushes;

  const history = $('#history');
  if (session.history.length === 0) {
    history.innerHTML = `<p class="hint" style="margin:0">no hands yet — play one and it shows up here.</p>`;
    return;
  }
  history.innerHTML = session.history
    .slice(0, 3)
    .map((h) => `
      <div class="history-row">
        <span>Blackjack · room ${escape(h.room ?? '——')}</span>
        <span class="${h.payout >= 0 ? 'pos' : 'neg'}">${h.payout >= 0 ? '+' : '−'}${Math.abs(h.payout)}</span>
      </div>`)
    .join('');
}

$('#signup').addEventListener('click', () => {
  const email = $('#email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    $('#email').focus();
    $('#email').style.borderColor = 'var(--amber-alert)';
    return;
  }
  // Converting keeps the live session — chips, seat, and stats all survive (PRD §5.1).
  $('#email').style.borderColor = '';
  session.isGuest = false;
  renderAccount();
  $('#statusMeta').textContent = 'MEMBER';
  dog.say('account');
});

// ---------------------------------------------------------------------------
// The dog, rendered
// ---------------------------------------------------------------------------
dog.subscribe((d) => {
  $('#dog').dataset.state = d.state;
  $('#dogLine').textContent = d.line;
  $('#dogBubble').hidden = !d.line;
  $('#dogSkip').hidden = d.state !== 'explaining';
});
$('#dogSkip').addEventListener('click', () => dog.skip());

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
syncSettingsUI();
renderAccount();
go('boot'); // sets the status bar + docks the dog for the screen we open on
runBoot();
