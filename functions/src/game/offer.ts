import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { GameDoc, HandDoc, PlayerDoc } from "../../../shared/types.js";
import { previousPlayer, nextInOfferChain } from "./helpers.js";
import { drawCardFromDeck } from "./round.js";
import { logEvent } from "./log.js";

export const respondToOffer = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId, response } = request.data as {
    gameId: string;
    response: "accept" | "decline";
  };

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${gameId}`);
    const gameSnap = await tx.get(gameRef);

    if (!gameSnap.exists) throw new HttpsError("not-found", "Game not found.");

    const game = gameSnap.data() as GameDoc;

    if (
      game.phase !== "round_start_offer" &&
      game.phase !== "discard_offer"
    ) {
      throw new HttpsError("failed-precondition", "No active offer.");
    }

    const offer = game.offerState!;

    if (offer.offeredTo !== uid) {
      throw new HttpsError("failed-precondition", "This offer is not for you.");
    }

    if (response === "accept") {
      const handRef = db.doc(`games/${gameId}/hands/${uid}`);
      const handSnap = await tx.get(handRef);
      const handData = handSnap.data() as HandDoc;

      if (offer.isFree) {
        // Next player takes the discard at no cost — draw phase is satisfied
        tx.update(handRef, { hand: [...handData.hand, offer.card] });
        tx.update(db.doc(`games/${gameId}/players/${uid}`), {
          handSize: handData.hand.length + 1,
        } as Partial<PlayerDoc>);
        tx.update(gameRef, {
          phase: "turn",
          discardPile: game.discardPile.slice(1),
          offerState: null,
          turnState: { uid, phase: "action", floatingJokerCount: 0 },
          currentTurnUid: uid,
        } as Partial<GameDoc>);
        logEvent(tx, gameId, { type: "offer_accepted", uid, card: offer.card, isFree: true });
      } else {
        // Penalty taker: all reads must precede writes — drawCardFromDeck does a tx.get
        const { card: penaltyCard, newDeckSize } = await drawCardFromDeck(
          tx,
          gameId,
          game.discardPile
        );

        tx.update(handRef, {
          hand: [...handData.hand, offer.card, penaltyCard],
        });
        tx.update(db.doc(`games/${gameId}/players/${uid}`), {
          handSize: handData.hand.length + 2,
        } as Partial<PlayerDoc>);

        // Offer ends; next player (currentTurnUid) draws from deck normally
        tx.update(gameRef, {
          phase: "turn",
          discardPile: game.discardPile.slice(1),
          deckSize: newDeckSize,
          offerState: null,
          turnState: {
            uid: game.currentTurnUid,
            phase: "draw",
            floatingJokerCount: 0,
          },
        } as Partial<GameDoc>);
        logEvent(tx, gameId, { type: "offer_accepted", uid, card: offer.card, isFree: false });
      }
    } else {
      // Decline — advance the offer chain
      const newDeclinedBy = [...offer.declinedBy, uid];

      // For discard_offer: skip the player who just discarded
      const skip =
        game.phase === "discard_offer"
          ? [previousPlayer(game.turnOrder, game.currentTurnUid)]
          : [];

      const next = nextInOfferChain(
        game.turnOrder,
        uid,
        newDeclinedBy,
        skip
      );

      if (next === null) {
        // All eligible players declined; next player draws from deck
        tx.update(gameRef, {
          phase: "turn",
          offerState: null,
          turnState: {
            uid: game.currentTurnUid,
            phase: "draw",
            floatingJokerCount: 0,
          },
        } as Partial<GameDoc>);
      } else {
        tx.update(gameRef, {
          offerState: {
            ...offer,
            offeredTo: next,
            declinedBy: newDeclinedBy,
            isFree: false, // only the first offeree ever gets it free
          },
        } as Partial<GameDoc>);
      }
    }
  });
});
