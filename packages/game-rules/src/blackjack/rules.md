# Blackjack — rule reference

The text the dog teaches in `explaining`, and what the players' reference shows.
Written in our own words; checked against standard casino rules (PRD §5.5).

## The goal

Beat the dealer's hand without going over 21. You are not playing the other
people at the table — everyone plays the dealer independently.

## Card values

| Card | Value |
| --- | --- |
| 2–10 | Face value |
| Jack, Queen, King | 10 |
| Ace | 11, or 1 if 11 would bust you |

A hand holding an ace still counted as 11 is **soft** — a soft 17 (A+6) can't
bust on the next card. Once the ace drops to 1, the hand is **hard**.

## How a hand runs

1. **Bet.** Everyone puts chips up before any card is dealt.
2. **Deal.** Each player gets two cards face up. The dealer gets one face up and
   one face down — the hole card.
3. **Play.** Each player acts in turn until they stand or bust.
4. **Dealer.** The hole card flips. The dealer draws to 16 and stands on all 17s,
   including soft 17. The dealer has no choices — the rule is fixed.
5. **Settle.** Hands are compared and chips move.

## Your moves

- **Hit** — take another card. Repeat as long as you're under 21.
- **Stand** — keep what you have and end your turn.
- **Double** — double your bet, take exactly one more card, and your turn ends.
  First decision only.
- **Split** — two cards of the same rank become two hands. *Not in v1 (PRD §5.3);
  the control renders dimmed.*

## Outcomes

| Outcome | What happened | Pays |
| --- | --- | --- |
| **Blackjack** | Ace + a ten-value card on the first two cards | 3:2 (1.5×) |
| **Win** | You're closer to 21 than the dealer, or the dealer busts | 1:1 |
| **Push** | You and the dealer tie | Bet returned |
| **Loss** | The dealer is closer to 21 | Bet lost |
| **Bust** | You went over 21 | Bet lost immediately |

Bust is the one that costs you twice: you lose the moment you go over, even if
the dealer busts afterwards. That's the house edge in one line.

## House rules in this build

- Dealer stands on all 17s, soft included.
- Blackjack pays 3:2.
- A player blackjack against a dealer blackjack is a push.
- No insurance, no surrender, no split (v1).
- The shoe reshuffles when it runs low.
- Chips are **cosmetic score only** — no real-money gambling (PRD §2).

## Turn timer

Every decision is on a clock. If it runs out you're auto-stood, so one idle
player can't stall the table (PRD §5.3). Table speed sets the length.
