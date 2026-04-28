import { useState, useMemo, useEffect, useRef } from "react";
import { useAuthStore } from "../store/authStore";
import { useGameStore } from "../store/gameStore";
import * as fns from "../lib/functions";
import { ROUND_CONFIGS, type Card, type Meld, type PlayerDoc, type LogEntry } from "@shared/types";

// ── Suit helpers ──────────────────────────────────────────────────────────────

const SUIT_SYM: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

function cardLabel(card: Card): string {
  return card.rank === "JOKER" ? "Joker" : `${card.rank}${SUIT_SYM[card.suit] ?? ""}`;
}

// ── PlayingCard ───────────────────────────────────────────────────────────────

function PlayingCard({
  card,
  selected = false,
  faded = false,
  glow = false,
  small = false,
  onClick,
}: {
  card: Card;
  selected?: boolean;
  faded?: boolean;
  glow?: boolean;
  small?: boolean;
  onClick?: () => void;
}) {
  const isJoker = card.rank === "JOKER";
  const isRed = card.suit === "H" || card.suit === "D";
  const cls = [
    "pcard",
    small ? "pcard-sm" : "",
    isJoker ? "pcard-joker" : isRed ? "pcard-red" : "pcard-black",
    selected && "pcard-selected",
    faded && "pcard-faded",
    glow && "pcard-glow",
    onClick && "pcard-clickable",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = isJoker ? (
    <>
      <span className="pcard-rank">★</span>
      <span className="pcard-suit">JKR</span>
    </>
  ) : (
    <>
      <span className="pcard-rank">{card.rank}</span>
      <span className="pcard-suit">{SUIT_SYM[card.suit]}</span>
    </>
  );

  return onClick ? (
    <button className={cls} onClick={onClick} type="button">
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function CardBack({ tiny = false }: { tiny?: boolean }) {
  return <div className={`pcard pcard-back${tiny ? " pcard-tiny" : ""}`} />;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type UiMode = "normal" | "goDown" | "addToMeld" | "replaceJoker" | "placeJoker";

// ── Board ─────────────────────────────────────────────────────────────────────

export default function Board() {
  const myUid = useAuthStore((s) => s.user?.uid);
  const gameId = useGameStore((s) => s.gameId);
  const game = useGameStore((s) => s.game);
  const players = useGameStore((s) => s.players);
  const myHand = useGameStore((s) => s.myHand);
  const lastEvent = useGameStore((s) => s.lastEvent);

  const [uiMode, setUiMode] = useState<UiMode>("normal");
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [goDownGroups, setGoDownGroups] = useState<string[][]>([]);
  const [activeGroup, setActiveGroup] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handOrder, setHandOrder] = useState<string[]>([]);
  const dragSrcId = useRef<string | null>(null);

  const hand = myHand?.hand ?? [];

  // Keep display order in sync: preserve existing positions, append new cards at end
  useEffect(() => {
    setHandOrder((prev) => {
      const handIds = new Set(hand.map((c) => c.id));
      const kept = prev.filter((id) => handIds.has(id));
      const added = hand.filter((c) => !prev.includes(c.id)).map((c) => c.id);
      return [...kept, ...added];
    });
  }, [hand]);

  if (!game || !gameId || !myUid) return null;
  const gid = gameId; // narrowed from string | null — safe to use in closures

  const roundConfig = ROUND_CONFIGS[game.round - 1];
  const myPlayer = players[myUid];
  const isMyTurn = game.turnState?.uid === myUid;
  const turnPhase = game.turnState?.phase;
  const isDown = myPlayer?.isDown ?? false;
  const floatingJokers = myHand?.floatingJokers ?? [];
  const floatingJokerCount = game.turnState?.floatingJokerCount ?? 0;
  const topDiscard = game.discardPile[0] ?? null;

  const orderedHand = handOrder
    .map((id) => hand.find((c) => c.id === id))
    .filter((c): c is Card => c !== undefined);

  const isMyOffer =
    (game.phase === "round_start_offer" || game.phase === "discard_offer") &&
    game.offerState?.offeredTo === myUid;

  const isMyActionTurn = isMyTurn && turnPhase !== "draw";
  const isMyDrawTurn = isMyTurn && turnPhase === "draw";

  const sortedPlayers = useMemo(
    () => Object.values(players).sort((a, b) => a.seatOrder - b.seatOrder),
    [players]
  );
  const otherPlayers = sortedPlayers.filter((p) => p.uid !== myUid);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function resetUiMode() {
    setUiMode("normal");
    setSelectedCardIds(new Set());
    setGoDownGroups([]);
    setActiveGroup(0);
    setError("");
  }

  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      resetUiMode();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function handleToggleCard(cardId: string) {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleRespondToOffer(response: "accept" | "decline") {
    await withBusy(() => fns.respondToOffer({ gameId: gid, response }));
  }

  async function handleDraw() {
    await withBusy(() => fns.drawCard({ gameId: gid }));
  }

  async function handleDiscard(cardId: string) {
    await withBusy(() => fns.discard({ gameId: gid, cardId }));
  }

  // ── Go Down ───────────────────────────────────────────────────────────────

  function enterGoDown() {
    setGoDownGroups(roundConfig.requirements.map(() => [] as string[]));
    setActiveGroup(0);
    setSelectedCardIds(new Set());
    setUiMode("goDown");
    setError("");
  }

  function toggleCardInGoDown(cardId: string) {
    setGoDownGroups((prev) => {
      const next = prev.map((g) => [...g]);
      const existingIdx = next.findIndex((g) => g.includes(cardId));
      if (existingIdx === activeGroup) {
        next[activeGroup] = next[activeGroup].filter((id) => id !== cardId);
      } else if (existingIdx >= 0) {
        next[existingIdx] = next[existingIdx].filter((id) => id !== cardId);
        next[activeGroup] = [...next[activeGroup], cardId];
      } else {
        next[activeGroup] = [...next[activeGroup], cardId];
      }
      return next;
    });
  }

  async function handleSubmitGoDown() {
    await withBusy(() => fns.goDown({ gameId: gid, cardGroups: goDownGroups }));
  }

  // ── Add to Meld ───────────────────────────────────────────────────────────

  function enterAddToMeld() {
    if (selectedCardIds.size === 0) {
      setError("Select one or more cards from your hand first.");
      return;
    }
    setUiMode("addToMeld");
    setError("");
  }

  async function handleClickMeldForAdd(meldId: string) {
    await withBusy(() =>
      fns.addToMeld({ gameId: gid, meldId, cardIds: Array.from(selectedCardIds) })
    );
  }

  // ── Replace Joker ─────────────────────────────────────────────────────────

  function enterReplaceJoker() {
    if (selectedCardIds.size !== 1) {
      setError("Select exactly one card from your hand to use as replacement.");
      return;
    }
    setUiMode("replaceJoker");
    setError("");
  }

  async function handleClickJokerInMeld(meldId: string, jokerCardId: string) {
    const [naturalCardId] = selectedCardIds;
    await withBusy(() =>
      fns.replaceJoker({ gameId: gid, meldId, jokerCardId, naturalCardId })
    );
  }

  // ── Place Floating Joker ──────────────────────────────────────────────────

  function enterPlaceJoker(jokerCardId: string) {
    setSelectedCardIds(new Set([jokerCardId]));
    setUiMode("placeJoker");
    setError("");
  }

  async function handleClickMeldForJoker(meldId: string) {
    const [jokerCardId] = selectedCardIds;
    await withBusy(() => fns.placeFloatingJoker({ gameId: gid, jokerCardId, meldId }));
  }

  // ── Round progression ─────────────────────────────────────────────────────

  async function handleStartNextRound() {
    await withBusy(() => fns.startNextRound({ gameId: gid }));
  }

  // ── Status text ───────────────────────────────────────────────────────────

  function getStatusText(): string {
    if (!game) return "";
    if (game.phase === "round_start_offer" || game.phase === "discard_offer") {
      const offer = game.offerState;
      if (!offer) return "";
      const card = cardLabel(offer.card);
      if (isMyOffer) {
        return offer.isFree
          ? `You're offered the ${card} — free!`
          : `You can take the ${card} (penalty: also draw from deck)`;
      }
      const name = players[offer.offeredTo]?.displayName ?? "Someone";
      return `Offering ${card} to ${name}…`;
    }
    if (game.phase === "turn" && game.turnState) {
      if (isMyTurn) {
        if (turnPhase === "draw") return "Your turn — draw a card to begin";
        if (floatingJokerCount > 0)
          return `Place your floating joker${floatingJokerCount > 1 ? "s" : ""} before discarding`;
        return "Your turn";
      }
      const name = players[game.turnState.uid]?.displayName ?? "Someone";
      return `${name}'s turn`;
    }
    if (game.phase === "round_end") return "Round over — review scores";
    if (game.phase === "game_over") return "Game over!";
    return "";
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const cardsInGroups = new Set(goDownGroups.flat());
  const handById = new Map(hand.map((c) => [c.id, c]));
  const selectedArr = Array.from(selectedCardIds);
  const selectedCard = selectedArr.length === 1
    ? hand.find((c) => c.id === selectedArr[0])
    : undefined;

  // ── Round end / Game over ─────────────────────────────────────────────────

  if (game.phase === "round_end" || game.phase === "game_over") {
    const isGameOver = game.phase === "game_over";
    const ranked = [...sortedPlayers].sort((a, b) => a.totalScore - b.totalScore);
    const isHost = game.hostUid === myUid;

    return (
      <div className="board-overlay">
        <div className="board-overlay-card">
          <h2 className="board-overlay-title">
            {isGameOver ? "Game Over" : `Round ${game.round} Complete`}
          </h2>
          {!isGameOver && (
            <p className="board-overlay-subtitle">Scores for this round:</p>
          )}
          <table className="score-table">
            <thead>
              <tr>
                <th>Player</th>
                {!isGameOver && <th>Round</th>}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => (
                <tr key={p.uid} className={p.uid === myUid ? "score-me" : ""}>
                  <td>
                    {isGameOver && i === 0 && "🏆 "}
                    {p.displayName}
                    {p.uid === myUid && " (you)"}
                  </td>
                  {!isGameOver && <td className="score-num">{p.roundScore}</td>}
                  <td className="score-num">{p.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p className="form-error">{error}</p>}
          {!isGameOver &&
            (isHost ? (
              <button
                className="btn btn-primary"
                onClick={handleStartNextRound}
                disabled={busy}
                style={{ marginTop: "1.25rem", width: "100%" }}
              >
                Start Round {game.round + 1}
              </button>
            ) : (
              <p className="waiting-hint" style={{ marginTop: "1rem" }}>
                Waiting for the host to start the next round…
              </p>
            ))}
        </div>
      </div>
    );
  }

  // ── Main board ────────────────────────────────────────────────────────────

  return (
    <div className="board">

      {/* Status bar */}
      <div className="board-status-bar">
        <div className="board-round-info">
          <span className="board-round-num">Round {game.round}</span>
          <div className="board-req-badges">
            {roundConfig.requirements.map((r, i) => (
              <span key={i} className="req-badge">
                {r.type === "trio" ? "Trio" : "Straight"}
              </span>
            ))}
          </div>
        </div>
        <div className="board-status-msg">{getStatusText()}</div>
      </div>

      {/* Other players */}
      {otherPlayers.length > 0 && (
        <div className="board-players">
          {otherPlayers.map((p) => (
            <PlayerChip
              key={p.uid}
              player={p}
              isActive={
                game.turnState?.uid === p.uid ||
                game.offerState?.offeredTo === p.uid
              }
              isDealer={p.uid === game.dealerUid}
            />
          ))}
        </div>
      )}

      {/* Table */}
      <div className="board-table">
        <div className="table-piles">
          <div className="table-pile">
            <div className="pile-label">Deck</div>
            <CardBack />
            <div className="pile-count">{game.deckSize}</div>
          </div>
          <div className="table-pile">
            <div className="pile-label">Discard</div>
            {topDiscard ? (
              <PlayingCard card={topDiscard} />
            ) : (
              <div className="pile-empty">—</div>
            )}
          </div>
        </div>

        {game.melds.length > 0 && (
          <div className="table-melds-section">
            <div className="table-melds-heading">Table</div>
            <div className="table-melds-list">
              {game.melds.map((meld) => (
                <MeldView
                  key={meld.id}
                  meld={meld}
                  players={players}
                  uiMode={uiMode}
                  onClickMeld={() => {
                    if (uiMode === "addToMeld") handleClickMeldForAdd(meld.id);
                    else if (uiMode === "placeJoker") handleClickMeldForJoker(meld.id);
                  }}
                  onClickJoker={(jokerCardId) =>
                    handleClickJokerInMeld(meld.id, jokerCardId)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Last event ticker */}
      <LastEvent entry={lastEvent} players={players} myUid={myUid ?? ""} />

      {/* Hand area */}
      <div className="board-hand-area">

        {/* Floating jokers */}
        {floatingJokers.length > 0 && (
          <div className="floating-jokers-strip">
            <span className="fj-label">
              Place {floatingJokers.length > 1 ? "these jokers" : "this joker"}:
            </span>
            {floatingJokers.map((jkr) => (
              <PlayingCard
                key={jkr.id}
                card={jkr}
                selected={selectedCardIds.has(jkr.id)}
                onClick={isMyActionTurn ? () => enterPlaceJoker(jkr.id) : undefined}
              />
            ))}
          </div>
        )}

        {/* Go-down panel */}
        {uiMode === "goDown" && (
          <div className="godown-panel">
            <div className="godown-groups">
              {goDownGroups.map((group, gi) => (
                <button
                  key={gi}
                  className={`godown-group ${gi === activeGroup ? "godown-group-active" : ""}`}
                  onClick={() => setActiveGroup(gi)}
                  type="button"
                >
                  <div className="godown-group-label">
                    {roundConfig.requirements[gi].type === "trio" ? "Trio" : "Straight"} {gi + 1}
                    {gi === activeGroup && (
                      <span className="godown-active-hint"> ← active</span>
                    )}
                  </div>
                  <div className="godown-group-cards">
                    {group.length === 0 ? (
                      <span className="godown-empty-hint">tap cards below</span>
                    ) : (
                      group.map((id) => {
                        const c = handById.get(id);
                        return c ? (
                          <PlayingCard key={id} card={c} selected small />
                        ) : null;
                      })
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div className="godown-footer">
              {error && <p className="form-error">{error}</p>}
              <div className="action-row">
                <button className="btn btn-primary" onClick={handleSubmitGoDown} disabled={busy}>
                  Go Down
                </button>
                <button className="btn btn-ghost" onClick={resetUiMode} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Hand label */}
        <div className="hand-label-row">
          <span className="hand-label">Your hand ({hand.length})</span>
          <div className="hand-label-badges">
            {isDown && <span className="you-down-badge">DOWN</span>}
            {myPlayer?.uid === game.dealerUid && (
              <span className="dealer-badge">Dealer</span>
            )}
          </div>
          {myPlayer && (
            <span className="hand-score">{myPlayer.totalScore} pts</span>
          )}
        </div>

        {/* Hand cards */}
        <div className="hand-cards">
          {orderedHand.map((card) => {
            const groupIdx = goDownGroups.findIndex((g) => g.includes(card.id));
            const inGroup = cardsInGroups.has(card.id);
            const isSelected =
              selectedCardIds.has(card.id) || (uiMode === "goDown" && inGroup);
            const isClickable = uiMode === "goDown" || isMyActionTurn;

            return (
              <div
                key={card.id}
                className="hand-card-slot"
                draggable
                onDragStart={() => { dragSrcId.current = card.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = dragSrcId.current;
                  if (!src || src === card.id) return;
                  setHandOrder((prev) => {
                    const next = [...prev];
                    const srcIdx = next.indexOf(src);
                    const dstIdx = next.indexOf(card.id);
                    next.splice(srcIdx, 1);
                    next.splice(dstIdx, 0, src);
                    return next;
                  });
                  dragSrcId.current = null;
                }}
              >
                <PlayingCard
                  card={card}
                  selected={isSelected}
                  faded={uiMode === "goDown" && inGroup && groupIdx !== activeGroup}
                  onClick={
                    isClickable
                      ? () => {
                          if (uiMode === "goDown") toggleCardInGoDown(card.id);
                          else if (isMyActionTurn) handleToggleCard(card.id);
                        }
                      : undefined
                  }
                />
                {uiMode === "goDown" && groupIdx >= 0 && (
                  <span className="hand-group-badge">{groupIdx + 1}</span>
                )}
              </div>
            );
          })}
          {hand.length === 0 && (
            <span className="hand-empty">No cards in hand</span>
          )}
        </div>
      </div>

      {/* Action bar */}
      {uiMode !== "goDown" && (
        <div className="board-actions">
          {error && <p className="form-error action-error">{error}</p>}

          {/* Offer response */}
          {isMyOffer && game.offerState && (
            <div className="action-row">
              <button
                className="btn btn-primary"
                onClick={() => handleRespondToOffer("accept")}
                disabled={busy}
              >
                {game.offerState.isFree ? "Accept (free)" : "Accept (+draw from deck)"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => handleRespondToOffer("decline")}
                disabled={busy}
              >
                Decline
              </button>
            </div>
          )}

          {/* Draw */}
          {isMyDrawTurn && (
            <div className="action-row">
              <button className="btn btn-primary" onClick={handleDraw} disabled={busy}>
                Draw from Deck
              </button>
            </div>
          )}

          {/* Action phase */}
          {isMyActionTurn && uiMode === "normal" && (
            <div className="action-row">
              {!isDown && (
                <button className="btn btn-primary" onClick={enterGoDown} disabled={busy}>
                  Go Down
                </button>
              )}
              {isDown && selectedArr.length > 0 && (
                <button className="btn btn-secondary" onClick={enterAddToMeld} disabled={busy}>
                  Add to Meld
                </button>
              )}
              {isDown && selectedArr.length === 1 && (
                <button className="btn btn-secondary" onClick={enterReplaceJoker} disabled={busy}>
                  Replace Joker
                </button>
              )}
              <button
                className="btn btn-ghost"
                onClick={() => selectedCard && handleDiscard(selectedCard.id)}
                disabled={busy || !selectedCard || floatingJokerCount > 0}
                title={floatingJokerCount > 0 ? "Place all floating jokers first" : ""}
              >
                {selectedCard ? `Discard ${cardLabel(selectedCard)}` : "Discard"}
              </button>
            </div>
          )}

          {/* Mode hint + cancel */}
          {isMyActionTurn &&
            (uiMode === "addToMeld" ||
              uiMode === "replaceJoker" ||
              uiMode === "placeJoker") && (
              <div className="action-row">
                <span className="action-hint">
                  {uiMode === "addToMeld" && "Click a meld on the table to add to"}
                  {uiMode === "replaceJoker" && "Click a joker (★) in a table meld"}
                  {uiMode === "placeJoker" && "Click a table meld to place the joker on"}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={resetUiMode} disabled={busy}>
                  Cancel
                </button>
              </div>
            )}

          {/* Waiting */}
          {!isMyOffer && !isMyTurn && (
            <p className="waiting-hint">
              {game.phase === "turn"
                ? `Waiting for ${players[game.turnState?.uid ?? ""]?.displayName ?? "…"}…`
                : game.phase === "discard_offer" || game.phase === "round_start_offer"
                ? `Offering to ${players[game.offerState?.offeredTo ?? ""]?.displayName ?? "…"}…`
                : "Waiting…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── PlayerChip ────────────────────────────────────────────────────────────────

function PlayerChip({
  player,
  isActive,
  isDealer,
}: {
  player: PlayerDoc;
  isActive: boolean;
  isDealer: boolean;
}) {
  return (
    <div
      className={[
        "player-chip",
        isActive ? "player-chip-active" : "",
        player.isDown ? "player-chip-down" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="player-chip-top">
        <span className="player-chip-name">{player.displayName}</span>
        <div className="player-chip-badges">
          {isDealer && <span className="dealer-badge">D</span>}
          {player.isDown && <span className="down-badge">DOWN</span>}
        </div>
      </div>
      <div className="player-chip-cards">
        {Array.from({ length: Math.min(player.handSize, 8) }).map((_, i) => (
          <CardBack key={i} tiny />
        ))}
        {player.handSize > 8 && (
          <span className="chip-extra">+{player.handSize - 8}</span>
        )}
        {player.handSize === 0 && <span className="chip-empty">out</span>}
      </div>
      <div className="player-chip-score">{player.totalScore} pts</div>
    </div>
  );
}

// ── MeldView ──────────────────────────────────────────────────────────────────

function MeldView({
  meld,
  players,
  uiMode,
  onClickMeld,
  onClickJoker,
}: {
  meld: Meld;
  players: Record<string, PlayerDoc>;
  uiMode: UiMode;
  onClickMeld: () => void;
  onClickJoker: (jokerCardId: string) => void;
}) {
  const isClickable = uiMode === "addToMeld" || uiMode === "placeJoker";
  const owner = players[meld.ownerUid];
  const title =
    meld.type === "trio"
      ? `${meld.rank}s`
      : `${SUIT_SYM[meld.suit] ?? meld.suit} ${meld.lowRankValue}–${meld.highRankValue}`;

  return (
    <div
      className={`meld-view${isClickable ? " meld-clickable" : ""}`}
      onClick={isClickable ? onClickMeld : undefined}
      role={isClickable ? "button" : undefined}
    >
      <div className="meld-header">
        <span className="meld-type-label">
          {meld.type === "trio" ? "Trio" : "Straight"}
        </span>
        <span className="meld-title">{title}</span>
        <span className="meld-owner">{owner?.displayName ?? "?"}</span>
      </div>
      <div className="meld-cards">
        {meld.cards.map((card) => (
          <PlayingCard
            key={card.id}
            card={card}
            small
            glow={card.rank === "JOKER" && uiMode === "replaceJoker"}
            onClick={
              card.rank === "JOKER" && uiMode === "replaceJoker"
                ? () => onClickJoker(card.id)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── LastEvent ─────────────────────────────────────────────────────────────────

function formatEvent(
  entry: LogEntry,
  players: Record<string, PlayerDoc>,
  myUid: string
): string {
  const name = (uid: string) => {
    if (!uid) return "";
    const p = players[uid];
    if (!p) return "Someone";
    return uid === myUid ? "You" : p.displayName;
  };

  switch (entry.type) {
    case "round_start":   return `Round ${entry.round} started`;
    case "round_end":     return `${name(entry.uid)} went out`;
    case "draw":          return `${name(entry.uid)} drew a card`;
    case "discard":       return `${name(entry.uid)} discarded ${entry.card ? cardLabel(entry.card) : ""}`;
    case "offer_accepted":
      return entry.isFree
        ? `${name(entry.uid)} took the ${entry.card ? cardLabel(entry.card) : "discard"}`
        : `${name(entry.uid)} bought in with the ${entry.card ? cardLabel(entry.card) : "discard"}`;
    case "go_down":       return `${name(entry.uid)} went down`;
    case "add_to_meld":   return `${name(entry.uid)} added to a meld`;
    case "replace_joker": return `${name(entry.uid)} swapped a joker for ${entry.card ? cardLabel(entry.card) : "a card"}`;
    default:              return "";
  }
}

function LastEvent({
  entry,
  players,
  myUid,
}: {
  entry: LogEntry | null;
  players: Record<string, PlayerDoc>;
  myUid: string;
}) {
  if (!entry) return null;
  const text = formatEvent(entry, players, myUid);
  if (!text) return null;
  return (
    <div className="board-last-event" key={entry.ts}>
      {text}
    </div>
  );
}
