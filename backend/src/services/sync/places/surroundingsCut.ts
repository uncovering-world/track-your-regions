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
 * and editions tests read at their stay shares and the guides' whole: the
 * neighbours an editions reference is read off move whenever the pool gains a
 * class, with nothing changed about the place itself (ADR-0187).
 *
 * A kind that reads the venues around its places (Squares & streets, ADR-0192)
 * has a fourth test: the food-and-drink venues of the OpenStreetMap layer
 * within the venue radius of the place's point reach the venue share of the
 * median of the best counts among the kind's places within the radius, in an
 * area of the venue test's floor. A plain circle, with no density ratio
 * (`venuesAround`). A street whose lines the layer keeps is measured along
 * them instead, in venues per 100 m, against the streets around it measured
 * the same way, where enough of them are (decision 1a, `thinlyLined`). An
 * artery, a street whose every line is a road for through traffic, is let in
 * by nothing the venue test reads (`SurroundingsCandidate.artery`). Where the
 * layer in place keeps no venue (a build cut before ADR-0191) the test is not
 * read: nothing enters by it, and a place the tier holds that last stood by it
 * keeps its place (`standsByVenues`).
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
  /** The share of the editions test at which a place the tier holds stays. */
  stayEditionsShare: number;
  /** How far from a place's point its food-and-drink venues are counted, in metres (ADR-0192). */
  venueRadiusM: number;
  /** How far from a street's line a venue is on it, in metres: the width of a street and its frontage (ADR-0192 decision 1a). */
  venueLineM: number;
  /** The shortest line a street is measured along, in metres; a shorter one is read at its point (ADR-0192 decision 1a). */
  venueLineMinM: number;
  /** The share of the venues reference a place's own venues must reach. */
  venueShare: number;
  /** The smallest number of the kind's places within the radius the venue test reads. */
  venueGroupFloor: number;
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
  stayEditionsShare: SURROUNDINGS_REGISTER.stayEditionsShare.value,
  venueRadiusM: SURROUNDINGS_REGISTER.venueRadiusM.value,
  venueLineM: SURROUNDINGS_REGISTER.venueLineM.value,
  venueLineMinM: SURROUNDINGS_REGISTER.venueLineMinM.value,
  venueShare: SURROUNDINGS_REGISTER.venueShare.value,
  venueGroupFloor: SURROUNDINGS_REGISTER.venueGroupFloor.value,
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
  /**
   * The food-and-drink venues within the venue radius of its point, for a kind
   * that reads them (ADR-0192); null where the layer in place keeps no venue,
   * so none is read this run; absent for a kind that reads none.
   */
  venues?: number | null;
  /**
   * Where `venues` is read along the place's lines rather than at its point
   * (ADR-0194): in venues per 100 m, over `metres` of line.
   */
  venuesAlong?: { metres: number };
  /**
   * Whether every one of the street's lines in the layer is an artery, which
   * the venue test lets in by nothing (ADR-0194), however its venues are read.
   */
  artery?: boolean;
  /**
   * Where no venue is read this run, whether a place the tier holds last stood
   * by the venue test (`WorldMemory.venued`): such a place keeps its place, and
   * no other is kept for a test the run could not read.
   */
  venuedAsLastRead?: boolean;
}

/**
 * Whether a place's recorded reason says it stood in the surroundings tier by
 * the venue test (ADR-0192): it entered or stayed by the venues around it, or
 * was kept while the venue test was unread. The reason is the cut's own note
 * (`surroundingsVerdict`), so its words are read here and nowhere else.
 */
export function standsByVenues(reason: string | null): boolean {
  if (reason === null) return false;
  // A kind's rule may put its own note before the cut's (`surroundingsLandmark`).
  if (reason.includes(VENUES_UNREAD_NOTE)) return true;
  const doors = /(?:^|\s)(?:In|Stays in) the surroundings tier ([^:]*):/.exec(reason)?.[1] ?? '';
  return doors.split(', the readers test read at')[0].includes(`by ${VENUES_DOOR}`);
}

/** The venue test's door, as a note names it. */
const VENUES_DOOR = 'the venues around it';
/** How a note opens where a held place was kept for the venue test the run could not read. */
const VENUES_UNREAD_NOTE = 'Kept in the surroundings tier, the venue test unread';

