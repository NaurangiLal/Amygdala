// Amygdala — Phase 1 shell.
//
// SCOPE: this is the frontend prototype. There is no server yet, so the
// Blackjack engine runs locally and the other seats are simulated. Every place
// that will become a server round-trip is marked SERVER: — those are the seams
// the Colyseus work (PRD §7) plugs into, and nothing else should need to move.

import { getGame } from '../game_rules/index.mjs';
import { Dog } from './dog.mjs';
import { Settings } from './settings.mjs';

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

let state = null; // live blackjack state (SERVER: authoritative copy lives server-side)
let selectedBet = 0;
let timer = null;

// Table speed -> seconds on the clock (PRD §5.2 room setting, §5.3 turn timer).
const CLOCK = { slow: 20, normal: 12, fast: 7 };

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

$('#genCode').addEventListener('click', () => {
  // SERVER: the room is created server-side and the code comes back with it.
  session.roomCode = makeCode();
  session.maxPlayers = Number($('#maxPlayers').value);
  $('#roomCode').textContent = session.roomCode;
  $('#genCode').textContent = 'REGENERATE CODE';
  $('#genCode').classList.remove('btn--primary');
  $('#enterRoom').hidden = false;
  dog.say('lobby');
});

$('#enterRoom').addEventListener('click', () => openRoom());

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

$('#joinRoom').addEventListener('click', () => {
  const code = codeInputs.map((i) => i.value).join('');
  if (code.length < 6) {
    codeInputs.find((i) => !i.value)?.focus();
    return;
  }
  // SERVER: join is validated server-side; an unknown code comes back rejected.
  session.roomCode = code;
  openRoom();
});

// ---------------------------------------------------------------------------
// 1d — Room. Seats fill, host tunes settings, host starts.
// ---------------------------------------------------------------------------
// Simulated table-mates. SERVER: this list is the room's real player roster.
const BOTS = [
  { id: 'p2', nickname: 'player_two' },
  { id: 'p3', nickname: 'player_3' },
];

let seated = [];

function openRoom() {
  if (!session.roomCode) session.roomCode = makeCode();
  seated = [
    { id: 'you', nickname: session.nickname, isYou: true, isHost: true },
    { ...BOTS[0], isYou: false, isHost: false },
  ];
  $('#roomCodeTag').textContent = session.roomCode;
  renderRoster();
  go('room');

  // A third seat fills while you wait — the room feels live.
  setTimeout(() => {
    if (current !== 'room' || seated.length >= session.maxPlayers) return;
    seated.push({ ...BOTS[1], isYou: false, isHost: false });
    renderRoster();
  }, 2600);
}

function renderRoster() {
  const roster = $('#roster');
  roster.innerHTML = '';
  $('#seatCount').textContent = `Players (${seated.length} / ${session.maxPlayers})`;

  for (const p of seated) {
    const row = document.createElement('div');
    row.className = 'seat';
    row.innerHTML = `
      <div class="row" style="gap: var(--space-2);">
        <span class="dog dog--sm" data-state="idle"></span>
        <span class="hud">${escape(p.nickname)}${p.isHost ? ' <span class="badge-host">★HOST</span>' : ''}</span>
      </div>`;
    // Host controls: kick is host-only, and you can't kick yourself (PRD §5.2).
    if (!p.isYou) {
      const kick = document.createElement('button');
      kick.className = 'btn btn--sm btn--amber';
      kick.type = 'button';
      kick.textContent = '✕ KICK';
      kick.addEventListener('click', () => {
        seated = seated.filter((s) => s.id !== p.id);
        renderRoster();
      });
      row.append(kick);
    }
    roster.append(row);
  }

  for (let i = seated.length; i < session.maxPlayers; i++) {
    const empty = document.createElement('div');
    empty.className = 'seat seat--empty';
    empty.textContent = '＋ waiting for player…';
    roster.append(empty);
  }

  $('#startGame').disabled = seated.length < 1;
}

const escape = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Segmented controls in the room
bindSeg('#setMax', (v) => {
  session.maxPlayers = Number(v);
  renderRoster();
});
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

$('#startGame').addEventListener('click', () => {
  // SERVER: host-only start; the server creates the authoritative game state.
  state = blackjack.engine.createState(
    seated.map((p) => ({ ...p, chips: session.startingChips })),
    { startingChips: session.startingChips, tableSpeed: session.tableSpeed },
  );
  openBetting();
});

