import {
  Card,
  Meld,
  TrioMeld,
  StraightMeld,
  MeldRequirement,
  RANK_VALUE,
  Rank,
  Suit,
  isJoker,
} from "../../../shared/types.js";

// Omit doesn't distribute over unions, so we define pending meld types explicitly
type PendingTrioMeld = Omit<TrioMeld, "id" | "ownerUid">;
type PendingStraightMeld = Omit<StraightMeld, "id" | "ownerUid">;
type PendingMeld = PendingTrioMeld | PendingStraightMeld;

// ─── Trio validation ──────────────────────────────────────────────────────────

function validateTrio(cards: Card[]): { valid: boolean; rank?: Rank } {
  if (cards.length < 3) return { valid: false };

  const naturalCards = cards.filter((c) => !isJoker(c));

  if (naturalCards.length === 0) return { valid: false }; // all jokers — no rank to anchor

  const ranks = new Set(naturalCards.map((c) => c.rank as Rank));
  if (ranks.size !== 1) return { valid: false }; // mixed ranks

  return { valid: true, rank: [...ranks][0] };
}

// ─── Straight validation ──────────────────────────────────────────────────────

// Returns the consecutive integer sequence a straight would need to occupy,
// trying both ace-low (1) and ace-high (14). Returns null if not a valid straight.
function consecutiveRankValues(cards: Card[]): {
  values: number[];
  suit: Suit;
} | null {
  const naturalCards = cards.filter((c) => !isJoker(c));
  const jokerCount = cards.length - naturalCards.length;

  if (naturalCards.length === 0) return null; // can't anchor without a natural card

  // All natural cards must share the same suit
  const suits = new Set(naturalCards.map((c) => c.suit as Suit));
  if (suits.size !== 1) return null;
  const suit = [...suits][0];

  // Collect the numeric values of natural cards, trying ace-low then ace-high
  for (const aceValue of [1, 14]) {
    const values = naturalCards.map((c) =>
      c.rank === "A" ? aceValue : RANK_VALUE[c.rank as Rank]
    );

    // Natural cards must not repeat a rank position
    if (new Set(values).size !== values.length) continue;

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const span = maxVal - minVal + 1;

    // The span can be at most cards.length (natural + jokers fill the gaps)
    if (span > cards.length) continue;

    // No wrap-around: K=13, A-high=14 is fine; A-high=14 followed by 2=2 is not
    if (aceValue === 14 && values.includes(1)) continue; // mixed ace roles
    if (minVal < 1 || maxVal > 14) continue;
    // Prevent K-A-2 wrap: the full slot range must be within [1,14]
    if (minVal === 1 && maxVal === 14) continue;

    // Build the full slot sequence (minVal … maxVal) and verify jokers fill gaps
    const full: number[] = [];
    for (let v = minVal; v <= maxVal; v++) full.push(v);

    const gaps = full.filter((v) => !values.includes(v));
    if (gaps.length !== jokerCount) continue;

    // ─── No two adjacent jokers rule ─────────────────────────────────────────
    // Map each position in `cards` (ordered low→high by the caller) to its value
    // We check adjacency in the final ordered slot sequence.
    const slotIsJoker = full.map((v) => gaps.includes(v));
    for (let i = 0; i < slotIsJoker.length - 1; i++) {
      if (slotIsJoker[i] && slotIsJoker[i + 1]) return null; // adjacent jokers
    }

    return { values: full, suit };
  }

  return null;
}

function validateStraight(cards: Card[]): {
  valid: boolean;
  suit?: Suit;
  lowRankValue?: number;
  highRankValue?: number;
} {
  if (cards.length < 4) return { valid: false };

  const result = consecutiveRankValues(cards);
  if (!result) return { valid: false };

  return {
    valid: true,
    suit: result.suit,
    lowRankValue: result.values[0],
    highRankValue: result.values[result.values.length - 1],
  };
}

// ─── Contract validation ──────────────────────────────────────────────────────

export interface ValidatedMeld {
  meld: PendingMeld;
}

export interface ContractValidationResult {
  valid: boolean;
  error?: string;
  validatedMelds?: ValidatedMeld[];
}

// Validates that a set of card groups satisfies a round's requirements.
// `groups` must be in the same order as `requirements`.
export function validateContract(
  groups: Card[][],
  requirements: MeldRequirement[]
): ContractValidationResult {
  if (groups.length !== requirements.length) {
    return { valid: false, error: "Wrong number of melds for this round." };
  }

  const validatedMelds: ValidatedMeld[] = [];

  for (let i = 0; i < requirements.length; i++) {
    const req = requirements[i];
    const cards = groups[i];

    if (req.type === "trio") {
      const result = validateTrio(cards);
      if (!result.valid) {
        return { valid: false, error: `Meld ${i + 1} is not a valid trio.` };
      }
      validatedMelds.push({
        meld: { type: "trio", rank: result.rank!, cards },
      });
    } else {
      const result = validateStraight(cards);
      if (!result.valid) {
        return {
          valid: false,
          error: `Meld ${i + 1} is not a valid straight.`,
        };
      }
      validatedMelds.push({
        meld: {
          type: "straight",
          suit: result.suit!,
          lowRankValue: result.lowRankValue!,
          highRankValue: result.highRankValue!,
          cards,
        },
      });
    }
  }

  return { valid: true, validatedMelds };
}

