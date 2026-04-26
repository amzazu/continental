export type Suit = "S" | "H" | "D" | "C";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "A";

// Each card has a unique id within a game so identical cards from multiple
// decks can be distinguished. Format: "{deckIndex}-{suit}-{rank}"
// e.g. "0-H-7", "1-JOKER-1"
export interface Card {
  id: string;
  suit: Suit | "JOKER";
  rank: Rank | "JOKER";
}

export function isJoker(card: Card): boolean {
  return card.rank === "JOKER";
}

// Numeric rank for straight validation. Ace defaults to 14 (high);
// the validator also tries 1 (low) when checking A-2-3-4 straights.
export const RANK_VALUE: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

export const CARD_POINTS: Record<string, number> = {
  "2": 5, "3": 5, "4": 5, "5": 5, "6": 5, "7": 5, "8": 5, "9": 5,
  "10": 10, "J": 10, "Q": 10, "K": 10,
  "A": 15,
  "JOKER": 50,
};

// ─── Melds ────────────────────────────────────────────────────────────────────

export interface TrioMeld {
  id: string;
  type: "trio";
  rank: Rank;
  cards: Card[];      // jokers may appear in any position
  ownerUid: string;
}

export interface StraightMeld {
  id: string;
  type: "straight";
  suit: Suit;
  lowRankValue: number;   // 1 = A-low, 2–13 = 2–K, 14 = A-high
  highRankValue: number;
  cards: Card[];          // ordered low → high; jokers occupy missing rank slots
  ownerUid: string;
}

export type Meld = TrioMeld | StraightMeld;

// ─── Round contracts ──────────────────────────────────────────────────────────

export type MeldRequirement = { type: "trio" } | { type: "straight" };

export interface RoundConfig {
  round: number;
  cardsDealt: number;
  requirements: MeldRequirement[]; // one entry per required meld
}

export const ROUND_CONFIGS: RoundConfig[] = [
  { round: 1, cardsDealt: 6,  requirements: [{ type: "trio" }, { type: "trio" }] },
  { round: 2, cardsDealt: 7,  requirements: [{ type: "trio" }, { type: "straight" }] },
  { round: 3, cardsDealt: 8,  requirements: [{ type: "straight" }, { type: "straight" }] },
  { round: 4, cardsDealt: 9,  requirements: [{ type: "trio" }, { type: "trio" }, { type: "trio" }] },
  { round: 5, cardsDealt: 10, requirements: [{ type: "trio" }, { type: "trio" }, { type: "straight" }] },
  { round: 6, cardsDealt: 11, requirements: [{ type: "trio" }, { type: "straight" }, { type: "straight" }] },
  { round: 7, cardsDealt: 12, requirements: [{ type: "straight" }, { type: "straight" }, { type: "straight" }] },
];

export function deckCount(playerCount: number): number {
  if (playerCount <= 4) return 2;
  if (playerCount <= 6) return 3;
  return 4;
}

// ─── State machine ────────────────────────────────────────────────────────────

// Top-level game phase
export type GamePhase =
  | "lobby"
  | "round_start_offer"  // initial face-up discard offered before the first turn
  | "turn"               // a player's active turn
  | "discard_offer"      // sequential offer chain after each discard
  | "round_end"          // scoring pause between rounds
  | "game_over";

// Sub-phase within an active turn
export type TurnPhase = "draw" | "action" | "discard";

export interface TurnState {
  uid: string;
  phase: TurnPhase;
  // Jokers taken from table melds that must be placed before the turn can end
  floatingJokerCount: number;
}

// Sequential offer chain between turns
export interface OfferState {
  card: Card;
  offeredTo: string;    // uid of the player currently being offered the card
  declinedBy: string[]; // uids that have already passed
  isFree: boolean;      // true only for the next player in turn order (no penalty)
}

// ─── Firestore documents ──────────────────────────────────────────────────────

// /games/{gameId}  — readable by all players in the game
export interface GameDoc {
  hostUid: string;
  phase: GamePhase;
  round: number;            // 1–7
  dealerUid: string;
  turnOrder: string[];      // uids in seat order
  currentTurnUid: string;
  discardPile: Card[];      // index 0 is the live top card
  deckSize: number;         // card count only — deck contents are server-only
  melds: Meld[];            // all melds currently on the table, visible to all
  offerState: OfferState | null;
  turnState: TurnState | null;
  playerCount: number;
  createdAt: number;        // epoch ms
}

// /games/{gameId}/players/{uid}  — readable by all players in the game
export interface PlayerDoc {
  uid: string;
  displayName: string;
  isDown: boolean;
  handSize: number;         // card count only — not the cards themselves
  roundScore: number;
  totalScore: number;
  seatOrder: number;
}

// /games/{gameId}/hands/{uid}  — readable ONLY by the owning player
export interface HandDoc {
  hand: Card[];
  floatingJokers: Card[];   // jokers taken from table melds that must be placed this turn
}

// /games/{gameId}/private/deck  — readable ONLY by Cloud Functions (admin SDK)
export interface DeckDoc {
  cards: Card[];
}