// ---------------------------------------------------------------------------
// 1g — Betting round
// ---------------------------------------------------------------------------
let botBetTimers = [];

// Pick a bot bet that its stack can actually cover; rebuy a busted bot.
// SERVER: real players' ledgers live server-side — a broke player would be
// prompted to rebuy or spectate, never allowed to submit an impossible bet.
function botBet(p) {
  if (p.chips < 5) p.chips = session.startingChips; // simulated rebuy
  const pick = [25, 50, 100][Math.floor(Math.random() * 3)];
  return Math.min(pick, p.chips);
}

function openBetting() {
  selectedBet = 0;
  const you = state.players.find((p) => p.isYou);
  $('#betBalance').textContent = you.chips;
  $('#betAmount').textContent = '0';
  $$('#chipRow .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  renderOthersBetting();
  goGame('betting');
  dog.say('betting_open');

  // The other seats commit their bets while you're still deciding, so the room
  // reads as live. SERVER: these are real players' bets arriving over the wire.
  botBetTimers.forEach(clearTimeout);
  botBetTimers = state.players
    .filter((p) => !p.isYou)
    .map((p, i) =>
      setTimeout(() => {
        if (state.phase !== 'betting') return;
        blackjack.engine.apply(state, p.id, 'bet', botBet(p));
        renderOthersBetting();
      }, 1200 + i * 900),
    );

  // Bet clock honours the room's table speed, same as the turn clock.
  startClock($('#betTimer'), CLOCK[session.tableSpeed] ?? 15, () => {
    // Idle player can't stall the table — auto-deal the standing bet (PRD §5.3).
    // Blackjack pays ×1.5, so a stack can sit below 25; fall back to the
    // smallest chip rather than letting the auto-bet silently fail.
    if (selectedBet === 0) addBet(you.chips >= 25 ? 25 : 5);
    $('#dealMeIn').click();
  });
}

function addBet(amount) {
  const you = state.players.find((p) => p.isYou);
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
  selectedBet = 0;
  const you = state.players.find((p) => p.isYou);
  $('#betAmount').textContent = '0';
  $('#betBalance').textContent = you.chips;
});

$('#dealMeIn').addEventListener('click', () => {
  if (selectedBet === 0) {
    dog.say('betting_open');
    return;
  }
  stopClock();
  botBetTimers.forEach(clearTimeout);

  // SERVER: every bet is validated against the server's chip ledger.
  blackjack.engine.apply(state, 'you', 'bet', selectedBet);
  // Anyone who hasn't committed yet gets swept in at the deal.
  for (const p of state.players.filter((x) => !x.isYou && x.bet === 0)) {
    blackjack.engine.apply(state, p.id, 'bet', botBet(p));
  }

  blackjack.engine.apply(state, 'you', 'deal');
  goGame('table'); // settles the dog first, so narrate after the screen is up
  dog.say('hand_dealt');
  renderTable();
  setTimeout(runTurn, 700);
});

