/**
 * Classes first, then the entities, then what each of them is.
 *
 * Not five direct questions with whatever answers written down: this
 * collects the way the museum import does. It learns which classes count from
 * the class tree, asks for their instances by fame, fetches the facts about
 * each candidate and about what holds it, and only then decides — so every
 * row has a reason that can be named, and every refusal is filed with one.
 *
 * Nothing here decides anything on its own: the rule is `publicArtTest.ts`,
 * the lists are `classes.ts`, the questions are `queries.ts`. This file is
 * the wiring and the fame line.
 */

import { boundedClosure } from '../classClosure.js';
// The works-first kinds' root for a lost or destroyed work, read here too (#872).
import { LOST_WORK_ROOT } from '../museum/worksCollector.js';
import {
  fetchClassTree,
  fetchSubclasses,
  MUSEUM_ROOT,
  type QueryRunner,
} from '../wikidataQueries.js';
import {
  buildTrees,
  COMMEMORATIVE_ROOTS,
  FOUNTAIN_ROOT,
  SCULPTURAL_ROOTS,
  WORSHIP_ROOT,
  type PublicArtTrees,
} from './classes.js';
import { belowLineReason, lineStanding, type LinePair } from '../sourceLine.js';
import { artworkDoorNote, type PlaceDoor, type ReadershipDoor } from '../readershipDoor.js';
import { publicArtVerdict, type PublicArtFacts } from './publicArtTest.js';
import { streetArtVerdict } from './streetArtTest.js';
import { enterStreetArtPlaces, type StreetArtReading } from './streetArtPlaces.js';
import type { KindFacts, KindRule } from './kindRules.js';
import { CAST_GROUP, emptyFacts, fetchCastGroupPool, type PoolEntity, type EntityFacts } from './queries.js';
import { attachCasts, fetchCastItems } from './castGroups.js';
import type { PlaceKind } from '../places/gather.js';
import { chainOf, ownersOf, type Containment } from '../places/containment.js';
import type { SubjectFacts } from './subjects.js';
import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';

/**
 * The world tier's fame line, and the same one the museums use (ADR-0023):
 * a row enters at 22 Wikipedia-language sitelinks and stays until it falls
 * below 18, so the list does not flap as Wikipedia grows. Belonging to the
 * tier is the Iconic badge (ADR-0045 decision 5); the regional tier, which
 * carries none, is filled from regional sources by the rules of
 * docs/tech/filling-a-kind.md (ADR-0048).
 */
export const ENTER_SITELINKS = 22;
export const STAY_SITELINKS = 18;

/**
 * Those two as the pair every kind's line standing is asked with
 * (`sourceLine.ts`). This source states its line in code rather than on its row,
 * so the pair is built here; what is asked of it — in, out, or fallen by name —
 * and the sentence a fallen row is refused with are the shared ones, written
 * once for the whole catalogue (#884).
 */
const LINE: LinePair = { enterSitelinks: ENTER_SITELINKS, staySitelinks: STAY_SITELINKS };

/**
 * The four classes broad enough to need bands: `monument` and `memorial` in
 * the heritage sense have tens of thousands of instances, `sculpture` and
 * `statue` more. Their labels are for the phase message only; the type a
 * reader sees is decided by the verdict.
 */
const BROAD_ROOTS = [
  { qid: 'Q860861', label: 'sculpture' },
  { qid: 'Q179700', label: 'statue' },
  { qid: 'Q4989906', label: 'monument' },
  { qid: 'Q5003624', label: 'memorial' },
];

export interface CollectedPublicArt {
  items: WikidataLandmark[];
  /** Distinct entities the pool named. */
  fetched: number;
  filtered: FilteredEntity[];
  /**
   * The works part of which another kind holds: the held casts of a group of
   * casts that passed the rule, whatever the line decided of it (#2036),
   * recorded as hand-overs (ADR-0102).
   */
  handOvers: FilteredEntity[];
}

/**
 * What the gather read, before any kind's rule decided anything: the class
 * trees, every candidate the admitting classes name, and the facts about each
 * of them and about what holds it. The sources of a pass read it whole
 * (ADR-0132), each through its own classification.
 */
