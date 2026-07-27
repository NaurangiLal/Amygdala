// The synced state — the ONLY thing that crosses the wire (PRD §6).
//
// This is the sync boundary AND the anti-cheat boundary, and they are the same
// object on purpose. The deck has no field here, so it cannot leak: there is
// nowhere to put it. The dealer's hole card syncs as a face-down placeholder
// (empty rank/suit) until reveal, so a client sees a card back, never the card.
//
// Colyseus needs class fields declared with types it can encode. We use the
// decorator-free `schema()` factory rather than the conventional `@type`
// decorators because the whole repo runs on `node --experimental-strip-types`
// with no build step, and decorators are not erasable syntax.

import { schema } from '@colyseus/schema';

/** A card on the table. `faceDown` marks the dealer's hidden hole card — its
 *  rank/suit are blank, so the hidden value is absent from the payload, not
 *  merely flagged. */
export const CardSchema = schema({
  rank: 'string',
  suit: 'string',
  glyph: 'string',
  fill: 'string',
  faceDown: 'boolean',
});
export type CardSchema = InstanceType<typeof CardSchema>;

export const PlayerSchema = schema({
  id: 'string',
  nickname: 'string',
  isBot: 'boolean',
  /** False while a human is mid-reconnect — the seat is held, not empty. */
  connected: 'boolean',
  chips: 'number',
  bet: 'number',
  status: 'string', // betting | playing | standing | bust | blackjack
  result: 'string', // '' until resolved, then win|loss|push|bust|blackjack
  payout: 'number',
  total: 'number', // precomputed so the client never scores a hand itself
  soft: 'boolean',
  cards: [CardSchema],
});
export type PlayerSchema = InstanceType<typeof PlayerSchema>;

export const DealerSchema = schema({
  revealed: 'boolean',
  total: 'number', // upcard total while hidden, full total once revealed
  cards: [CardSchema],
});
export type DealerSchema = InstanceType<typeof DealerSchema>;

export const SettingsSchema = schema({
  startingChips: 'number',
  tableSpeed: 'string',
});
export type SettingsSchema = InstanceType<typeof SettingsSchema>;

export const ResultSchema = schema({
  id: 'string',
  result: 'string',
  payout: 'number',
  chips: 'number',
});
export type ResultSchema = InstanceType<typeof ResultSchema>;

export const BlackjackState = schema({
  phase: 'string', // betting | playing | dealer | resolved
  turn: 'string', // sessionId of the seat on turn, '' when nobody
  deckCount: 'uint8', // count is fine to share; contents never are
  /** Epoch ms when the current timer expires, 0 when no timer is running.
   *  Clients count down locally against this instead of the server sending a
   *  patch every second. */
  deadline: 'number',
  dealer: DealerSchema,
  settings: SettingsSchema,
  players: { map: PlayerSchema },
  results: [ResultSchema],
});
export type BlackjackState = InstanceType<typeof BlackjackState>;
