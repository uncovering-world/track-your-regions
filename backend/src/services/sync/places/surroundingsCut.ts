/**
 * ADR-0171: a kind's surroundings tier (ADR-0178), read from Wikidata, measures
 * a place against what lies within the radius around it, with the tests and the
 * stay of ADR-0175 decisions 2 and 3; ADR-0181 counts among its neighbours only
 * the places of its own density (`surroundingsNeighbourhood.ts`), so a place on
 * a dense core's edge is measured against the edge and not the core. A place
 * the world bars left out enters the surroundings tier when it has a Wikipedia
 * article in the cut's languages and the readers' floor a year, and one of
 * three tests passes, each against the median of the best of its neighbours:
 *
 * - the Wikivoyage editions that use it reach the guide share of that median,
 *   in an area of the guide test's group floor;
 * - its Wikipedia editions reach that median, in an area of the editions
 *   test's floor;
 * - its readers reach that median, in an area of the readers test's floor.
 *
 * Where fewer than the best places carry a signal, the reference is the median
 * of those that do, and a place that carries none sets no reference. A tunnel,
 * a dam, a lock or a bridge enters only when a Wikivoyage edition uses it, since
 * the readership of its article does not say people go to see it, and a bridge
 * also when a heritage designation holds (`needsAGuide`, #2324).
 * A place the tier admitted before stays while it keeps the cut's languages,
 * reaches the stay share of the readers' floor and passes one test, the readers
 * test read at the stay share and the other two whole, since their reference is
 * its own neighbours'.
 *
 * Where no Wikivoyage usage build is in place the guides' test is not read,
 * and never read as no guide (ADR-0175 decision 6): nothing new enters by a
 * guide, and a held place that passes no other test keeps its place unless no
 * guide used it when last read, the world tier's memory of it
 * (`WorldMemory.guided`, `membership_fame.guides_read_at`).
 *
 * The numbers are the register's (`SURROUNDINGS_REGISTER` in
 * `admissionRegister.ts`, ADR-0175 decision 5), each with its derivation,
 * never a reader's or an admin's control. The readers' floor is a rank among
 * the year's items, so its count follows the level of readership (ADR-0184).
 */

import { SURROUNDINGS_REGISTER } from './admissionRegister.js';

/**
 * Whose places a candidate is measured among within the radius: every place
 * kind's together (the pool of ADR-0171's measurement, museums included), the
 * candidate's own kind's, or the places of its type within the kind (a mosque
 * among mosques). The review (#2177) measures the three; the code reads one.
 */
export type SurroundingsNeighbours = 'all' | 'kind' | 'type';

export interface SurroundingsCut {
  /** Whether the pass reads the surroundings tier at all (ADR-0175 decision 3 switched it on). */
  enabled: boolean;
  /** Whose places set the references. */
  neighbours: SurroundingsNeighbours;
  /** How far around the place its surroundings reach. */
  radiusKm: number;
  /** A place's density is its distance to this nearest of the pool's places (the 20th: ADR-0181). */
  densityNeighbours: number;
  /** A neighbour counts while its density over the candidate's is within this factor, either way. */
  densityRatio: number;
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
  /**
   * The fewest readers a year a place must have, whatever its surroundings:
   * what the year's readers of the item at `minReadersRank` come to, read with
   * the pool's year (`SurroundingsPool.minReaders`, ADR-0184), and the count
   * the rank yielded when it was derived until a year is read.
   */
  minReaders: number;
  /** The rank among the year's items whose readers set `minReaders`. */
  minReadersRank: number;
  /** The types of a kind's rule (a tunnel, a dam, a lock, a bridge) that enter and stay only while a Wikivoyage edition uses the place. */
  guideForTypes: readonly string[];
  /** The types of `guideForTypes` for which a heritage designation that holds counts as a guide's use (a bridge). */
  heritageForTypes: readonly string[];
  /** The share of the readers' floor and of the readers test at which a place the tier holds stays. */
  stayReadersShare: number;
}

export const SURROUNDINGS_CUT: SurroundingsCut = {
  enabled: true,
  neighbours: SURROUNDINGS_REGISTER.neighbours.value,
  radiusKm: SURROUNDINGS_REGISTER.radiusKm.value,
  densityNeighbours: SURROUNDINGS_REGISTER.densityNeighbours.value,
  densityRatio: SURROUNDINGS_REGISTER.densityRatio.value,
  best: SURROUNDINGS_REGISTER.best.value,
  guideShare: SURROUNDINGS_REGISTER.guideShare.value,
  editionsShare: SURROUNDINGS_REGISTER.editionsShare.value,
  readersShare: SURROUNDINGS_REGISTER.readersShare.value,
  guideGroupFloor: SURROUNDINGS_REGISTER.guideGroupFloor.value,
  editionsGroupFloor: SURROUNDINGS_REGISTER.editionsGroupFloor.value,
  readersGroupFloor: SURROUNDINGS_REGISTER.readersGroupFloor.value,
  minLanguages: SURROUNDINGS_REGISTER.minLanguages.value,
  minReaders: SURROUNDINGS_REGISTER.minReaders.value.yieldedThen,
  minReadersRank: SURROUNDINGS_REGISTER.minReaders.value.rank,
  guideForTypes: SURROUNDINGS_REGISTER.guideForTypes.value,
  heritageForTypes: SURROUNDINGS_REGISTER.heritageForTypes.value,
  stayReadersShare: SURROUNDINGS_REGISTER.stayReadersShare.value,
};

