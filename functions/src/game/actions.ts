import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  Card,
  GameDoc,
  HandDoc,
  PlayerDoc,
  Meld,
  ROUND_CONFIGS,
} from "../../../shared/types.js";
import { validateContract, validateAddToMeld, validateReplaceJoker } from "./meld-validator.js";
import { drawCardFromDeck, endRound } from "./round.js";
import { nextPlayer } from "./helpers.js";

// ─── drawCard ─────────────────────────────────────────────────────────────────

export const drawCard = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId } = request.data as { gameId: string };

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${gameId}`);
    const handRef = db.doc(`games/${gameId}/hands/${uid}`);

    const [gameSnap, handSnap] = await Promise.all([
      tx.get(gameRef),
      tx.get(handRef),
    ]);

    const game = gameSnap.data() as GameDoc;
    const handData = handSnap.data() as HandDoc;

    if (game.phase !== "turn") throw new HttpsError("failed-precondition", "Not in turn phase.");
    if (game.turnState?.uid !== uid) throw new HttpsError("failed-precondition", "Not your turn.");
    if (game.turnState.phase !== "draw") throw new HttpsError("failed-precondition", "Already drew this turn.");

    const { card, newDeckSize } = await drawCardFromDeck(tx, gameId, game.discardPile);

    tx.update(handRef, { hand: [...handData.hand, card] });
    tx.update(db.doc(`games/${gameId}/players/${uid}`), {
      handSize: handData.hand.length + 1,
    } as Partial<PlayerDoc>);
    tx.update(gameRef, {
      deckSize: newDeckSize,
      turnState: { uid, phase: "action", floatingJokerCount: 0 },
    } as Partial<GameDoc>);
  });
});

// ─── goDown ───────────────────────────────────────────────────────────────────

export const goDown = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId, cardGroups } = request.data as {
    gameId: string;
    cardGroups: string[][];
  };

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${gameId}`);
    const handRef = db.doc(`games/${gameId}/hands/${uid}`);
    const playerRef = db.doc(`games/${gameId}/players/${uid}`);

    const [gameSnap, handSnap, playerSnap] = await Promise.all([
      tx.get(gameRef),
      tx.get(handRef),
      tx.get(playerRef),
    ]);

    const game = gameSnap.data() as GameDoc;
    const handData = handSnap.data() as HandDoc;
    const playerData = playerSnap.data() as PlayerDoc;

    if (game.phase !== "turn") throw new HttpsError("failed-precondition", "Not in turn phase.");
    if (game.turnState?.uid !== uid) throw new HttpsError("failed-precondition", "Not your turn.");
    if (game.turnState.phase === "draw") throw new HttpsError("failed-precondition", "Must draw first.");
    if (playerData.isDown) throw new HttpsError("failed-precondition", "Already down.");

    // Resolve card IDs → card objects from hand
    const handById = new Map(handData.hand.map((c) => [c.id, c]));
    const groups: Card[][] = cardGroups.map((group, i) =>
      group.map((id) => {
        const card = handById.get(id);
        if (!card) throw new HttpsError("invalid-argument", `Card ${id} not in hand (group ${i + 1}).`);
        return card;
      })
    );

    // Validate against round contract
    const config = ROUND_CONFIGS[game.round - 1];
    const validation = validateContract(groups, config.requirements);
    if (!validation.valid) {
      throw new HttpsError("invalid-argument", validation.error!);
    }

    // Check no card is used twice
    const usedIds = new Set<string>();
    for (const group of cardGroups) {
      for (const id of group) {
        if (usedIds.has(id)) throw new HttpsError("invalid-argument", "Duplicate card in melds.");
        usedIds.add(id);
      }
    }

    const handAfterDown = handData.hand.filter((c) => !usedIds.has(c.id));

    // Build meld objects
    const newMelds: Meld[] = [
      ...game.melds,
      ...validation.validatedMelds!.map((v) => ({
        ...v.meld,
        id: db.collection("_").doc().id, // generate unique ID
        ownerUid: uid,
      } as Meld)),
    ];

    if (handAfterDown.length === 1) {
      // Auto-discard last card and end the round
      const discardCard = handAfterDown[0];

      tx.update(handRef, { hand: [], floatingJokers: [] });
      tx.update(playerRef, { isDown: true, handSize: 0 });
      tx.update(gameRef, {
        melds: newMelds,
        discardPile: [discardCard, ...game.discardPile],
      } as Partial<GameDoc>);

      await endRound(tx, gameId, game, uid);
    } else {
      tx.update(handRef, { hand: handAfterDown });
      tx.update(playerRef, { isDown: true, handSize: handAfterDown.length });
      tx.update(gameRef, {
        melds: newMelds,
        turnState: { uid, phase: "action", floatingJokerCount: 0 },
      } as Partial<GameDoc>);
    }
  });
});

