import { Card, CARD_POINTS } from "../../../shared/types.js";

export function scoreHand(hand: Card[]): number {
  return hand.reduce((total, card) => total + (CARD_POINTS[card.rank] ?? 0), 0);
}