/** The cut with the readers' floor the pool's year yields, where the pool read one (ADR-0184). */
export function yearCut(cut: SurroundingsCut, minReaders: number | undefined): SurroundingsCut {
  return minReaders === undefined ? cut : { ...cut, minReaders };
}

/** A candidate's own signals. */
export interface SurroundingsCandidate {
  editions: number;
  /** The Wikivoyage editions that use it; null where no usage build is in place, so no guide's use is read this run. */
  guideEditions: number | null;
  /** A year's readers, by the counter the world bars read with. */
  readers: number;
  /**
   * Where no guide's use is read this run, whether a guide used the place when
   * last read (`WorldMemory.guided`, ADR-0175 decision 6), or null where no
   * build was ever read for it. Read of a place the tier holds alone: no new
   * place enters by a guide the run did not read.
   */
  guidedAsLastRead?: boolean | null;
}

/** A candidate's neighbours, of its own density within the radius: the group's size and the best places' signals, highest first. */
export interface Surroundings {
  groupSize: number;
  /** The `best` highest edition counts among the neighbours, the candidate's own among them. */
  topEditions: readonly number[];
  /** The `best` highest Wikivoyage edition counts among the neighbours, over the places a guide uses at all. */
  topGuideEditions: readonly number[];
  /** The `best` highest readers a year among the neighbours, over the places read at all. */
  topReaders: readonly number[];
}

/** The three references off the best within the radius; null where no place around carries the signal. */
export interface SurroundingsReferences {
  editions: number | null;
  guide: number | null;
  readers: number | null;
}

export type SurroundingsVerdict =
  | { in: true; note: string; reference: SurroundingsReferences }
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
  candidate: SurroundingsCandidate, around: Surroundings, reference: SurroundingsReferences, cut: SurroundingsCut, readersShare: number,
): string[] {
  const doors: string[] = [];
  if (around.groupSize >= cut.editionsGroupFloor && reference.editions !== null
    && candidate.editions >= cut.editionsShare * reference.editions) doors.push('its editions');
  if (around.groupSize >= cut.readersGroupFloor && reference.readers !== null && candidate.readers > 0
    && candidate.readers >= readersShare * reference.readers) doors.push('its readers');
  if (around.groupSize >= cut.guideGroupFloor && reference.guide !== null && candidate.guideEditions !== null
    && candidate.guideEditions > 0 && candidate.guideEditions >= cut.guideShare * reference.guide) doors.push('the guides');
  return doors;
}

/** The tests in words: "by its editions", "by its editions and by the guides", "by its editions, by its readers and by the guides". */
function doorsInWords(doors: readonly string[]): string {
  const by = doors.map((door) => `by ${door}`);
  return by.length > 1 ? `${by.slice(0, -1).join(', ')} and ${by[by.length - 1]}` : by[0];
}

/**
 * Where a candidate stands against its surroundings. The references are read
 * off the best of its neighbours, the candidate's own among them: a
 * place that is itself the best of its area clears its own reference. A place
 * the tier holds (`held`) stays at the stay share of the readers' floor and of
 * the readers test (ADR-0175 decision 2).
 */
export function surroundingsVerdict(
  candidate: SurroundingsCandidate, around: Surroundings, cut: SurroundingsCut = SURROUNDINGS_CUT, held = false,
): SurroundingsVerdict {
  if (candidate.editions < cut.minLanguages) {
    return { in: false, reason: `${candidate.editions} Wikipedia editions, under the ${cut.minLanguages} the surroundings tier asks for` };
  }
  const floor = (held ? cut.stayReadersShare : 1) * cut.minReaders;
  if (candidate.readers < floor) {
    return { in: false, reason: `${fmt(candidate.readers)} readers a year, under the ${fmt(floor)} the surroundings tier asks for`
      + (held ? ' of a place it holds' : '') };
  }
  const smallest = Math.min(cut.guideGroupFloor, cut.editionsGroupFloor, cut.readersGroupFloor);
  if (around.groupSize < smallest) {
    return { in: false, reason: `${around.groupSize} places of its density within ${cut.radiusKm} km, under the floor of ${smallest}: too few to measure against` };
  }
  const reference = referencesOf(candidate, around, cut);
  const within = surroundingsInWords(candidate, around, reference, cut, held);
  const enters = doorsOf(candidate, around, reference, cut, cut.readersShare);
  // A held place under the new-place floor is kept by the stay alone, and its note says so.
  const underFloor = candidate.readers < cut.minReaders;
  if (enters.length && !underFloor) return { in: true, reference, note: `In the surroundings tier ${doorsInWords(enters)}: ${within} (ADR-0171, ADR-0175, ADR-0181)` };
  const stays = held ? doorsOf(candidate, around, reference, cut, cut.stayReadersShare * cut.readersShare) : [];
  if (stays.length) {
    return { in: true, reference, note: `Stays in the surroundings tier ${doorsInWords(stays)}, the readers test read at `
      + `${fmt(cut.stayReadersShare * cut.readersShare)} times the reference for a place it holds: ${within} (ADR-0175, ADR-0181)` };
  }
  // The guides' test is the one the run could not read: a held place a guide
  // used when last read, or that no build was ever read for, keeps its place
  // where the test reads its area; one no guide used when last read falls.
  if (held && candidate.guideEditions === null && candidate.guidedAsLastRead !== false && around.groupSize >= cut.guideGroupFloor) {
    return { in: true, reference, note: `Kept in the surroundings tier, the guides' test unread: ${within} (ADR-0175 decision 6, ADR-0181)` };
  }
  return { in: false, reason: `below the surroundings tier's cut: ${within}` };
}

