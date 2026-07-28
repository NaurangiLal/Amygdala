// The synced Rummy state — the ONLY thing broadcast to the room (PRD §6).
//
// Rummy's secrets are different from Blackjack's: every player's hand is
// hidden from every OTHER player. Rather than filtering per client, hands are
// simply not in this schema at all — a player entry carries a handCount and
// nothing else. Each player's own cards travel in a targeted per-client
// message ("hand"), so an opponent's cards can't leak through the sync layer
// for the same reason Blackjack's deck can't: there is nowhere for them to be.

import { schema } from '@colyseus/schema';
import { CardSchema, ResultSchema, SettingsSchema } from './BlackjackState.ts';

export { CardSchema, ResultSchema, SettingsSchema };

export const MeldSchema = schema({
  id: 'number',
  ownerId: 'string',
  kind: 'string', // set | run
  cards: [CardSchema], // public by definition — melds live face-up on the table
});
export type MeldSchema = InstanceType<typeof MeldSchema>;

export const RummyPlayerSchema = schema({
  id: 'string',
  nickname: 'string',
  isBot: 'boolean',
  connected: 'boolean',
  chips: 'number',
  handCount: 'uint8', // the ONLY thing anyone learns about another hand
  result: 'string', // '' until resolved, then win | loss | push
  deadwood: 'number', // 0 until resolved — revealing it early would leak
  payout: 'number',
});
export type RummyPlayerSchema = InstanceType<typeof RummyPlayerSchema>;

export const RummyState = schema({
  phase: 'string', // playing | resolved
  turn: 'string', // seat id on turn, '' when resolved
  turnPhase: 'string', // draw | act
  deadline: 'number', // epoch-ms expiry of the visible turn clock, 0 if none
  stockCount: 'uint8',
  discardCount: 'uint8',
  /** Only the pile's top card is public knowledge in rummy. */
  discardTop: CardSchema,
  hasDiscardTop: 'boolean',
  melds: [MeldSchema],
  settings: SettingsSchema,
  players: { map: RummyPlayerSchema },
  results: [ResultSchema],
});
export type RummyState = InstanceType<typeof RummyState>;