export interface GatheredPublicArt {
  trees: PublicArtTrees;
  pool: Map<string, PoolEntity>;
  facts: Map<string, EntityFacts>;
  containers: Containment;
  /** What the candidates depict, by item id. */
  subjects: Map<string, SubjectFacts>;
  /** The candidates the street-art entrance named (`enterStreetArtPlaces`). */
  entered: ReadonlySet<string>;
  /** The ones of those no class question named and no source of the pass admits. */
  enteredOnly: ReadonlySet<string>;
}

async function collectTrees(run: QueryRunner): Promise<PublicArtTrees> {
  // A step before every hop, as the museum walk does: each hop is one query,
  // and the runner's step is where the pacing is spent and a cancel is heard.
  const children = async (qids: string[]) => {
    await run.step();
    return fetchSubclasses(run.sparql, qids);
  };

  run.phase('Walking the class tree under sculpture and statue...');
  const sculptural = await boundedClosure(Object.keys(SCULPTURAL_ROOTS), children);
  run.phase('Walking the class trees under fountain, war memorial and cenotaph...');
  const fountain = await boundedClosure([FOUNTAIN_ROOT], children);
  const commemorative = await boundedClosure(Object.keys(COMMEMORATIVE_ROOTS), children);
  for (const refusal of [...sculptural.refused, ...fountain.refused, ...commemorative.refused]) {
    console.log(`[Landmark Sync] Closure under ${refusal.root} stopped at hop ${refusal.hop}: ${refusal.offered} classes offered`);
  }

  run.phase('Reading what a museum and a place of worship are...');
  await run.step();
  const museum = await fetchClassTree(run.sparql, MUSEUM_ROOT, 'museum classes');
  await run.step();
  const worship = await fetchClassTree(run.sparql, WORSHIP_ROOT, 'places of worship');
  // The works-first kinds' tree for "nothing to stand in front of" (#872): a
  // `destroyed artwork` without the `lost sculpture` class beside it would
  // otherwise pass here and be refused there.
  await run.step();
  const lost = await fetchClassTree(run.sparql, LOST_WORK_ROOT, 'lost artwork classes');

  return buildTrees({
    sculptural: sculptural.classes,
    fountain: fountain.classes,
    commemorative: commemorative.classes,
    museum,
    worship,
    lost,
  });
}

/**
 * Public art and Monuments & memorials as the place gather reads them
 * (`places/gather.ts`): the trees their rules read, and the classes whose
 * instances are their candidates — the broad roots in bands, then every other
 * class a kind admits. The two kinds share one declaration, since both rules
 * read the same trees and each refuses what the other admits by name.
 */
export const PUBLIC_ART_KIND: PlaceKind<PublicArtTrees> = {
  name: 'public art and monuments',
  trees: collectTrees,
  // A group of casts is asked for by its class too, so a group with a point of
  // its own (the Burghers of Calais) is a candidate; its casts are read below.
  poolClasses: (trees) => ({ broad: BROAD_ROOTS, narrow: [...trees.admitting, CAST_GROUP] }),
  readsContainers: true,
  readsSubjects: true,
  editions: {
    enter: fetchCastGroupPool,
    attach: readCastGroups,
  },
  // The street-art places no class names (#2035): Public art decides them by
  // their own rule, Monuments & memorials skips the ones it does not admit.
  entrance: enterStreetArtPlaces,
};

/**
 * The casts of every group of casts among the candidates, written onto the
 * group (#880, ADR-0145 decision 2b): the group carries the fame and enters the
 * pool, its casts carry the points and the classes the rule reads.
 */
async function readCastGroups(run: QueryRunner, pool: Map<string, PoolEntity>, facts: Map<string, EntityFacts>): Promise<void> {
  const groups = [...pool.keys()].filter(qid => facts.get(qid)?.classes.includes(CAST_GROUP));
  if (!groups.length) return;
  run.phase(`Reading the casts of ${groups.length} groups of casts...`);
  for (const [group, casts] of await fetchCastItems(run, groups)) {
    const entity = pool.get(group);
    if (entity) attachCasts(entity, facts.get(group), casts);
  }
}

/**
 * The row the run writes for an admitted entity: the pool's facts, the
 * verdict's type, and an edition's casts (#880) — of a group of casts, only the
 * ones the verdict found open to a passer-by (#2036).
 */
