/**
 * Tier 1: a museum is in the catalogue because it holds a work the world knows, and the reason
 * is nameable. One threshold governs both which works are iconic and which museums are
 * admitted, so no museum card can be empty — a museum with nothing iconic is simply not here.
 *
 * Measured on 2026-08-07: 326 iconic works, 100 museums, no cap needed — the list length is a
 * property of the data.
 */
export interface TierWork {
  qid: string;
  sitelinks: number;
  venues: string[];
  /**
   * Whether the work exists in multiple originals by the nature of its medium — a print, a
   * cast, an authorised replica. See `MAX_HOLDERS` for what turns on it.
   */
  multipleMedium?: boolean;
}

export const ICONIC_SITELINKS = 22;
/**
 * How many venues may hold one *unique* work before it admits none of them.
 *
 * The question is "which of these is the one to travel for", and it is worth asking only where
 * there is an answer to find.
 *
 * For a medium that exists in editions the count says nothing about significance: the Great
 * Wave has roughly a hundred impressions and each is the real thing, Duchamp's *Fountain* is
 * in five museums and all five are true. A blanket cap removes Japanese printmaking from the
 * catalogue as a class, which is not a judgement anyone made — and it settles a question that
 * needs no settling, since a traveller in front of a genuine impression is in front of the
 * thing however many other museums hold one.
 *
 * For a unique work it is a real question and not one a threshold can answer: Böcklin painted
 * five *Isles of the Dead*, Spitzweg several *Bookworms*, and the attribution of Caravaggio's
 * *Taking of Christ* is contested between two cities. Those go to a curator, who is told which
 * venues claim it and why — the machine's part is to notice, not to decide (owner's ruling,
 * 2026-08-07).
 */
export const MAX_HOLDERS = 2;
/**
 * Hysteresis, applied when the flag is *written* rather than when the list is selected: a
 * treasure already marked iconic keeps the mark until it falls below this, so the badge does
 * not flicker as Wikipedia grows. See Task 9, step 4.
 */
export const ICONIC_RELEASE = 18;

export interface Tier1Result {
  museums: Map<string, string[]>;
  homeless: string[];
  /** Unique works claimed by more venues than one visit can settle. A curator's question. */
  shared: string[];
}

export function selectTier1(
  works: TierWork[],
  opts: { threshold?: number; maxHolders?: number } = {},
): Tier1Result {
  const threshold = opts.threshold ?? ICONIC_SITELINKS;
  const maxHolders = opts.maxHolders ?? MAX_HOLDERS;
  const museums = new Map<string, string[]>();
  const homeless: string[] = [];
  const shared: string[] = [];

  for (const work of works) {
    if (work.sitelinks < threshold) continue;
    if (!work.venues.length) { homeless.push(work.qid); continue; }
    // The cap asks "which of these is the one to travel for", and an edition has no such
    // answer to give — every holder of an iconic impression has the thing itself.
    if (!work.multipleMedium && work.venues.length > maxHolders) { shared.push(work.qid); continue; }
    for (const v of work.venues) {
      const held = museums.get(v) ?? [];
      held.push(work.qid);
      museums.set(v, held);
    }
  }
  return { museums, homeless, shared };
}
