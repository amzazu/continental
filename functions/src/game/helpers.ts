export function nextPlayer(turnOrder: string[], uid: string): string {
  const idx = turnOrder.indexOf(uid);
  return turnOrder[(idx + 1) % turnOrder.length];
}

export function previousPlayer(turnOrder: string[], uid: string): string {
  const idx = turnOrder.indexOf(uid);
  return turnOrder[(idx - 1 + turnOrder.length) % turnOrder.length];
}

// Returns the next eligible player in the offer chain, or null if all have responded.
// skip: players who should never receive the offer (e.g. the original discarder)
export function nextInOfferChain(
  turnOrder: string[],
  currentOfferee: string,
  declinedBy: string[],
  skip: string[]
): string | null {
  const startIdx = turnOrder.indexOf(currentOfferee);
  for (let i = 1; i < turnOrder.length; i++) {
    const candidate = turnOrder[(startIdx + i) % turnOrder.length];
    if (skip.includes(candidate)) continue;
    if (declinedBy.includes(candidate)) continue;
    return candidate;
  }
  return null;
}

export function generateGameCode(): string {
  // Omits I, O, 0, 1 to avoid visual confusion
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}