function renderOthersBetting() {
  $('#othersBetting').innerHTML = state.players
    .filter((p) => !p.isYou)
    .map((p) =>
      p.bet > 0
        ? `<span class="hint" style="color: var(--text-strong)">${escape(p.nickname)} ✓ ${p.bet}</span>`
        : `<span class="hint">${escape(p.nickname)} · betting…</span>`,
    )
    .join('');
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

function renderTable() {
  // Everything rendered below comes from view() — the redacted state a client is
  // allowed to see. The hole card is null here, not hidden with CSS (PRD §6).
  const v = blackjack.engine.view(state, 'you');
  const you = v.players.find((p) => p.isYou);

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

  const legal = blackjack.engine.legalMoves(state, 'you');
  $$('.actionbar [data-move]').forEach((btn) => {
    btn.disabled = btn.dataset.move === 'split' || !legal.includes(btn.dataset.move);
  });
}

function opponentStatus(p) {
  if (p.status === 'bust') return `<span style="color:var(--amber-alert)">bust</span>`;
  if (p.status === 'blackjack') return 'blackjack';
  if (p.status === 'standing') return `${p.total} · standing`;
  if (p.status === 'playing') return 'thinking…';
  return '';
}

// Turn loop. SERVER: the server owns whose turn it is and broadcasts it.
function runTurn() {
  if (state.phase === 'resolved') return showResult();

  const turn = state.turn;
  if (turn === null) return showResult();

  if (turn === 'you') {
    renderTable();
    const you = state.players.find((p) => p.isYou);
    const { total, soft } = blackjack.engine.handValue(you.cards);
    if (you.status === 'blackjack') dog.say('you_blackjack');
    else if (soft) dog.say('your_turn_soft');
    else if (total >= 17) dog.say('your_turn_high');
    else if (total <= 11) dog.say('your_turn_low');
    else dog.say('your_turn');

    startClock($('#turnTimer'), CLOCK[session.tableSpeed], () => move('stand')); // auto-stand
    return;
  }

  // A bot's turn: basic strategy, paced so you can watch it happen.
  dog.say('opponent_turn');
  renderTable();
  setTimeout(() => {
    const p = state.players.find((x) => x.id === turn);
    if (!p || p.status !== 'playing') return runTurn();
    const { total } = blackjack.engine.handValue(p.cards);
    blackjack.engine.apply(state, turn, total < 17 ? 'hit' : 'stand');
    renderTable();
    runTurn();
  }, 900);
}

function move(kind) {
  stopClock();
  if (!blackjack.engine.legalMoves(state, 'you').includes(kind)) return;

  dog.say({ hit: 'you_hit', stand: 'you_stand', double: 'you_double' }[kind]);
  blackjack.engine.apply(state, 'you', kind);
  renderTable();

  const you = state.players.find((p) => p.isYou);
  if (you.status === 'bust') {
    dog.say('you_bust');
    setTimeout(runTurn, 900);
    return;
  }
  setTimeout(runTurn, kind === 'hit' ? 450 : 700);
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
// Turn timer
// ---------------------------------------------------------------------------
function startClock(el, seconds, onTimeout) {
  stopClock();
  let left = seconds;
  const paint = () => {
    el.textContent = `0:${String(Math.max(left, 0)).padStart(2, '0')}`;
    el.classList.toggle('urgent', left <= 5);
  };
  paint();
  timer = setInterval(() => {
    left--;
    paint();
    if (left === 5) dog.say('timer_low');
    if (left <= 0) {
      stopClock();
      onTimeout();
    }
  }, 1000);
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

function showResult() {
  stopClock();
  const v = blackjack.engine.view(state, 'you');
  const you = v.players.find((p) => p.isYou);

  const dealerTotal = blackjack.engine.handValue(state.dealer.cards).total;
  $('#resultDealerCards').innerHTML = state.dealer.cards.map((c) => cardEl(c, 'card--dealt')).join('');
  $('#resultDealerTag').textContent = dealerTotal > 21 ? `${dealerTotal} · BUST` : `${dealerTotal}`;

  const [text, outcome] = BANNER[you.result](you);
  $('#resultBanner').innerHTML = text;
  $('#resultBanner').dataset.outcome = outcome;
  $('#resultCards').innerHTML = fan(you.cards);
  $('#resultTotal').textContent = `HAND · ${you.total}`;

  // Stats + history. Guests keep these for the session only (PRD §5.8).
  session.chips = you.chips;
  if (you.result === 'win' || you.result === 'blackjack') session.stats.wins++;
  else if (you.result === 'push') session.stats.pushes++;
  else session.stats.losses++;
  session.history.unshift({ room: session.roomCode, payout: you.payout });
  renderAccount();

  goGame('result');

  if (you.result === 'blackjack') dog.say('blackjack_payout');
  else if (you.result === 'win') dog.say(dealerTotal > 21 ? 'win_dealer_bust' : 'win');
  else if (you.result === 'push') dog.say('push');
  else if (you.result === 'bust') dog.say('you_bust');
  else dog.say('loss');
}

$('#nextHand').addEventListener('click', () => {
  const you = state.players.find((p) => p.isYou);
  // Below the smallest chip counts as broke: blackjack pays ×1.5 rounded, so
  // stacks drift off the 5-grain (e.g. 3 left) — unbettable, not just zero.
  if (you.chips < 5) {
    // The session tops you back up. Chips are score, not money (PRD §2).
    you.chips = session.startingChips;
    dog.say('chips_low');
  }
  blackjack.engine.apply(state, 'you', 'nextHand');
  openBetting();
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