function landmarkOf(
  entity: PoolEntity, lat: number, lon: number, known: EntityFacts,
  verdict: { type: WikidataLandmark['type']; artwork: boolean; openCasts?: number[] },
): WikidataLandmark {
  const { openCasts } = verdict;
  const casts = openCasts ? entity.casts?.filter((_, i) => openCasts.includes(i)) : entity.casts;
  return {
    qid: entity.qid,
    label: entity.label,
    description: entity.description,
    lat,
    lon,
    ...(casts ? {
      casts: casts.map(cast => ({ name: cast.placeLabel, lat: cast.lat, lon: cast.lon, countryLabel: cast.countryLabel })),
    } : {}),
    imageUrl: entity.imageUrl,
    itemPictures: entity.itemPictures,
    creators: known.creators,
    year: entity.year,
    sitelinks: entity.sitelinks,
    countryLabel: entity.countryLabel,
    type: verdict.type,
    classes: known.classes,
    artwork: verdict.artwork,
    articleUrl: entity.articleUrl,
    website: entity.website,
  };
}

/** What a kind's `admits` and `type` read of a candidate. */
function kindFactsOf(known: EntityFacts, subjects: Map<string, SubjectFacts>): KindFacts {
  return {
    classes: known.classes,
    commemorates: known.commemorates,
    genres: known.genres,
    subjects: known.depicts.flatMap((qid) => subjects.get(qid) ?? []),
  };
}

/**
 * The candidates the street-art rule decides rather than the kind's own: the
 * ones the entrance named that no class of the kind admits. A sculpture a
 * graffiti category also files stays the kind's.
 */
export function streetArtCandidates(gathered: GatheredPublicArt, rule: KindRule): string[] {
  return [...gathered.entered].filter((qid) => {
    const known = gathered.facts.get(qid) ?? emptyFacts();
    return !rule.admits(kindFactsOf(known, gathered.subjects), gathered.trees);
  });
}

/** The street-art rule's verdict on one candidate, read off the gather and the reading. */
function streetArtVerdictOf(entity: PoolEntity, gathered: GatheredPublicArt, reading: StreetArtReading, held: boolean) {
  const known = gathered.facts.get(entity.qid) ?? emptyFacts();
  const marks = reading.marks.get(entity.qid);
  return streetArtVerdict({
    qid: entity.qid,
    classes: known.classes,
    excludedRoots: [...new Set(known.classes.flatMap((c) => reading.roots.get(c) ?? []))],
    atlasObscura: marks?.atlasObscura ?? false,
    guided: reading.guided.has(entity.qid),
    readers: reading.readers === null ? null : reading.readers.get(entity.qid) ?? 0,
    ended: marks?.ended ?? false,
    admitted: held,
    onEarth: entity.onEarth,
    lat: entity.lat,
    lon: entity.lon,
  }, gathered.trees);
}

/** The kind's verdict on one candidate of the share, read off the gathered facts. */
function verdictOf(
  entity: PoolEntity,
  { trees, facts, containers, subjects }: GatheredPublicArt,
  rule: KindRule,
  offered?: ReadonlySet<string>,
) {
  const known = facts.get(entity.qid) ?? emptyFacts();
  return publicArtVerdict({
    qid: entity.qid,
    classes: known.classes,
    containers: chainOf(known, containers),
    collections: ownersOf(known, containers),
    commemorates: known.commemorates,
    depicts: known.depicts,
    genres: known.genres,
    subjects: known.depicts.flatMap((qid) => subjects.get(qid) ?? []),
    ...castsJudged(entity, containers),
    onEarth: entity.onEarth,
    lat: entity.lat,
    lon: entity.lon,
  }, trees, rule, offered);
}

/**
 * The casts a group of casts is judged at (#2036): every cast item, in the
 * entity's order, with what its own placements stand in — a cast placed nowhere
 * stands where its point is. Nothing for an edition read off one item's
 * coordinates, whose casts are no items with a place of their own.
 */
function castsJudged(entity: PoolEntity, containers: Containment): Pick<PublicArtFacts, 'casts'> {
  const casts = entity.casts ?? [];
  if (!casts.some((cast) => cast.placements)) return {};
  return { casts: casts.map((cast) => ({
    containers: chainOf({ ...emptyFacts(), locations: cast.placements ?? [] }, containers),
    ...(cast.classes ? { classes: cast.classes } : {}),
  })) };
}

