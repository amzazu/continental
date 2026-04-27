import { useAuthStore } from "./store/authStore";
import { useGameStore } from "./store/gameStore";
import Lobby from "./components/Lobby";
import Board from "./components/Board";

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

  if (game && game.phase !== "lobby") {
    return <Board />;
  }

  return <Lobby />;
}