// ─── Building on existing melds ───────────────────────────────────────────────

export type AddToMeldResult =
  | { valid: true; updatedMeld: Meld }
  | { valid: false; error: string };

// Validates adding one or more cards to an existing meld (either end for straights).
export function validateAddToMeld(
  meld: Meld,
  newCards: Card[]
): AddToMeldResult {
  if (newCards.length === 0) {
    return { valid: false, error: "No cards provided." };
  }

  if (meld.type === "trio") {
    const combined = [...meld.cards, ...newCards];
    const result = validateTrio(combined);
    if (!result.valid) {
      return { valid: false, error: "Cards do not match this trio." };
    }
    return { valid: true, updatedMeld: { ...meld, cards: combined } };
  }

  // Straight: try prepending and/or appending
  const combined = [...meld.cards, ...newCards];
  const result = validateStraight(combined);
  if (!result.valid) {
    return {
      valid: false,
      error: "Cards do not extend this straight legally.",
    };
  }

  // Re-order the combined cards by their rank value for consistent storage
  const ordered = orderStraightCards(combined, result.lowRankValue!);
  return {
    valid: true,
    updatedMeld: {
      ...meld,
      lowRankValue: result.lowRankValue!,
      highRankValue: result.highRankValue!,
      cards: ordered,
    },
  };
}

// ─── Joker replacement ────────────────────────────────────────────────────────

export type ReplaceJokerResult =
  | { valid: true; updatedMeld: Meld; joker: Card }
  | { valid: false; error: string };

// Swap the natural card into the meld at the joker's position.
// Returns the freed joker so the caller can add it to floatingJokers.
export function validateReplaceJoker(
  meld: Meld,
  jokerCardId: string,
  naturalCard: Card
): ReplaceJokerResult {
  const jokerIndex = meld.cards.findIndex(
    (c) => c.id === jokerCardId && isJoker(c)
  );
  if (jokerIndex === -1) {
    return { valid: false, error: "Joker not found in this meld." };
  }

  const joker = meld.cards[jokerIndex];
  const newCards = [...meld.cards];
  newCards[jokerIndex] = naturalCard;

  // Validate the meld still holds with the natural card in place
  if (meld.type === "trio") {
    const result = validateTrio(newCards);
    if (!result.valid) {
      return { valid: false, error: "Natural card does not fit this trio." };
    }
    return { valid: true, updatedMeld: { ...meld, cards: newCards }, joker };
  } else {
    const result = validateStraight(newCards);
    if (!result.valid) {
      return {
        valid: false,
        error: "Natural card does not fit this straight.",
      };
    }
    return {
      valid: true,
      updatedMeld: {
        ...meld,
        lowRankValue: result.lowRankValue!,
        highRankValue: result.highRankValue!,
        cards: orderStraightCards(newCards, result.lowRankValue!),
      },
      joker,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rankValueOf(card: Card, lowRankValue: number): number {
  if (isJoker(card)) return 0; // placeholder; position is inferred from slot
  if (card.rank === "A") return lowRankValue === 1 ? 1 : 14;
  return RANK_VALUE[card.rank as Rank];
}

// Orders straight cards low→high. Jokers sort into their natural slot position.
function orderStraightCards(cards: Card[], lowRankValue: number): Card[] {
  // Separate naturals and jokers, sort naturals, then interleave jokers into gaps
  const naturals = cards
    .filter((c) => !isJoker(c))
    .sort((a, b) => rankValueOf(a, lowRankValue) - rankValueOf(b, lowRankValue));

  const jokers = cards.filter(isJoker);

  // Build a slot map: fill natural cards at their positions, jokers fill gaps
  const highRankValue = lowRankValue + cards.length - 1;
  const result: Card[] = [];
  let jokerIdx = 0;
  let naturalIdx = 0;

  for (let v = lowRankValue; v <= highRankValue; v++) {
    const natural = naturals[naturalIdx];
    const naturalVal = natural ? rankValueOf(natural, lowRankValue) : -1;
    if (naturalVal === v) {
      result.push(natural);
      naturalIdx++;
    } else {
      result.push(jokers[jokerIdx++]);
    }
  }

  return result;
}
