import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  Card,
  GameDoc,
  HandDoc,
  PlayerDoc,
  DeckDoc,
  OfferState,
  ROUND_CONFIGS,
} from "../../../shared/types.js";

export interface PlayerEndData {
  uid: string;
  player: PlayerDoc;
  hand: Card[];
}
import { buildShuffledDeck, dealRound } from "./deck.js";
import { scoreHand } from "./scoring.js";
import { logEvent } from "./log.js";

// ─── beginRound ───────────────────────────────────────────────────────────────
// Internal: transitions the game into the start-of-round offer phase.

export async function beginRound(
  gameId: string,
  game: GameDoc,
  roundNumber: number
): Promise<void> {
  const config = ROUND_CONFIGS[roundNumber - 1];

  // Determine dealer: random for round 1, rotate clockwise thereafter
  let dealerUid: string;
  if (roundNumber === 1) {
    dealerUid =
      game.turnOrder[Math.floor(Math.random() * game.turnOrder.length)];
  } else {
    const idx = game.turnOrder.indexOf(game.dealerUid);
    dealerUid = game.turnOrder[(idx + 1) % game.turnOrder.length];
  }

  // Turn order: player to LEFT of dealer goes first
  const dealerIdx = game.turnOrder.indexOf(dealerUid);
  const firstIdx = (dealerIdx + 1) % game.turnOrder.length;
  const turnOrder = [
    ...game.turnOrder.slice(firstIdx),
    ...game.turnOrder.slice(0, firstIdx),
  ];

  const deck = buildShuffledDeck(game.playerCount);
  const { hands, initialDiscard, remainingDeck } = dealRound(
    deck,
    turnOrder,
    config.cardsDealt
  );

  const batch = db.batch();

  for (const uid of turnOrder) {
    batch.set(db.doc(`games/${gameId}/hands/${uid}`), {
      hand: hands[uid],
      floatingJokers: [],
    } as HandDoc);
    batch.update(db.doc(`games/${gameId}/players/${uid}`), {
      isDown: false,
      handSize: hands[uid].length,
      roundScore: 0,
    } as Partial<PlayerDoc>);
  }

  batch.set(db.doc(`games/${gameId}/private/deck`), {
    cards: remainingDeck,
  } as DeckDoc);

  const firstPlayer = turnOrder[0];
  const offerState: OfferState = {
    card: initialDiscard,
    offeredTo: firstPlayer,
    declinedBy: [],
    isFree: true,
  };

  batch.update(db.doc(`games/${gameId}`), {
    phase: "round_start_offer",
    round: roundNumber,
    dealerUid,
    turnOrder,
    currentTurnUid: firstPlayer,
    discardPile: [initialDiscard],
    deckSize: remainingDeck.length,
    melds: [],
    offerState,
    turnState: null,
  } as Partial<GameDoc>);

  logEvent(batch, gameId, { type: "round_start", uid: "", round: roundNumber });

  await batch.commit();
}

// ─── endRound ─────────────────────────────────────────────────────────────────
// Internal: scores all players and transitions to round_end or game_over.
// Must be called from within a transaction; all reads must have been done first.

// All reads must be done before calling endRound — pass pre-fetched data.
// winnerTotalScore: the winner's current totalScore (round score is 0).
// nonWinnerData: pre-fetched hand + player docs for everyone else.
export function endRound(
  tx: FirebaseFirestore.Transaction,
  gameId: string,
  game: GameDoc,
  winnerUid: string,
  winnerTotalScore: number,
  nonWinnerData: PlayerEndData[]
): void {
  for (const { uid, hand, player } of nonWinnerData) {
    const roundScore = scoreHand(hand);
    tx.update(db.doc(`games/${gameId}/players/${uid}`), {
      roundScore,
      totalScore: player.totalScore + roundScore,
    });
  }

  tx.update(db.doc(`games/${gameId}/players/${winnerUid}`), {
    roundScore: 0,
    totalScore: winnerTotalScore,
  });

  tx.update(db.doc(`games/${gameId}`), {
    phase: game.round === 7 ? "game_over" : "round_end",
    turnState: null,
    offerState: null,
  });

  logEvent(tx, gameId, { type: "round_end", uid: winnerUid, round: game.round });
}

// ─── startNextRound ───────────────────────────────────────────────────────────
// Callable: host advances to the next round after round_end scoring is shown.

export const startNextRound = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId } = request.data as { gameId: string };

  const snap = await db.doc(`games/${gameId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Game not found.");

  const game = snap.data() as GameDoc;

  if (game.hostUid !== uid) {
    throw new HttpsError("permission-denied", "Only the host can start the next round.");
  }
  if (game.phase !== "round_end") {
    throw new HttpsError("failed-precondition", "Round has not ended yet.");
  }
  if (game.round >= 7) {
    throw new HttpsError("failed-precondition", "Game is already over.");
  }

  await beginRound(gameId, game, game.round + 1);
});

// ─── drawCardFromDeck ─────────────────────────────────────────────────────────
// Internal: pops one card from the deck, reshuffling if needed.
// Returns the drawn card and updates deck/discardPile in the transaction.

export async function drawCardFromDeck(
  tx: FirebaseFirestore.Transaction,
  gameId: string,
  discardPile: Card[]
): Promise<{ card: Card; newDeckSize: number }> {
  const deckRef = db.doc(`games/${gameId}/private/deck`);
  const deckSnap = await tx.get(deckRef);
  let { cards } = deckSnap.data() as DeckDoc;

  if (cards.length === 0) {
    // Reshuffle discard pile (keep top card)
    if (discardPile.length < 2) {
      throw new HttpsError("failed-precondition", "Deck and discard pile are both empty.");
    }
    const { reshuffleDiscardIntoDeck } = await import("./deck.js");
    const reshuffled = reshuffleDiscardIntoDeck(discardPile);
    cards = reshuffled.newDeck;
    tx.update(db.doc(`games/${gameId}`), {
      discardPile: reshuffled.newDiscardPile,
    });
  }

  const card = cards[0];
  const remaining = cards.slice(1);
  tx.update(deckRef, { cards: remaining });

  return { card, newDeckSize: remaining.length };
}
