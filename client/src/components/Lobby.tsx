import { useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useGameStore } from "../store/gameStore";
import * as fns from "../lib/functions";

type Screen = "home" | "joining" | "waiting";

export default function Lobby() {
  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const setDisplayName = useAuthStore((s) => s.setDisplayName);

  const gameId = useGameStore((s) => s.gameId);
  const game = useGameStore((s) => s.game);
  const players = useGameStore((s) => s.players);
  const subscribe = useGameStore((s) => s.subscribe);
  const unsubscribe = useGameStore((s) => s.unsubscribe);

  const [screen, setScreen] = useState<Screen>("home");
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const sortedPlayers = Object.values(players).sort(
    (a, b) => a.seatOrder - b.seatOrder
  );
  const isHost = game?.hostUid === user?.uid;
  const canStart = sortedPlayers.length >= 3;
  const needed = Math.max(0, 3 - sortedPlayers.length);

  function validateName(): boolean {
    if (!displayName.trim()) {
      setError("Please enter your name before continuing.");
      return false;
    }
    return true;
  }

  async function handleCreate() {
    if (!validateName()) return;
    setError("");
    setBusy(true);
    try {
      const result = await fns.createGame({ displayName: displayName.trim() });
      subscribe(result.data.gameId, user!.uid);
      setScreen("waiting");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create game.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!validateName()) return;
    if (!codeInput.trim()) {
      setError("Please enter a game code.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const code = codeInput.trim().toUpperCase();
      await fns.joinGame({ gameId: code, displayName: displayName.trim() });
      subscribe(code, user!.uid);
      setScreen("waiting");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Game not found. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!gameId) return;
    setError("");
    setBusy(true);
    try {
      await fns.startGame({ gameId });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start game.");
      setBusy(false);
    }
    // If successful, App.tsx detects the phase change and unmounts the lobby
  }

  function handleLeave() {
    unsubscribe();
    setScreen("home");
    setCodeInput("");
    setError("");
  }

  async function handleCopyCode() {
    if (!gameId) return;
    await navigator.clipboard.writeText(gameId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Home ──────────────────────────────────────────────────────────────────

  if (screen === "home") {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <Header />
          <div className="lobby-form">
            <label className="field">
              <span>Your name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Enter your name"
                maxLength={24}
                autoFocus
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="btn-stack">
              <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
                Create Game
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setError(""); setScreen("joining"); }}
                disabled={busy}
              >
                Join Game
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Join ──────────────────────────────────────────────────────────────────

  if (screen === "joining") {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <Header />
          <div className="lobby-form">
            <label className="field">
              <span>Game code</span>
              <input
                className="code-input"
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                placeholder="ABC123"
                maxLength={6}
                autoFocus
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="btn-stack">
              <button className="btn btn-primary" onClick={handleJoin} disabled={busy}>
                Join
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => { setError(""); setScreen("home"); }}
                disabled={busy}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Waiting room ──────────────────────────────────────────────────────────

  return (
    <div className="lobby">
      <div className="lobby-card">
        <Header />

        <div className="code-block">
          <div>
            <div className="code-label">Game code</div>
            <div className="code-value">{gameId}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleCopyCode}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>

        <div className="player-list">
          <div className="player-list-heading">
            Players&nbsp;
            <span className="player-count">
              {sortedPlayers.length}/8
              {needed > 0 && (
                <> &mdash; need {needed} more to start</>
              )}
            </span>
          </div>
          <ul>
            {sortedPlayers.map((p) => (
              <li key={p.uid} className={p.uid === game?.hostUid ? "is-host" : ""}>
                <span className="player-name">{p.displayName}</span>
                {p.uid === game?.hostUid && (
                  <span className="host-badge">host</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="btn-stack">
          {isHost ? (
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={busy || !canStart}
            >
              {canStart ? "Start Game" : `Waiting for ${needed} more player${needed !== 1 ? "s" : ""}…`}
            </button>
          ) : (
            <p className="waiting-hint">Waiting for the host to start…</p>
          )}
          <button className="btn btn-ghost" onClick={handleLeave} disabled={busy}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="lobby-header">
      <h1>Continental</h1>
      <p className="memorial">In loving memory of Abuela Conchita</p>
    </header>
  );
}