// ─── addToMeld ────────────────────────────────────────────────────────────────

export const addToMeld = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId, meldId, cardIds } = request.data as {
    gameId: string;
    meldId: string;
    cardIds: string[];
  };

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${gameId}`);
    const handRef = db.doc(`games/${gameId}/hands/${uid}`);
    const playerRef = db.doc(`games/${gameId}/players/${uid}`);

    const [gameSnap, handSnap, playerSnap] = await Promise.all([
      tx.get(gameRef),
      tx.get(handRef),
      tx.get(playerRef),
    ]);

    const game = gameSnap.data() as GameDoc;
    const handData = handSnap.data() as HandDoc;
    const playerData = playerSnap.data() as PlayerDoc;

    if (game.phase !== "turn") throw new HttpsError("failed-precondition", "Not in turn phase.");
    if (game.turnState?.uid !== uid) throw new HttpsError("failed-precondition", "Not your turn.");
    if (game.turnState.phase === "draw") throw new HttpsError("failed-precondition", "Must draw first.");
    if (!playerData.isDown) throw new HttpsError("failed-precondition", "Must go down before building on melds.");

    const meldIdx = game.melds.findIndex((m) => m.id === meldId);
    if (meldIdx === -1) throw new HttpsError("not-found", "Meld not found.");

    // Resolve card IDs
    const handById = new Map(handData.hand.map((c) => [c.id, c]));
    const cards: Card[] = cardIds.map((id) => {
      const card = handById.get(id);
      if (!card) throw new HttpsError("invalid-argument", `Card ${id} not in hand.`);
      return card;
    });

    const result = validateAddToMeld(game.melds[meldIdx], cards);
    if (!result.valid) throw new HttpsError("invalid-argument", result.error);

    const usedIds = new Set(cardIds);
    const newHand = handData.hand.filter((c) => !usedIds.has(c.id));
    const newMelds = [...game.melds];
    newMelds[meldIdx] = result.updatedMeld;

    tx.update(handRef, { hand: newHand });
    tx.update(playerRef, { handSize: newHand.length } as Partial<PlayerDoc>);
    tx.update(gameRef, { melds: newMelds } as Partial<GameDoc>);
  });
});

// ─── replaceJoker ─────────────────────────────────────────────────────────────

export const replaceJoker = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId, meldId, jokerCardId, naturalCardId } = request.data as {
    gameId: string;
    meldId: string;
    jokerCardId: string;
    naturalCardId: string;
  };

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${gameId}`);
    const handRef = db.doc(`games/${gameId}/hands/${uid}`);
    const playerRef = db.doc(`games/${gameId}/players/${uid}`);

    const [gameSnap, handSnap, playerSnap] = await Promise.all([
      tx.get(gameRef),
      tx.get(handRef),
      tx.get(playerRef),
    ]);

    const game = gameSnap.data() as GameDoc;
    const handData = handSnap.data() as HandDoc;
    const playerData = playerSnap.data() as PlayerDoc;

    if (game.phase !== "turn") throw new HttpsError("failed-precondition", "Not in turn phase.");
    if (game.turnState?.uid !== uid) throw new HttpsError("failed-precondition", "Not your turn.");
    if (game.turnState.phase === "draw") throw new HttpsError("failed-precondition", "Must draw first.");
    if (!playerData.isDown) throw new HttpsError("failed-precondition", "Must be down to replace jokers.");

    // Must have at least 2 cards in hand: one to replace the joker, one to discard
    if (handData.hand.length < 2) {
      throw new HttpsError(
        "failed-precondition",
        "Need at least 2 cards in hand to replace a joker (one for the swap, one to discard)."
      );
    }

    const meldIdx = game.melds.findIndex((m) => m.id === meldId);
    if (meldIdx === -1) throw new HttpsError("not-found", "Meld not found.");

    const naturalCard = handData.hand.find((c) => c.id === naturalCardId);
    if (!naturalCard) throw new HttpsError("invalid-argument", "Natural card not in hand.");

    const result = validateReplaceJoker(game.melds[meldIdx], jokerCardId, naturalCard);
    if (!result.valid) throw new HttpsError("invalid-argument", result.error);

    // Remove natural card from hand, add floating joker
    const newHand = handData.hand.filter((c) => c.id !== naturalCardId);
    const newFloatingJokers = [...handData.floatingJokers, result.joker];

    const newMelds = [...game.melds];
    newMelds[meldIdx] = result.updatedMeld;

    tx.update(handRef, { hand: newHand, floatingJokers: newFloatingJokers });
    tx.update(playerRef, { handSize: newHand.length } as Partial<PlayerDoc>);
    tx.update(gameRef, {
      melds: newMelds,
      turnState: {
        ...game.turnState!,
        floatingJokerCount: newFloatingJokers.length,
      },
    } as Partial<GameDoc>);
  });
});