/** The three references off the best of the neighbours; no guide reference where no guide's use is read, the neighbours' as the candidate's. */
function referencesOf(candidate: SurroundingsCandidate, around: Surroundings, cut: SurroundingsCut): SurroundingsReferences {
  const best = (values: readonly number[]) => medianOf(values.filter((n) => n > 0).slice(0, cut.best));
  return {
    editions: best(around.topEditions),
    guide: candidate.guideEditions === null ? null : best(around.topGuideEditions),
    readers: best(around.topReaders),
  };
}

/** The candidate against its references in words, for the note and the reason. */
function surroundingsInWords(
  candidate: SurroundingsCandidate, around: Surroundings, reference: SurroundingsReferences, cut: SurroundingsCut, held: boolean,
): string {
  const editions = reference.editions === null ? 'no place is read in any Wikipedia edition'
    : `the ${cut.best} best are read in ${fmt(reference.editions)} Wikipedia editions at the median`;
  const readers = reference.readers === null ? 'no place has a reader'
    : `the best have ${fmt(reference.readers)} readers a year at the median`;
  let guide = reference.guide === null ? 'no Wikivoyage edition uses any place here'
    : `the best are used by ${fmt(reference.guide)} Wikivoyage editions at the median, this place by ${fmt(candidate.guideEditions ?? 0)}`;
  if (candidate.guideEditions === null) guide = `no Wikivoyage usage is built, so no guide's use is read${held ? guidesAsLastRead(candidate.guidedAsLastRead) : ''}`;
  return `within ${cut.radiusKm} km, ${fmt(around.groupSize)} places of its density: ${editions}, this place in ${fmt(candidate.editions)}; `
    + `${readers}, this place ${fmt(candidate.readers)}; ${guide}`;
}

/** A held place's guide mark as last read, as the clause the cut's words close on where no guide's use is read this run. */
function guidesAsLastRead(guided: boolean | null | undefined): string {
  if (guided === true) return '; a Wikivoyage edition used this place when last read';
  if (guided === false) return '; no Wikivoyage edition used this place when last read';
  return '; no guide\'s use was ever read of this place';
}

/**
 * Why a place of a type that needs a guide (a tunnel, a dam, a lock, a bridge)
 * is refused where no Wikivoyage edition uses it, or null where its type needs
 * none, a guide uses it, or, for a type of `heritageForTypes`, a heritage
 * designation holds (`heritage`): the Luding Bridge no guide lists is a sight
 * all the same, while the Astoria–Megler Bridge is a crossing (#2324). Read once the kind's rule has typed the place, and
 * for a place the tier holds as for a new one. Where no usage build is in
 * place (`guideEditions` null), a place the tier holds is read by its guide
 * mark as last read, and kept where no build was ever read for it; a new
 * place does not enter, since nothing the run read says a guide uses it
 * (ADR-0175 decision 6).
 */
export function needsAGuide(
  type: string, guide: Pick<SurroundingsCandidate, 'guideEditions' | 'guidedAsLastRead'>, held = false,
  cut: SurroundingsCut = SURROUNDINGS_CUT, heritage = false,
): string | null {
  if (!cut.guideForTypes.includes(type)) return null;
  if (heritage && cut.heritageForTypes.includes(type)) return null;
  const why = 'the readership of its article does not say people go to see it (ADR-0175)';
  if (guide.guideEditions !== null) {
    return guide.guideEditions > 0 ? null : `a ${type} enters the surroundings tier only while a Wikivoyage edition uses it, and none does: ${why}`;
  }
  if (!held) {
    return `a ${type} enters the surroundings tier only when a Wikivoyage edition uses it, and no Wikivoyage usage is built `
      + `to read whether one does: ${why}; nothing new enters by a guide the run did not read (ADR-0175 decision 6)`;
  }
  if (guide.guidedAsLastRead !== false) return null;
  return `a ${type} stays in the surroundings tier only while a Wikivoyage edition uses it, and none did when last read `
    + `(no Wikivoyage usage is built this run): ${why}`;
}
