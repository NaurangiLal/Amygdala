// Dog voice lines for Rummy — data, not components (PRD §5.5).
// Browser copy of packages/game-rules/src/rummy/lines.ts (same content, no types).
// Same tone guide as Blackjack's lines: lowercase, spoken, one breath long,
// under ~48 characters. The dog is a companion, never a rulebook. Rummy has no
// dealer to tease, so it teases the discard pile and luck instead.


export const RUMMY_LINES = {
  // ---- hand lifecycle ----
  rummy_dealt: {
    state: 'thinking',
    lines: ['cards are out. find the pairs.', 'here we go. watch the pile.'],
  },

  // ---- your turn ----
  rummy_your_draw: {
    state: 'prompting',
    lines: ['your draw — stock or pile?', 'take one. choose well.', 'the pile is right there.'],
  },
  rummy_your_act: {
    state: 'prompting',
    lines: ['meld what you can, then toss one.', 'anything to lay down?', 'end it with a discard.'],
  },
  rummy_drew_discard: {
    state: 'thinking',
    lines: ['everyone saw you take that.', 'bold. now they know.'],
  },
  rummy_you_meld: {
    state: 'reacting_win',
    lines: ['down it goes. nice.', 'that is a keeper.', 'the table likes that.'],
  },
  rummy_you_layoff: {
    state: 'reacting_neutral',
    lines: ['one less to carry.', 'tidy.'],
  },

  // ---- waiting ----
  rummy_opponent_turn: {
    state: 'thinking',
    lines: ['they are counting cards. probably.', 'waiting on the table.'],
  },

  // ---- resolution ----
  rummy_win: {
    state: 'celebrating',
    lines: ['out! hand empty. spin!', 'rummy! that is the whole pile.'],
  },
  rummy_loss: {
    state: 'reacting_loss',
    lines: ['caught with a full paw.', 'ears down. count the deadwood.'],
  },
  rummy_stalemate: {
    state: 'reacting_neutral',
    lines: ['deck ran dry. nobody wins.', 'a draw. chips stay home.'],
  },

  // ---- teaching (skippable, always) ----
  rummy_explain_intro: {
    state: 'explaining',
    lines: ['empty your hand first. that is the whole game.'],
  },
  rummy_explain_turn: {
    state: 'explaining',
    lines: ['draw one, meld what you can, discard one. done.'],
  },
  rummy_explain_melds: {
    state: 'explaining',
    lines: ['three of a kind, or three in a row same suit.'],
  },
  rummy_explain_score: {
    state: 'explaining',
    lines: ['losers pay what is left in their hands. courts are ten.'],
  },
};

export default RUMMY_LINES;