/**
 * How a work that passed the rule stands: in by the line, in by the readership
 * door with the curator's question, fallen below the stay line, or never in.
 * The door's question goes only on a work the door alone lets in: one the line
 * keeps is in whatever it reads.
 */
function lineOrDoor(
  entity: PoolEntity,
  held: boolean,
  door: ReadershipDoor | null,
): { readershipNote?: string } | 'fell' | 'out' {
  const standing = lineStanding(entity.sitelinks, held, LINE);
  if (standing === 'in') return {};
  const read = door?.opened.get(entity.qid);
  if (read && door) return { readershipNote: artworkDoorNote(read, door) };
  return standing;
}

/**
 * What a candidate comes to: a row, a refusal, or nothing, and, beside any of
 * them, the hand-over of the casts it has in a museum (#2036).
 */
type Decision =
  | { item: WikidataLandmark; handOver?: FilteredEntity }
  | { refused: FilteredEntity; handOver?: FilteredEntity }
  | { handOver: FilteredEntity }
  | null;

/**
 * The street-art rule's decision on a candidate it decides, or undefined where
 * the kind's own rule decides it: the street-art rule decides what it admits,
 * what the source holds and what only its entrance brought, so a newcomer a
 * class of the kind also named and the street-art rule does not admit keeps
 * the kind's reason.
 */
function streetArtDecision(
  entity: PoolEntity, gathered: GatheredPublicArt, reading: StreetArtReading, held: boolean,
): Decision | undefined {
  const says = streetArtVerdictOf(entity, gathered, reading, held);
  if (!says.pass && !held && !gathered.enteredOnly.has(entity.qid)) return undefined;
  if (says.pass) {
    // The verdict refused anything placeless; this narrows the type. The
    // street-art reading is what answered the kind here, as an artwork class
    // answers a building's veto: the catalogue check reads this answer rather
    // than the classes, which name a wall or a road.
    if (entity.lat === null || entity.lon === null) return null;
    const known = gathered.facts.get(entity.qid) ?? emptyFacts();
    return { item: landmarkOf(entity, entity.lat, entity.lon, known, { type: says.type, artwork: true }) };
  }
  if (says.quiet) return null;
  return { refused: { externalId: entity.qid, name: entity.label, reason: says.reason, ...(held ? { type: 'street-art' } : {}) } };
}

/**
 * The kind's own decision on a candidate: its verdict, then the fame line or
 * the readership door. A candidate only the street-art entrance named is not
 * the kind's: the gather leaves every row a source of the pass holds out of
 * `enteredOnly`.
 */
function kindDecision(
  entity: PoolEntity,
  gathered: GatheredPublicArt,
  rule: KindRule,
  held: boolean,
  offered: ReadonlySet<string> | undefined,
  door: ReadershipDoor | null,
): Decision {
  // A candidate the entrance alone brought is the street-art rule's or nobody's.
  if (gathered.enteredOnly.has(entity.qid)) return null;
  const known = gathered.facts.get(entity.qid) ?? emptyFacts();
  // On a refusal of a row the source admits, the type the classes read: a
  // curator may have put it back, and a put-back is filed under it too
  // (`filePutBackTypes`, ADR-0135).
  const type = held ? { type: rule.type(kindFactsOf(known, gathered.subjects), gathered.trees) } : {};
  const verdict = verdictOf(entity, gathered, rule, offered);
  if (!verdict.pass) {
    return { refused: {
      externalId: entity.qid, name: entity.label, reason: verdict.reason, ...type,
      // Where it is held, for the kind that holds that place to take it (ADR-0102).
      ...(verdict.heldIn ? { heldIn: verdict.heldIn } : {}),
    } };
  }
  // The verdict refused anything placeless above; this narrows the type,
  // it cannot fire.
  if (entity.lat === null || entity.lon === null) return null;
  // A cast in a museum is the museum's whatever the line says of the group.
  const handOver = verdict.handOver ? { handOver: { externalId: entity.qid, name: entity.label, ...verdict.handOver } } : null;
  const entry = lineOrDoor(entity, held, door);
  if (entry === 'out') return handOver;
  if (entry === 'fell') {
    return { refused: { externalId: entity.qid, name: entity.label, reason: belowLineReason(entity.sitelinks, LINE), ...type }, ...handOver };
  }
  // The museum's changeset names the reason, and here this kind admits the
  // work: the reason says so rather than reading as a refusal.
  const admitted = handOver && { handOver: { ...handOver.handOver, reason: `taken as ${rule.noun} at its other casts; a cast ${handOver.handOver.reason}` } };
  return { item: { ...landmarkOf(entity, entity.lat, entity.lon, known, verdict), ...entry }, ...admitted };
}

