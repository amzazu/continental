import { setGlobalOptions } from "firebase-functions";
import "./admin.js"; // initializes Firebase Admin

setGlobalOptions({ maxInstances: 10 });

export { createGame, joinGame, startGame } from "./game/lobby.js";
export { startNextRound } from "./game/round.js";
export { respondToOffer } from "./game/offer.js";
export {
  drawCard,
  goDown,
  addToMeld,
  replaceJoker,
  placeFloatingJoker,
  discard,
} from "./game/actions.js";
