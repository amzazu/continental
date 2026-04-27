import { db } from "../admin.js";
import type { LogEntry } from "../../../shared/types.js";

type AnyWriter = { set(ref: FirebaseFirestore.DocumentReference, data: object): unknown };

export function logEvent(
  writer: AnyWriter,
  gameId: string,
  entry: Omit<LogEntry, "ts">
): void {
  const ref = db.collection(`games/${gameId}/log`).doc();
  writer.set(ref, { ...entry, ts: Date.now() });
}
