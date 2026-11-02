/**
 * ADR-0171: a kind's regional tier, read from Wikidata where no native source
 * is adopted, measures a place against what lies within the radius around it,
 * with the tests and the stay of ADR-0175 decisions 2 and 3. A place the world
 * bars left out enters the regional tier when it has a Wikipedia article in the
 * cut's languages and the readers' floor a year, and one of three tests passes,
 * each against the median of the best places within the radius:
 *
 * - the Wikivoyage editions that use it reach the guide share of that median,
 *   in an area of the guide test's group floor;
 * - its Wikipedia editions reach that median, in an area of the editions
 *   test's floor;
 * - its readers reach that median, in an area of the readers test's floor.
 *
 * Where fewer than the best places carry a signal, the reference is the median
 * of those that do, and a place that carries none sets no reference. A tunnel,
 * a dam or a lock enters only when a Wikivoyage edition uses it, since the
 * readership of its article does not say people go to see it (`needsAGuide`).
 * A place the tier admitted before stays while it keeps the cut's languages,
 * reaches the stay share of the readers' floor and passes one test, the readers
 * test read at the stay share and the other two whole, since their reference is
 * its own neighbours'.
 *
 * The numbers are the register's (`REGIONAL_REGISTER` in `admissionRegister.ts`,
 * ADR-0175 decision 5), each with its derivation, never a reader's or an
 * admin's control.
 */

import { REGIONAL_REGISTER } from './admissionRegister.js';

/**
 * Whose places a candidate is measured among within the radius: every place
 * kind's together (the pool of ADR-0171's measurement, museums included), the
 * candidate's own kind's, or the places of its type within the kind (a mosque
 * among mosques). The review (#2177) measures the three; the code reads one.
 */
export type RegionalNeighbours = 'all' | 'kind' | 'type';

export interface RegionalCut {
  /** Whether the pass reads the regional tier at all (ADR-0175 decision 3 switched it on). */
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
  /** The share of the readers reference a place's own readers must reach. */
  readersShare: number;
  /** The smallest group of places within the radius the guide test reads, so one listing among four places is not a top. */
  guideGroupFloor: number;
  /** The smallest group the editions test reads, so the fifth church of five is not a top. */
  editionsGroupFloor: number;
  /** The smallest group the readers test reads. */
  readersGroupFloor: number;
  /** The fewest Wikipedia editions a place must have, whatever its surroundings. */
  minLanguages: number;
  /** The fewest readers a year a place must have, whatever its surroundings. */
  minReaders: number;
  /** The types of a kind's rule (a tunnel, a dam, a lock) that enter and stay only while a Wikivoyage edition uses the place. */
  guideForTypes: readonly string[];
  /** The share of the readers' floor and of the readers test at which a place the tier holds stays. */
  stayReadersShare: number;
}

export const REGIONAL_CUT: RegionalCut = {
  enabled: true,
  neighbours: REGIONAL_REGISTER.neighbours.value,
  radiusKm: REGIONAL_REGISTER.radiusKm.value,
  best: REGIONAL_REGISTER.best.value,
  guideShare: REGIONAL_REGISTER.guideShare.value,
  editionsShare: REGIONAL_REGISTER.editionsShare.value,
  readersShare: REGIONAL_REGISTER.readersShare.value,
  guideGroupFloor: REGIONAL_REGISTER.guideGroupFloor.value,
  editionsGroupFloor: REGIONAL_REGISTER.editionsGroupFloor.value,
  readersGroupFloor: REGIONAL_REGISTER.readersGroupFloor.value,
  minLanguages: REGIONAL_REGISTER.minLanguages.value,
  minReaders: REGIONAL_REGISTER.minReaders.value,
  guideForTypes: REGIONAL_REGISTER.guideForTypes.value,
  stayReadersShare: REGIONAL_REGISTER.stayReadersShare.value,
};

/** A candidate's own signals. */
export interface RegionalCandidate {
  editions: number;
  guideEditions: number;
  /** A year's readers, by the counter the world bars read with. */
  readers: number;
}

/** What lies within the radius of a candidate: the group's size and the best places' signals, highest first. */
export interface Surroundings {
  groupSize: number;
  /** The `best` highest edition counts within the radius, the candidate's own among them. */
  topEditions: readonly number[];
  /** The `best` highest Wikivoyage edition counts within the radius, over the places a guide uses at all. */
  topGuideEditions: readonly number[];
  /** The `best` highest readers a year within the radius, over the places read at all. */
  topReaders: readonly number[];
}

/** The three references off the best within the radius; null where no place around carries the signal. */
export interface RegionalReferences {
  editions: number | null;
  guide: number | null;
  readers: number | null;
}

export type RegionalVerdict =
  | { in: true; note: string; reference: RegionalReferences }
  | { in: false; reason: string };

/** The median of a list of counts, highest first or not; null for none. */
export function medianOf(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const fmt = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 1 });

