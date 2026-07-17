// The dog: a state machine over the line library (PRD §5.5).
// It owns *when* the dog speaks and *what state* it wears. It never owns the
// words — those live in game_rules/<game>/lines.mjs as data.

export const DOG_STATES = [
  'idle',
  'explaining',
  'prompting',
  'thinking',
  'reacting_win',
  'reacting_loss',
  'reacting_neutral',
  'celebrating',
];

// How long a line stays up before the dog settles back to idle, per state.
// `null` means it holds until the next event.
const DWELL = {
  explaining: null,
  prompting: null,
  thinking: null,
  idle: null,
  reacting_win: 4200,
  reacting_loss: 4200,
  reacting_neutral: 3600,
  celebrating: 5000,
};

export class Dog {
  #lines;
  #settings;
  #listeners = new Set();
  #timer = null;
  #lastLine = new Map(); // event -> last index, so a line doesn't repeat back-to-back

  state = 'idle';
  line = '';
  event = null;

  constructor(lines, settings) {
    this.#lines = lines;
    this.#settings = settings;
  }

  subscribe(fn) {
    this.#listeners.add(fn);
    fn(this);
    return () => this.#listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.#listeners) fn(this);
  }

  // Rotate through a line set rather than repeating the first one forever.
  #pick(event, entry) {
    if (entry.lines.length === 1) return entry.lines[0];
    const last = this.#lastLine.get(event);
    let i = Math.floor(Math.random() * entry.lines.length);
    if (i === last) i = (i + 1) % entry.lines.length;
    this.#lastLine.set(event, i);
    return entry.lines[i];
  }

  // The one entry point. Fire an event; the dog decides state + line.
  say(event) {
    const entry = this.#lines[event];
    if (!entry) {
      console.warn(`[dog] no line for event "${event}"`);
      return;
    }

    clearTimeout(this.#timer);
    this.event = event;
    this.state = entry.state;

    // Muting silences the words, not the dog — it still emotes, because the
    // state is load-bearing UI (whose turn it is, what just happened).
    this.line = this.#settings.get('muteDog') ? '' : this.#pick(event, entry);

    // Narration never blocks play (PRD §5.5) — skip just shortens the read.
    if (entry.state === 'explaining' && this.#settings.get('skipNarration')) {
      this.state = 'idle';
      this.line = '';
    }

    this.#emit();

    const dwell = DWELL[this.state];
    if (dwell) this.#timer = setTimeout(() => this.settle(), dwell);
  }

  settle() {
    clearTimeout(this.#timer);
    this.state = 'idle';
    this.line = '';
    this.event = null;
    this.#emit();
  }

  // "Skip" on a multi-step explanation — always available, never destructive.
  skip() {
    this.settle();
  }
}
