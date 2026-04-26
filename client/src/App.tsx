import { useAuthStore } from "./store/authStore";
import { useGameStore } from "./store/gameStore";
import Lobby from "./components/Lobby";

export default function App() {
  const loading = useAuthStore((s) => s.loading);
  const game = useGameStore((s) => s.game);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
      </div>
    );
  }

  // Once the game is active the lobby hands off to the game board (coming soon)
  if (game && game.phase !== "lobby") {
    return (
      <div className="app-loading">
        <p>Game starting… (board coming soon)</p>
      </div>
    );
  }

  return <Lobby />;
}
