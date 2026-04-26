import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { GameDoc, PlayerDoc } from "../../../shared/types.js";
import { generateGameCode } from "./helpers.js";
import { beginRound } from "./round.js";

export const createGame = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { displayName } = request.data as { displayName: string };
  if (!displayName?.trim()) {
    throw new HttpsError("invalid-argument", "Display name required.");
  }

  const gameId = generateGameCode();

  const game: GameDoc = {
    hostUid: uid,
    phase: "lobby",
    round: 0,
    dealerUid: "",
    turnOrder: [uid],
    currentTurnUid: "",
    discardPile: [],
    deckSize: 0,
    melds: [],
    offerState: null,
    turnState: null,
    playerCount: 1,
    createdAt: Date.now(),
  };

  const player: PlayerDoc = {
    uid,
    displayName: displayName.trim(),
    isDown: false,
    handSize: 0,
    roundScore: 0,
    totalScore: 0,
    seatOrder: 0,
  };

  const batch = db.batch();
  batch.set(db.doc(`games/${gameId}`), game);
  batch.set(db.doc(`games/${gameId}/players/${uid}`), player);
  await batch.commit();

  return { gameId };
});

export const joinGame = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId, displayName } = request.data as {
    gameId: string;
    displayName: string;
  };
  if (!gameId?.trim()) throw new HttpsError("invalid-argument", "Game code required.");
  if (!displayName?.trim()) throw new HttpsError("invalid-argument", "Display name required.");

  const code = gameId.trim().toUpperCase();

  await db.runTransaction(async (tx) => {
    const gameRef = db.doc(`games/${code}`);
    const snap = await tx.get(gameRef);

    if (!snap.exists) throw new HttpsError("not-found", "Game not found.");

    const game = snap.data() as GameDoc;

    if (game.phase !== "lobby") {
      throw new HttpsError("failed-precondition", "Game has already started.");
    }
    if (game.turnOrder.includes(uid)) {
      throw new HttpsError("already-exists", "Already in this game.");
    }
    if (game.playerCount >= 8) {
      throw new HttpsError("resource-exhausted", "Game is full (8 players max).");
    }

    const player: PlayerDoc = {
      uid,
      displayName: displayName.trim(),
      isDown: false,
      handSize: 0,
      roundScore: 0,
      totalScore: 0,
      seatOrder: game.playerCount,
    };

    tx.set(db.doc(`games/${code}/players/${uid}`), player);
    tx.update(gameRef, {
      turnOrder: [...game.turnOrder, uid],
      playerCount: game.playerCount + 1,
    });
  });
});

export const startGame = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be logged in.");

  const { gameId } = request.data as { gameId: string };

  const snap = await db.doc(`games/${gameId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Game not found.");

  const game = snap.data() as GameDoc;

  if (game.hostUid !== uid) {
    throw new HttpsError("permission-denied", "Only the host can start the game.");
  }
  if (game.phase !== "lobby") {
    throw new HttpsError("failed-precondition", "Game has already started.");
  }
  if (game.playerCount < 3) {
    throw new HttpsError("failed-precondition", "Need at least 3 players to start.");
  }

  await beginRound(gameId, game, 1);
});
