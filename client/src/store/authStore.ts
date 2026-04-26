import { create } from "zustand";
import {
  signInAnonymously,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { auth } from "../lib/firebase";

const DISPLAY_NAME_KEY = "continental_display_name";

interface AuthState {
  user: User | null;
  loading: boolean;
  displayName: string;
  init: () => () => void;
  signIn: () => Promise<void>;
  setDisplayName: (name: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  displayName: localStorage.getItem(DISPLAY_NAME_KEY) ?? "",

  // Call once at app startup. Returns the Firebase unsubscribe function.
  init: () =>
    onAuthStateChanged(auth, (user) => {
      set({ user, loading: false });
    }),

  signIn: async () => {
    await signInAnonymously(auth);
  },

  setDisplayName: (name) => {
    localStorage.setItem(DISPLAY_NAME_KEY, name);
    set({ displayName: name });
  },
}));
