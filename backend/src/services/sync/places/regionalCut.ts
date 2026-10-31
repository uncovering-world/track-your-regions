/**
 * ADR-0171: a kind's regional tier, read from Wikidata where no native source
 * is adopted, measures a place against what lies within 50 km of it. A place
 * the world line left out enters the regional tier when it has a Wikipedia
 * article in two languages or more and either the Wikivoyage editions that use
 * it reach a quarter of the median of the ten best within the radius by
 * Wikivoyage's use, among five places or more, or its Wikipedia editions reach
 * the median of the ten best within the radius by editions, among 25 places or
 * more. Where fewer than ten places carry a signal, the reference is the median
 * of those that do, and a place that carries none sets no reference.
 *
 * The numbers are one named set here and nowhere else (#2178): they are
 * parameters for the admission review's experiments (#2177), not a reader's or
 * an admin's control, and a later decision may give a region values of its
 * own beside the world's. Each is what ADR-0171's measurement chose, on the
 * dump of 2026-10-19 over the 21 coverage surveys.
 */

/**
 * Whose places a candidate is measured among within the radius: every place
 * kind's together (the pool of ADR-0171's measurement, museums included), the
 * candidate's own kind's, or the places of its type within the kind (a mosque
 * among mosques). The review (#2177) measures the three; the code reads one.
 */
export type RegionalNeighbours = 'all' | 'kind' | 'type';

export interface RegionalCut {
  /**
   * Whether the pass reads the regional tier at all. Off until the review
   * (#2177) settles the numbers: at ADR-0171's, the rule admits some 21,000
   * places for a curator over the whole world (2026-10-31), which is the
   * review's question, not a queue to fill before it is answered.
   */
  enabled: boolean;
  /** Whose places set the references. */
  neighbours: RegionalNeighbours;
  /** How far around the place its surroundings reach. */
  radiusKm: number;
  /** How many of the best places within the radius set each reference. */
  best: number;
  /** The share of the Wikivoyage reference a place's own guide editions must reach. */
  guideShare: number;
  /** The share of the editions reference a place's own editions must reach. */
  editionsShare: number;
  /** The smallest group of places within the radius the guide test reads: five, so one listing among four places is not a top. */
  guideGroupFloor: number;
  /** The smallest group the editions test reads: twenty-five, so the fifth church of five is not a top. */
  editionsGroupFloor: number;
  /** The fewest Wikipedia editions a place must have, whatever its surroundings. */
  minLanguages: number;
}

export const REGIONAL_CUT: RegionalCut = {
  enabled: false, neighbours: 'all',
  radiusKm: 50, best: 10, guideShare: 0.25, editionsShare: 1, guideGroupFloor: 5, editionsGroupFloor: 25, minLanguages: 2,
};

/** A candidate's own signals. */
export interface RegionalCandidate {
  editions: number;
  guideEditions: number;
}

/** What lies within the radius of a candidate: the group's size and the best places' signals, highest first. */
export interface Surroundings {
  groupSize: number;
  /** The `best` highest edition counts within the radius, the candidate's own among them. */
  topEditions: readonly number[];
  /** The `best` highest Wikivoyage edition counts within the radius, over the places a guide uses at all. */
  topGuideEditions: readonly number[];
}

export type RegionalVerdict =
  | { in: true; note: string; reference: { editions: number | null; guide: number | null } }
  | { in: false; reason: string };

/** The median of a list of counts, highest first or not; null for none. */
export function medianOf(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const fmt = (n: number) => n.toLocaleString('en');

/**
 * Where a candidate stands against its surroundings. The references are read
 * off the best places within the radius, the candidate's own among them: a
 * place that is itself the best of its area clears its own reference.
 */
export function regionalVerdict(
  candidate: RegionalCandidate, around: Surroundings, cut: RegionalCut = REGIONAL_CUT,
): RegionalVerdict {
  if (candidate.editions < cut.minLanguages) {
    return { in: false, reason: `${candidate.editions} Wikipedia editions, under the ${cut.minLanguages} the regional tier asks for` };
  }
  const smallest = Math.min(cut.guideGroupFloor, cut.editionsGroupFloor);
  if (around.groupSize < smallest) {
    return { in: false, reason: `${around.groupSize} places within ${cut.radiusKm} km, under the floor of ${smallest}: too few to measure against` };
  }
  const editionsRef = medianOf(around.topEditions.filter((n) => n > 0).slice(0, cut.best));
  const guideRef = medianOf(around.topGuideEditions.filter((n) => n > 0).slice(0, cut.best));
  const byEditions = around.groupSize >= cut.editionsGroupFloor && editionsRef !== null
    && candidate.editions >= cut.editionsShare * editionsRef;
  const byGuide = around.groupSize >= cut.guideGroupFloor && guideRef !== null && candidate.guideEditions > 0
    && candidate.guideEditions >= cut.guideShare * guideRef;
  const within = `within ${cut.radiusKm} km, ${fmt(around.groupSize)} places: `
    + (editionsRef === null ? 'no place is read in any Wikipedia edition' : `the ${cut.best} best are read in ${fmt(editionsRef)} Wikipedia editions at the median`)
    + `, this place in ${fmt(candidate.editions)}`;
  const guide = guideRef === null
    ? 'no Wikivoyage edition uses any place here'
    : `the best are used by ${fmt(guideRef)} Wikivoyage editions at the median, this place by ${fmt(candidate.guideEditions)}`;
  if (byEditions || byGuide) {
    let door = 'by the guides';
    if (byEditions && byGuide) door = 'by its editions and by the guides';
    else if (byEditions) door = 'by its editions';
    return { in: true, note: `In the regional tier ${door}: ${within}; ${guide} (ADR-0171)`, reference: { editions: editionsRef, guide: guideRef } };
  }
  return { in: false, reason: `below the regional tier's cut: ${within}; ${guide}` };
}
