import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

// Typed wrappers around each Cloud Function callable.
// The client sends IDs; the server resolves card data from Firestore.

export const createGame = httpsCallable<
  { displayName: string },
  { gameId: string }
>(functions, "createGame");

export const joinGame = httpsCallable<
  { gameId: string; displayName: string },
  void
>(functions, "joinGame");

export const startGame = httpsCallable<{ gameId: string }, void>(
  functions,
  "startGame"
);

export const startNextRound = httpsCallable<{ gameId: string }, void>(
  functions,
  "startNextRound"
);

export const respondToOffer = httpsCallable<
  { gameId: string; response: "accept" | "decline" },
  void
>(functions, "respondToOffer");

export const drawCard = httpsCallable<{ gameId: string }, void>(
  functions,
  "drawCard"
);

// cardGroups: array of groups, each group is an array of card IDs
export const goDown = httpsCallable<
  { gameId: string; cardGroups: string[][] },
  void
>(functions, "goDown");

export const addToMeld = httpsCallable<
  { gameId: string; meldId: string; cardIds: string[] },
  void
>(functions, "addToMeld");

export const replaceJoker = httpsCallable<
  { gameId: string; meldId: string; jokerCardId: string; naturalCardId: string },
  void
>(functions, "replaceJoker");

export const placeFloatingJoker = httpsCallable<
  { gameId: string; jokerCardId: string; meldId: string },
  void
>(functions, "placeFloatingJoker");

export const discard = httpsCallable<
  { gameId: string; cardId: string },
  void
>(functions, "discard");
