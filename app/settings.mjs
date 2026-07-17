// Settings + persistence (PRD §5.7, §5.8).
// Guests: local storage. Accounts: the same shape would sync server-side —
// swap the #read/#write pair for an API call and nothing else changes.

const KEY = 'amygdala.settings.v1';

const DEFAULTS = {
  // Subtle by default: full CRT hurts readability, off loses the point (PRD §9).
  crt: 'subtle',
  reduceMotion: null, // null = follow the system; true/false = explicit override
  reduceFlicker: false,
  muteDog: false,
  skipNarration: false,
  masterVolume: 0.6,
  sfxVolume: 0.4,
};

const systemPrefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Settings {
  #values;
  #listeners = new Set();

  constructor() {
    this.#values = { ...DEFAULTS, ...this.#read() };
  }

  #read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
      return {}; // corrupt or unavailable storage falls back to defaults
    }
  }

  #write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.#values));
    } catch {
      /* private mode — settings just won't survive the session */
    }
  }

  get(key) {
    return this.#values[key];
  }

  all() {
    return { ...this.#values };
  }

  set(key, value) {
    this.#values[key] = value;
    this.#write();
    this.apply();
    for (const fn of this.#listeners) fn(this);
  }

  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  // Reduce-motion is a toggle that *follows the system* until you touch it.
  get motionReduced() {
    return this.#values.reduceMotion ?? systemPrefersReducedMotion();
  }

  // Push state onto the document root; all CRT CSS keys off these classes.
  apply() {
    const root = document.documentElement;
    root.classList.remove('crt--off', 'crt--subtle', 'crt--full');
    root.classList.add(`crt--${this.#values.crt}`);
    root.classList.toggle('reduce-motion', this.motionReduced);
    root.classList.toggle('reduce-flicker', this.#values.reduceFlicker || this.motionReduced);
  }
}