// ─── placeFloatingJoker ───────────────────────────────────────────────────────
// Places a floating joker (obtained via replaceJoker) onto an existing meld.

export const placeFloatingJoker = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId, jokerCardId, meldId } = request.data as {
    gameId: string;
    jokerCardId: string;
    meldId: string;
  };

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${gameId}`);
    const handRef = db.doc(`games/${gameId}/hands/${uid}`);
    const playerRef = db.doc(`games/${gameId}/players/${uid}`);

    const [gameSnap, handSnap, playerSnap] = await Promise.all([
      tx.get(gameRef),
      tx.get(handRef),
      tx.get(playerRef),
    ]);

    const game = gameSnap.data() as GameDoc;
    const handData = handSnap.data() as HandDoc;
    const playerData = playerSnap.data() as PlayerDoc;

    if (game.phase !== "turn") throw new HttpsError("failed-precondition", "Not in turn phase.");
    if (game.turnState?.uid !== uid) throw new HttpsError("failed-precondition", "Not your turn.");
    if (!playerData.isDown) throw new HttpsError("failed-precondition", "Must be down.");

    const joker = handData.floatingJokers.find((c) => c.id === jokerCardId);
    if (!joker) throw new HttpsError("not-found", "Floating joker not found.");

    const meldIdx = game.melds.findIndex((m) => m.id === meldId);
    if (meldIdx === -1) throw new HttpsError("not-found", "Meld not found.");

    const result = validateAddToMeld(game.melds[meldIdx], [joker]);
    if (!result.valid) throw new HttpsError("invalid-argument", result.error);

    const newFloatingJokers = handData.floatingJokers.filter(
      (c) => c.id !== jokerCardId
    );
    const newMelds = [...game.melds];
    newMelds[meldIdx] = result.updatedMeld;

    tx.update(handRef, { floatingJokers: newFloatingJokers });
    tx.update(playerRef, { handSize: handData.hand.length } as Partial<PlayerDoc>);
    tx.update(gameRef, {
      melds: newMelds,
      turnState: {
        ...game.turnState!,
        floatingJokerCount: newFloatingJokers.length,
      },
    } as Partial<GameDoc>);
  });
});

// ─── discard ──────────────────────────────────────────────────────────────────

export const discard = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId, cardId } = request.data as { gameId: string; cardId: string };

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${gameId}`);
    const handRef = db.doc(`games/${gameId}/hands/${uid}`);
    const playerRef = db.doc(`games/${gameId}/players/${uid}`);

    const [gameSnap, handSnap, playerSnap] = await Promise.all([
      tx.get(gameRef),
      tx.get(handRef),
      tx.get(playerRef),
    ]);

    const game = gameSnap.data() as GameDoc;
    const handData = handSnap.data() as HandDoc;
    const playerData = playerSnap.data() as PlayerDoc;

    if (game.phase !== "turn") throw new HttpsError("failed-precondition", "Not in turn phase.");
    if (game.turnState?.uid !== uid) throw new HttpsError("failed-precondition", "Not your turn.");
    if (game.turnState.phase === "draw") throw new HttpsError("failed-precondition", "Must draw first.");
    if (game.turnState.floatingJokerCount > 0) {
      throw new HttpsError(
        "failed-precondition",
        "Must place all floating jokers before discarding."
      );
    }

    const cardIdx = handData.hand.findIndex((c) => c.id === cardId);
    if (cardIdx === -1) throw new HttpsError("not-found", "Card not in hand.");

    const card = handData.hand[cardIdx];
    const newHand = handData.hand.filter((_, i) => i !== cardIdx);
    const newDiscardPile = [card, ...game.discardPile];

    if (playerData.isDown && newHand.length === 0) {
      // Going out — end the round
      tx.update(handRef, { hand: [], floatingJokers: [] });
      tx.update(playerRef, { handSize: 0 } as Partial<PlayerDoc>);
      tx.update(gameRef, { discardPile: newDiscardPile } as Partial<GameDoc>);

      await endRound(tx, gameId, game, uid);
    } else {
      // Normal discard — start offer chain for next player
      const nextUid = nextPlayer(game.turnOrder, uid);

      tx.update(handRef, { hand: newHand });
      tx.update(playerRef, { handSize: newHand.length } as Partial<PlayerDoc>);
      tx.update(gameRef, {
        phase: "discard_offer",
        discardPile: newDiscardPile,
        currentTurnUid: nextUid,
        turnState: null,
        offerState: {
          card,
          offeredTo: nextUid,
          declinedBy: [],
          isFree: true,
        },
      } as Partial<GameDoc>);
    }
  });
});
