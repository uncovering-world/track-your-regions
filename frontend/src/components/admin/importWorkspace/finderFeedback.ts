/**
 * finderFeedback — Pure helper for building human-readable feedback messages
 * after each assignment-finder run (geoshape / points / geocode / DB / AI / auto-resolve).
 *
 * Static method order used for the "Try next" hint:
 *   Geoshape → Points → Geocode → DB → AI
 * (auto-resolve is a subtree op, not in the single-node chain)
 */

export type FinderMethod =
  | 'Geoshape'
  | 'Points'
  | 'Geocode'
  | 'DB search'
  | 'AI match'
  | 'Auto-resolve';

/** Static order for "next method" hints (auto-resolve excluded — subtree op). */
const METHOD_ORDER: FinderMethod[] = [
  'Geoshape',
  'Points',
  'Geocode',
  'DB search',
  'AI match',
];

/**
 * Return the next method in the static order, or null when at the end
 * (or when method is 'Auto-resolve' which has no chain position).
 */
export function nextFinderMethod(method: FinderMethod): FinderMethod | null {
  const idx = METHOD_ORDER.indexOf(method);
  if (idx === -1 || idx === METHOD_ORDER.length - 1) return null;
  return METHOD_ORDER[idx + 1];
}

export interface FinderFeedback {
  /** Human-readable summary line. */
  message: string;
  /** true when at least one candidate was found. */
  hasResults: boolean;
}

/**
 * Build a feedback message from a finder result.
 *
 * @param method     Which finder ran.
 * @param found      Number of candidates/suggestions returned.
 * @param autoAssigned Number of those that were auto-assigned (0 when unknown or n/a).
 * @param nextMethod  Override for the "Try …" hint (pass null to suppress).
 *                    Defaults to the next in static order when omitted.
 */
export function formatFinderFeedback(
  method: FinderMethod,
  found: number,
  autoAssigned: number,
  nextMethod?: FinderMethod | null,
): FinderFeedback {
  const effectiveNext = nextMethod !== undefined
    ? nextMethod
    : nextFinderMethod(method);

  if (found > 0) {
    const candidateStr = found === 1 ? '1 candidate' : `${found} candidates`;
    let autoStr = '';
    if (autoAssigned > 0) {
      const autoLabel = autoAssigned === 1 ? '1 auto-assigned' : `${autoAssigned} auto-assigned`;
      autoStr = ` (${autoLabel})`;
    }
    return { message: `${method} — ${candidateStr}${autoStr}`, hasResults: true };
  }

  // 0 found
  const tryHint = effectiveNext ? `. Try ${effectiveNext}` : '';
  return {
    message: `${method} — no candidates${tryHint}`,
    hasResults: false,
  };
}
