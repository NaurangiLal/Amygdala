// Dog voice lines for Blackjack — data, not components (PRD §5.5).
// Edit this file to change what the dog says. Nothing here is referenced by
// class name or DOM id, so it stays safe to rewrite and later to localize.
//
// TONE GUIDE — friendly, playful, brief.
//   · lowercase, spoken, one breath long. under ~48 characters.
//   · the dog is a companion at your shoulder, never a dealer or a rulebook.
//   · it reacts to the hand, it never advises on strategy or money.
//   · it teases the dealer, never the player. losing is the dealer's fault.
//   · no exclamation stacking, no emoji, no "good luck!" filler twice in a row.

// event -> { state, lines } (PRD §8, DogEvent -> DogState/Lines)
export const BLACKJACK_LINES = {
  // ---- table lifecycle ----
  table_joined: {
    state: 'idle',
    lines: ['found us a table. nice.', 'seats are warm. good sign.'],
  },
  betting_open: {
    state: 'idle',
    lines: [
      'chips on the table. good luck!',
      'how brave are we feeling?',
      'pick a stack, any stack.',
    ],
  },
  bet_placed: {
    state: 'idle',
    lines: ['locked in.', 'bold. i like it.', "that'll do nicely."],
  },
  hand_dealt: {
    state: 'thinking',
    lines: ['here we go.', 'cards are out. eyes up.'],
  },

  // ---- your turn ----
  your_turn: {
    state: 'prompting',
    lines: ['your move — hit or stand?', 'all you.', 'the table is waiting.'],
  },
  your_turn_soft: {
    state: 'prompting',
    lines: ["soft hand — you can't bust this one.", 'that ace is doing you a favour.'],
  },
  your_turn_low: {
    state: 'prompting',
    lines: ['plenty of room under 21.', "the dealer isn't scared of that yet."],
  },
  your_turn_high: {
    state: 'prompting',
    lines: ['close to the edge now.', 'one card could end this.'],
  },
  timer_low: {
    state: 'prompting',
    lines: ['clock is going.', 'anytime now.'],
  },

  // ---- your actions ----
  you_hit: {
    state: 'thinking',
    lines: ['one more…', "let's see."],
  },
  you_stand: {
    state: 'thinking',
    lines: ['standing pat. respect.', "you're done. dealer's problem now."],
  },
  you_double: {
    state: 'thinking',
    lines: ['doubling! ok!', 'no take-backs.'],
  },
  you_bust: {
    state: 'reacting_loss',
    lines: ['over. ears down.', 'that hurt to watch.', 'one card too many.'],
  },
  you_blackjack: {
    state: 'celebrating',
    lines: ['blackjack! twenty-one on the nose.', 'natural. the good kind.'],
  },

  // ---- waiting on others ----
  opponent_turn: {
    state: 'thinking',
    lines: ['waiting on the others.', 'they are taking their time.'],
  },
  dealer_turn: {
    state: 'thinking',
    lines: ["dealer's turn. hole card time.", "let's see what it was hiding."],
  },

  // ---- resolution ----
  win: {
    state: 'reacting_win',
    lines: ['tail-wag! you take it.', 'that is how it is done.', 'good hand. good dog.'],
  },
  win_dealer_bust: {
    state: 'reacting_win',
    lines: ['tail-wag! dealer busted — you take it.', 'dealer went over. free chips.'],
  },
  loss: {
    state: 'reacting_loss',
    lines: ['dealer got that one.', 'ears down. next hand is ours.', 'rude.'],
  },
  push: {
    state: 'reacting_neutral',
    lines: ['a tie. nobody moves.', 'push. chips come home.'],
  },
  blackjack_payout: {
    state: 'celebrating',
    lines: ['blackjack pays one and a half. spin!', 'three to two. very nice.'],
  },
  chips_low: {
    state: 'reacting_neutral',
    lines: ['stack is getting thin.', 'careful with that last pile.'],
  },

  // ---- teaching (skippable, always) ----
  explain_intro: {
    state: 'explaining',
    lines: ['beat the dealer. do not go over 21. that is the whole game.'],
  },
  explain_values: {
    state: 'explaining',
    lines: ['faces are ten. an ace is eleven until it would bust you, then it is one.'],
  },
  explain_dealer: {
    state: 'explaining',
    lines: ['the dealer draws to sixteen and stands on seventeen. no choices. no mercy.'],
  },
  explain_moves: {
    state: 'explaining',
    lines: ['hit for a card. stand to keep what you have. double for one card at twice the bet.'],
  },
};

// Non-game screens narrate too — the dog is the voice of the whole UI (PRD §5.5).
export const SHELL_LINES = {
  identity: { state: 'idle', lines: ['what should i call you?', 'names first. then cards.'] },
  lobby: { state: 'idle', lines: ['share the code — the more the merrier.', 'who else is coming?'] },
  room_waiting: { state: 'idle', lines: ['waiting on the humans.', 'seats are filling up.'] },
  room_ready: { state: 'prompting', lines: ['everyone is in. start it.'] },
  account: { state: 'idle', lines: ["sign up and i'll remember your streak.", 'i have a good memory. mostly.'] },
  settings: { state: 'idle', lines: ['turn me down if i talk too much.'] },
};

export default { ...BLACKJACK_LINES, ...SHELL_LINES };