/** The tests a candidate passes against its references, the readers test read at `readersShare` of its reference. */
function doorsOf(
  candidate: RegionalCandidate, around: Surroundings, reference: RegionalReferences, cut: RegionalCut, readersShare: number,
): string[] {
  const doors: string[] = [];
  if (around.groupSize >= cut.editionsGroupFloor && reference.editions !== null
    && candidate.editions >= cut.editionsShare * reference.editions) doors.push('its editions');
  if (around.groupSize >= cut.readersGroupFloor && reference.readers !== null && candidate.readers > 0
    && candidate.readers >= readersShare * reference.readers) doors.push('its readers');
  if (around.groupSize >= cut.guideGroupFloor && reference.guide !== null && candidate.guideEditions > 0
    && candidate.guideEditions >= cut.guideShare * reference.guide) doors.push('the guides');
  return doors;
}

/** The tests in words: "by its editions", "by its editions and by the guides", "by its editions, by its readers and by the guides". */
function doorsInWords(doors: readonly string[]): string {
  const by = doors.map((door) => `by ${door}`);
  return by.length > 1 ? `${by.slice(0, -1).join(', ')} and ${by[by.length - 1]}` : by[0];
}

/**
 * Where a candidate stands against its surroundings. The references are read
 * off the best places within the radius, the candidate's own among them: a
 * place that is itself the best of its area clears its own reference. A place
 * the tier holds (`held`) stays at the stay share of the readers' floor and of
 * the readers test (ADR-0175 decision 2).
 */
export function regionalVerdict(
  candidate: RegionalCandidate, around: Surroundings, cut: RegionalCut = REGIONAL_CUT, held = false,
): RegionalVerdict {
  if (candidate.editions < cut.minLanguages) {
    return { in: false, reason: `${candidate.editions} Wikipedia editions, under the ${cut.minLanguages} the regional tier asks for` };
  }
  const floor = (held ? cut.stayReadersShare : 1) * cut.minReaders;
  if (candidate.readers < floor) {
    return { in: false, reason: `${fmt(candidate.readers)} readers a year, under the ${fmt(floor)} the regional tier asks for`
      + (held ? ' of a place it holds' : '') };
  }
  const smallest = Math.min(cut.guideGroupFloor, cut.editionsGroupFloor, cut.readersGroupFloor);
  if (around.groupSize < smallest) {
    return { in: false, reason: `${around.groupSize} places within ${cut.radiusKm} km, under the floor of ${smallest}: too few to measure against` };
  }
  const reference: RegionalReferences = {
    editions: medianOf(around.topEditions.filter((n) => n > 0).slice(0, cut.best)),
    guide: medianOf(around.topGuideEditions.filter((n) => n > 0).slice(0, cut.best)),
    readers: medianOf(around.topReaders.filter((n) => n > 0).slice(0, cut.best)),
  };
  const editions = reference.editions === null ? 'no place is read in any Wikipedia edition'
    : `the ${cut.best} best are read in ${fmt(reference.editions)} Wikipedia editions at the median`;
  const readers = reference.readers === null ? 'no place has a reader'
    : `the best have ${fmt(reference.readers)} readers a year at the median`;
  const guide = reference.guide === null ? 'no Wikivoyage edition uses any place here'
    : `the best are used by ${fmt(reference.guide)} Wikivoyage editions at the median, this place by ${fmt(candidate.guideEditions)}`;
  const within = `within ${cut.radiusKm} km, ${fmt(around.groupSize)} places: ${editions}, this place in ${fmt(candidate.editions)}; `
    + `${readers}, this place ${fmt(candidate.readers)}; ${guide}`;
  const enters = doorsOf(candidate, around, reference, cut, cut.readersShare);
  // A held place under the new-place floor is kept by the stay alone, and its note says so.
  const underFloor = candidate.readers < cut.minReaders;
  if (enters.length && !underFloor) return { in: true, reference, note: `In the regional tier ${doorsInWords(enters)}: ${within} (ADR-0171, ADR-0175)` };
  const stays = held ? doorsOf(candidate, around, reference, cut, cut.stayReadersShare * cut.readersShare) : [];
  if (stays.length) {
    return { in: true, reference, note: `Stays in the regional tier ${doorsInWords(stays)}, read at ${cut.stayReadersShare} `
      + `of the readers' reference for a place it holds: ${within} (ADR-0175)` };
  }
  return { in: false, reason: `below the regional tier's cut: ${within}` };
}

/**
 * Why a place of a type that needs a guide (a tunnel, a dam, a lock) is
 * refused where no Wikivoyage edition uses it, or null where its type needs
 * none or a guide uses it. Read once the kind's rule has typed the place, and
 * for a place the tier holds as for a new one.
 */
export function needsAGuide(type: string, guideEditions: number, cut: RegionalCut = REGIONAL_CUT): string | null {
  if (!cut.guideForTypes.includes(type) || guideEditions > 0) return null;
  return `a ${type} enters the regional tier only while a Wikivoyage edition uses it, and none does: `
    + 'the readership of its article does not say people go to see it (ADR-0175)';
}