/** A place's own kind's places within the radius, for the venue test (ADR-0192): how many, and their best venue counts, highest first. */
export interface VenueSurroundings {
  groupSize: number;
  topVenues: readonly number[];
  /** Whether the place and its group are measured along their lines, in venues per 100 m (ADR-0194), rather than around their points. */
  along?: boolean;
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
  /** The kind's places around it, for a kind that reads venues and a layer that keeps them (ADR-0192). */
  venues?: VenueSurroundings;
}

/** The references off the best within the radius; null where no place around carries the signal. */
export interface SurroundingsReferences {
  editions: number | null;
  guide: number | null;
  readers: number | null;
  /** Absent for a kind that reads no venues; null where none is read or no place of the kind around has one. */
  venues?: number | null;
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

/** The tests a candidate passes against its references, the editions, readers and venue tests read at the shares given. */
function doorsOf(
  candidate: SurroundingsCandidate, around: Surroundings, reference: SurroundingsReferences, cut: SurroundingsCut,
  { editionsShare, readersShare, venueShare }: { editionsShare: number; readersShare: number; venueShare: number },
): string[] {
  const doors: string[] = [];
  if (around.groupSize >= cut.editionsGroupFloor && reference.editions !== null
    && candidate.editions >= editionsShare * reference.editions) doors.push('its editions');
  if (around.groupSize >= cut.readersGroupFloor && reference.readers !== null && candidate.readers > 0
    && candidate.readers >= readersShare * reference.readers) doors.push('its readers');
  if (around.groupSize >= cut.guideGroupFloor && reference.guide !== null && candidate.guideEditions !== null
    && candidate.guideEditions > 0 && candidate.guideEditions >= cut.guideShare * reference.guide) doors.push('the guides');
  // An artery is driven through, and the venues along it say nothing of a street walked for its life (ADR-0194).
  if ((around.venues?.groupSize ?? 0) >= cut.venueGroupFloor && typeof reference.venues === 'number' && typeof candidate.venues === 'number'
    && candidate.artery !== true
    && candidate.venues > 0 && candidate.venues >= venueShare * reference.venues) doors.push(VENUES_DOOR);
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
 * the tier holds (`held`) stays at the stay share of the readers' floor, of
 * the readers test (ADR-0175 decision 2) and of the editions test (ADR-0187).
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
  if (around.groupSize < smallest && !venuesDecide(candidate, around, cut, held)) {
    return { in: false, reason: `${around.groupSize} places of its density within ${cut.radiusKm} km, under the floor of ${smallest}: too few to measure against` };
  }
  const reference = referencesOf(candidate, around, cut);
  const within = surroundingsInWords(candidate, around, reference, cut, held);
  const enters = doorsOf(candidate, around, reference, cut, { editionsShare: cut.editionsShare, readersShare: cut.readersShare, venueShare: cut.venueShare });
  // A held place under the new-place floor is kept by the stay alone, and its note says so.
  const underFloor = candidate.readers < cut.minReaders;
  if (enters.length && !underFloor) return { in: true, reference, note: `In the surroundings tier ${doorsInWords(enters)}: ${within} (ADR-0171, ADR-0175, ADR-0181)` };
  return (held ? heldVerdict(candidate, around, reference, cut, within) : null)
    ?? { in: false, reason: `below the surroundings tier's cut: ${within}` };
}

/**
 * Whether the venue test can decide a place too few neighbours of its own
 * density measure: it reads an area of its own, the kind's places within the
 * radius (ADR-0192), and a held place that last stood by it is kept while the
 * run reads no venue. The other tests read their own group floors.
 */
function venuesDecide(candidate: SurroundingsCandidate, around: Surroundings, cut: SurroundingsCut, held: boolean): boolean {
  if (candidate.venues === undefined) return false;
  if (candidate.venues === null) return held && candidate.venuedAsLastRead === true;
  return (around.venues?.groupSize ?? 0) >= cut.venueGroupFloor;
}

/**
 * Whether a place the tier holds that enters by no test keeps its place: by a
 * test read at its stay share, or because the test it may stand by is one the
 * run could not read; null where it falls.
 */
function heldVerdict(
  candidate: SurroundingsCandidate, around: Surroundings, reference: SurroundingsReferences, cut: SurroundingsCut, within: string,
): SurroundingsVerdict | null {
  const stay = {
    editionsShare: cut.stayEditionsShare * cut.editionsShare, readersShare: cut.stayReadersShare * cut.readersShare,
    venueShare: cut.stayEditionsShare * cut.venueShare,
  };
  const stays = doorsOf(candidate, around, reference, cut, stay);
  if (stays.length) {
    const venueStay = candidate.venues === undefined ? '' : ` and the venue test at ${fmt(stay.venueShare)}`;
    return { in: true, reference, note: `Stays in the surroundings tier ${doorsInWords(stays)}, the readers test read at `
      + `${fmt(stay.readersShare)} times the reference and the editions test at ${fmt(stay.editionsShare)}${venueStay} for a place it holds: `
      + `${within} (ADR-0175, ADR-0181)` };
  }
  // The venue test is the one the run could not read: a held place that last
  // stood by it keeps its place until a layer that keeps the venues is in;
  // one that stood by another test falls by the tests the run did read. Read
  // before the guides' keep: the note is the venue test's only memory, while
  // the guides' is kept apart (`membership_fame`), so a street kept by its
  // guide's note would lose its venue mark at the next run.
  if (candidate.venues === null && candidate.venuedAsLastRead === true) {
    return { in: true, reference, note: `${VENUES_UNREAD_NOTE}: ${within} (ADR-0175 decision 6, ADR-0192)` };
  }
  // The guides' test is the one the run could not read: a held place a guide
  // used when last read, or that no build was ever read for, keeps its place
  // where the test reads its area; one no guide used when last read falls.
  if (candidate.guideEditions === null && candidate.guidedAsLastRead !== false && around.groupSize >= cut.guideGroupFloor) {
    return { in: true, reference, note: `Kept in the surroundings tier, the guides' test unread: ${within} (ADR-0175 decision 6, ADR-0181)` };
  }
  return null;
}

/**
 * The references off the best of the neighbours: no guide reference where no
 * guide's use is read, the neighbours' as the candidate's, and, for a kind that
 * reads venues, a venues reference off the best of the kind's places around.
 */
function referencesOf(candidate: SurroundingsCandidate, around: Surroundings, cut: SurroundingsCut): SurroundingsReferences {
  const best = (values: readonly number[]) => medianOf(values.filter((n) => n > 0).slice(0, cut.best));
  const references: SurroundingsReferences = {
    editions: best(around.topEditions),
    guide: candidate.guideEditions === null ? null : best(around.topGuideEditions),
    readers: best(around.topReaders),
  };
  if (candidate.venues === undefined) return references;
  return { ...references, venues: candidate.venues === null || !around.venues ? null : best(around.venues.topVenues) };
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
    + `${readers}, this place ${fmt(candidate.readers)}; ${guide}${venuesInWords(candidate, around, reference, cut)}`;
}

/** The venue test's clause, for a kind that reads venues (ADR-0192): what lies around the place, and around the liveliest of its kind. */
function venuesInWords(candidate: SurroundingsCandidate, around: Surroundings, reference: SurroundingsReferences, cut: SurroundingsCut): string {
  if (candidate.venues === undefined) return '';
  if (candidate.venues === null) return '; the OpenStreetMap layer in place keeps no café, restaurant or bar, so no venue is read (ADR-0191)';
  const along = candidate.venuesAlong;
  const artery = candidate.artery === true ? ', an artery the venue test lets in by nothing' : '';
  const own = along
    ? `${fmt(candidate.venues)} cafés, restaurants and bars per 100 m along its ${fmt(along.metres)} m of street${artery}`
    : `${fmt(candidate.venues)} cafés, restaurants and bars within ${fmt(cut.venueRadiusM)} m of this place${artery}`;
  const group = along ? 'streets of its kind read along their lines' : 'places of its kind';
  const anyOne = along ? 'any street of its kind read along its line' : 'any place of its kind';
  if (typeof reference.venues !== 'number') return `; ${own}, and none around ${anyOne} within ${cut.radiusKm} km`;
  return `; ${own}, the ${cut.best} liveliest of the ${fmt(around.venues?.groupSize ?? 0)} ${group} within ${cut.radiusKm} km `
    + `${fmt(reference.venues)} at the median`;
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
