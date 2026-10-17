/**
 * An elapsed time as a person reads it: to the second while it is short and
 * to the minute once it is long ("14 s", "6 min 12 s", "1 h 4 min").
 *
 * One declaration for both sides, because a long admin operation says its
 * durations twice (#1356): in the backend log (`Operation` in
 * `backend/src/services/operationProgress.ts`) and on the panel that follows
 * it (`OperationProgressView`), and the two have to agree when an admin reads
 * one beside the other.
 */
export function elapsedText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min ${s % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
