import { create } from "zustand";
import { signInAnonymously, onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../lib/firebase";

const DISPLAY_NAME_KEY = "continental_display_name";

interface AuthState {
  user: User | null;
  loading: boolean;
  displayName: string;
  init: () => () => void;
  setDisplayName: (name: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  displayName: localStorage.getItem(DISPLAY_NAME_KEY) ?? "",

  init: () =>
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        set({ user, loading: false });
      } else {
        // No session — create an anonymous one silently
        try {
          await signInAnonymously(auth);
          // onAuthStateChanged fires again with the new user
        } catch {
          set({ loading: false });
        }
      }
    }),

  setDisplayName: (name) => {
    localStorage.setItem(DISPLAY_NAME_KEY, name);
    set({ displayName: name });
  },
}));