/**
 * Decide what of the gather is of the kind `rule` names: the candidates that
 * pass it and clear the fame line, and every candidate it refused, with the
 * reason it gave.
 *
 * `admitted` is what the source holds as admitted before the run, so the
 * stay line has something to hold. `offered` is the places another kind offers a
 * reader, which decides whether a work outdoors on a venue's grounds is
 * stranded there (#1444). `door` is the readership door over the share
 * (`openArtworkDoor`): a work it opened for stands in as one at the line does,
 * and carries the curator's question. `streetArt` is what the street-art rule
 * reads of the candidates it decides (`streetArtCandidates`), for the kind that
 * holds them; without it, a candidate only the street-art entrance named is not
 * this kind's and is skipped. Items come back most famous first, which
 * is the order the run writes them in and the order a person watching it
 * reads.
 */
export function classifyPublicArt(
  gathered: GatheredPublicArt,
  rule: KindRule,
  admitted: ReadonlySet<string>,
  offered?: ReadonlySet<string>,
  door: ReadershipDoor | null = null,
  streetArt: StreetArtReading | null = null,
): CollectedPublicArt {
  const { pool } = gathered;
  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  const handOvers: FilteredEntity[] = [];
  const decidedAsStreetArt = new Set(streetArt ? streetArtCandidates(gathered, rule) : []);
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  for (const entity of candidates) {
    const held = admitted.has(entity.qid);
    const streetArtSays = streetArt && decidedAsStreetArt.has(entity.qid)
      ? streetArtDecision(entity, gathered, streetArt, held) : undefined;
    const decision = streetArtSays === undefined ? kindDecision(entity, gathered, rule, held, offered, door) : streetArtSays;
    if (decision && 'item' in decision) items.push(decision.item);
    else if (decision && 'refused' in decision) filtered.push(decision.refused);
    if (decision?.handOver) handOvers.push(decision.handOver);
  }

  const byDoor = items.filter((item) => item.readershipNote).map((item) => item.label);
  console.log(
    `[Landmark Sync] Pool of ${pool.size} for ${rule.noun}: ${items.length} admitted, ${filtered.length} refused, `
    + `${pool.size - items.length - filtered.length} below the line and never in`
    + (byDoor.length ? `; the readership door admitted ${byDoor.join(', ')}` : ''),
  );
  return { items, fetched: pool.size, filtered, handOvers };
}

/**
 * The readership door over the share (#2033, ADR-0127), or null where none is
 * open. The bar is read over the works the source holds at the line, not over
 * every candidate at it, where works indoors that the rule refuses (the Pietà,
 * the Venus de Milo) would set it; so the door is handed every candidate below
 * the line and the held works the rule still passes: a held work it now
 * refuses is leaving and sets no bar.
 */
export async function openArtworkDoor(
  openDoor: PlaceDoor | undefined,
  gathered: GatheredPublicArt,
  admitted: ReadonlySet<string>,
  rule: KindRule,
  offered?: ReadonlySet<string>,
): Promise<ReadershipDoor | null> {
  if (!openDoor) return null;
  // A candidate the entrance alone brought is the street-art rule's: it neither
  // sets the door's bar nor walks through it.
  return openDoor(
    [...gathered.pool.values()]
      .filter((entity) => !gathered.enteredOnly.has(entity.qid))
      .filter((entity) => entity.sitelinks < ENTER_SITELINKS
        || (admitted.has(entity.qid) && verdictOf(entity, gathered, rule, offered).pass))
      .map((entity) => ({ qid: entity.qid, sitelinks: entity.sitelinks })),
    admitted,
  );
}
