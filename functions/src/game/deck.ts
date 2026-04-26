import { Card, Suit, Rank, deckCount } from "../../../shared/types.js";

const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function buildSingleDeck(deckIndex: number): Card[] {
  const cards: Card[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `${deckIndex}-${suit}-${rank}`, suit, rank });
    }
  }

  // Standard deck has 2 jokers
  cards.push({ id: `${deckIndex}-JOKER-0`, suit: "JOKER", rank: "JOKER" });
  cards.push({ id: `${deckIndex}-JOKER-1`, suit: "JOKER", rank: "JOKER" });

  return cards; // 54 cards
}

// Fisher-Yates shuffle — mutates a copy, returns it
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildShuffledDeck(playerCount: number): Card[] {
  const numDecks = deckCount(playerCount);
  const cards: Card[] = [];
  for (let i = 0; i < numDecks; i++) {
    cards.push(...buildSingleDeck(i));
  }
  return shuffle(cards);
}

export interface DealtRound {
  hands: Record<string, Card[]>; // uid → hand
  initialDiscard: Card;          // flipped face-up to start the round
  remainingDeck: Card[];
}

export function dealRound(
  deck: Card[],
  turnOrder: string[],           // uids in the order they'll receive cards
  cardsPerPlayer: number
): DealtRound {
  const remaining = [...deck];
  const hands: Record<string, Card[]> = {};

  for (const uid of turnOrder) {
    hands[uid] = remaining.splice(0, cardsPerPlayer);
  }

  // Flip the next card to start the discard pile
  const initialDiscard = remaining.splice(0, 1)[0];

  return { hands, initialDiscard, remainingDeck: remaining };
}

// Called when the draw pile runs out mid-round.
// The top of the discard pile stays; everything beneath is reshuffled.
export function reshuffleDiscardIntoDeck(discardPile: Card[]): {
  newDeck: Card[];
  newDiscardPile: Card[];
} {
  if (discardPile.length < 2) {
    return { newDeck: [], newDiscardPile: discardPile };
  }
  return {
    newDeck: shuffle(discardPile.slice(1)),
    newDiscardPile: [discardPile[0]],
  };
}
