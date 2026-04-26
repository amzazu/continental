import { create } from "zustand";
import {
  doc,
  collection,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { GameDoc, PlayerDoc, HandDoc } from "@shared/types";

interface GameState {
  gameId: string | null;
  game: GameDoc | null;
  players: Record<string, PlayerDoc>; // uid → PlayerDoc
  myHand: HandDoc | null;

  subscribe: (gameId: string, myUid: string) => void;
  unsubscribe: () => void;
}

// Kept outside Zustand state so unsubscribe functions don't cause re-renders
let _unsubs: Unsubscribe[] = [];

export const useGameStore = create<GameState>((set) => ({
  gameId: null,
  game: null,
  players: {},
  myHand: null,

  subscribe: (gameId, myUid) => {
    // Clean up any existing listeners first
    _unsubs.forEach((fn) => fn());
    _unsubs = [];

    set({ gameId, game: null, players: {}, myHand: null });

    // 1. Main game document
    _unsubs.push(
      onSnapshot(doc(db, "games", gameId), (snap) => {
        set({ game: snap.exists() ? (snap.data() as GameDoc) : null });
      })
    );

    // 2. All player docs (public info for every seat)
    _unsubs.push(
      onSnapshot(collection(db, "games", gameId, "players"), (snap) => {
        const players: Record<string, PlayerDoc> = {};
        snap.docs.forEach((d) => {
          players[d.id] = d.data() as PlayerDoc;
        });
        set({ players });
      })
    );

    // 3. Our own hand (private)
    _unsubs.push(
      onSnapshot(doc(db, "games", gameId, "hands", myUid), (snap) => {
        set({ myHand: snap.exists() ? (snap.data() as HandDoc) : null });
      })
    );
  },

  unsubscribe: () => {
    _unsubs.forEach((fn) => fn());
    _unsubs = [];
    set({ gameId: null, game: null, players: {}, myHand: null });
  },
}));
