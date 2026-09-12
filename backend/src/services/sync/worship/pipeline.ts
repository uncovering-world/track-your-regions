/**
 * A place of worship is in the catalogue for one of two reasons, and both are
 * nameable: the world knows the building, or the building holds something the
 * world knows.
 *
 * Door one is the public-art shape over the worship tree, and it lives in
 * `places.ts`. Door two is the museum's shape with this kind's rule: the same
 * works pool, the same venue graph, the same placement and folds
 * (`museum/worksCollector.ts`), with a `VenueRule` whose classes are the
 * worship tree and whose site veto is off — the veto exists to keep a church
 * from being called a museum, and here the church is the point.
 *
 * One precedence decides between them where both could claim a work: a work
 * the *museum* rule places anywhere is a museum's. The Creation of Adam is
 * owned by the Vatican Museums and located in the Sistine Chapel, and a
 * traveller who has seen it has been to the Vatican Museums — so the chapel
 * enters on its own fame, with no works of ours, and the fresco stays where the
 * museum import already puts it. A work nobody can see — lost, destroyed, or of
 * unknown whereabouts — opens no door at all, and that is the shared collector's
 * reading (`LOST_WORK_ROOT` and `whereaboutsUnknown`, #868): it arrives here
 * placed nowhere.
 *
 * The folds are the museum import's as well, narrowed once by this kind:
 * a chapel folds only onto a survivor this kind could admit, so a chapel is
 * never taken out of the catalogue by a fold onto a row the rule refuses
 * (`foldsOntoAdmitted`).
 *
 * This file is the wiring and the union: nothing here decides what a place of
 * worship is (`worshipTest.ts`), which classes count (`classes.ts`), or where a
 * work hangs (`museum/placement.ts`).
 */

import { placeArtwork } from '../museum/placement.js';
import { selectTier1, type Tier1Result } from '../museum/tier1.js';
import { diffPlacements, type PlacementDiff } from '../museum/placementDiff.js';
import { museumRule, type VenueRule } from '../museum/venueTest.js';
import { applyFolds, makeResolver, survivorOf, type VenueGraph } from '../museum/venueGraph.js';
import type { Fold } from '../museum/venueFolds.js';
import { fetchMuseumClasses, type PoolWork } from '../museum/queries.js';
import {
  collectWorks,
  heldBy,
  toContent,
  MUSEUM_BROAD_ROOTS,
  MUSEUM_WHOLE_ROOTS,
  MUSEUM_PINNED_CLASSES,
  MUSEUM_PINNED_EDITION_CLASSES,
  EDITION_ROOT,
  type WorksCollection,
} from '../museum/worksCollector.js';
import { fetchWorshipTrees, fetchTreasureClasses } from './queries.js';
import { collectPlacesByFame, type PlaceCandidate } from './places.js';
import { worshipVerdict } from './worshipTest.js';
import type { WorshipTrees, WorshipType } from './classes.js';
import type { SourceLine } from '../sourceLine.js';
import type { ClosureOptions } from '../classClosure.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import type { FilteredEntity } from '../syncOrchestrator.js';
import type { ProcessedContent } from '../types.js';

const LOG_PREFIX = '[Worship Sync]';

/** The noun a phase line and a coverage sentence of this kind use. */
const WORSHIP_NOUN = { work: 'treasure', works: 'treasures' };

export interface CollectedPlaceOfWorship {
  qid: string;
  label: string;
  description: string | null;
  lat: number;
  lon: number;
  imageUrl: string | null;
  sitelinks: number;
  countryLabel: string | null;
  articleUrl: string | null;
  website: string | null;
  /** What a reader filters it by, or nothing where none of the eight words fits. */
  type: WorshipType | null;
  classes: string[];
  /** What it holds that is worth tracking on its own: a relic, a tomb, an altarpiece. */
  artworks: ProcessedContent[];
  /** The work that admitted it, where a work did — the most famous of them. */
  admittedFor?: { qid: string; label: string };
  door: 'place' | 'work' | 'both';
}

export interface CollectedWorship {
  items: CollectedPlaceOfWorship[];
  /** Distinct entities the two pools named: places by class, and works. */
  fetched: number;

  filtered: FilteredEntity[];
  diff: PlacementDiff;
}

export interface WorshipPipelineDeps {
  sparql: SparqlFn;
  /** Where the previous run left each work, so this run can say what it moved. */
  previousPlacements: Record<string, string[]>;
  /** What the source holds as admitted before the run, so the stay line has something to hold. */
  admitted: ReadonlySet<string>;
  /** The fame line the source row states (`sourceLine.ts`). */
  line: SourceLine;
  onPhase?: (message: string) => void;
  /** Throws to abandon the run; called before every query. */
  checkCancel?: () => void;
  /** Rate limiting between queries. The test passes nothing. */
  pause?: () => Promise<void>;
  closure?: ClosureOptions;
}

/** A door-two venue the rule admits, with the iconic works that named it. */
interface AdmittedVenue {
  iconic: string[];
  type: WorshipType | null;
}

function makeRun(deps: WorshipPipelineDeps): QueryRunner {
  return {
    sparql: deps.sparql,
    phase: (message) => deps.onPhase?.(message),
    step: async () => {
      deps.checkCancel?.();
      if (deps.pause) await deps.pause();
    },
  };
}

// =============================================================================
// Door two: the works
// =============================================================================

/**
 * The works this kind may open a door with: the placed ones that still exist
 * and that no museum claims.
 *
 * **Museum wins.** Both rules read the same statements, and a work whose owner
 * or location the museum rule resolves is one the museum import already writes
 * — the Creation of Adam (P195 Vatican Museums, P276 Sistine Chapel) among
 * them. Asked of the raw statements rather than of this run's placements,
 * because the question is what the museum rule *would* make of the work, not
 * what the worship rule made of it.
 *
 * **A lost work opens nothing.** The Statue of Zeus at Olympia is one of the
 * seven wonders and has not existed for sixteen centuries; its temple stands on
 * its own fame or not at all. The shared collector already placed it nowhere
 * (`unseen`), so it never reaches this loop; the count is for the log line.
 */
function ourWorks(
  works: WorksCollection,
  museumClasses: ReadonlySet<string>,
  trees: WorshipTrees,
  placeClasses: Map<string, string[]>,
): Record<string, string[]> {
  const museums = makeResolver(works.graph, museumRule(museumClasses));
  const ours: Record<string, string[]> = {};
  const lost = Object.keys(works.unseen).length;
  let places = 0;
  let museumsWon = 0;
  for (const [qid, venues] of Object.entries(works.afterFolds)) {
    if (!venues.length) continue;
    const work = works.pool.get(qid);
    if (!work) continue;
    if (isItselfAPlace(qid, work, trees, placeClasses)) { places++; continue; }
    const atAMuseum = placeArtwork(
      works.statements.get(qid) ?? [], museums.resolve, works.graph.ancestors,
    );
    if (atAMuseum.length) { museumsWon++; continue; }
    ours[qid] = venues;
  }
  console.log(
    `${LOG_PREFIX} Works placed in a place of worship: ${Object.keys(ours).length}; `
    + `${museumsWon} left to the museum that holds them, ${places} places in their own right, `
    + `${lost} that nobody can see`,
  );
  return ours;
}

/**
 * A work that is itself a place of worship is a place, never a treasure.
 *
 * The two doors read overlapping class lists: 13 classes lie in both the
 * treasure trees and the worship tree (measured on the run's own cached trees,
 * 2026-09-09 — imamzadeh, chapel tomb, temple-tomb, heroön, Keramat and the
 * Japanese memorial towers, kuyō-tō and banreitō among them). Without this, the
 * Cavern of the Patriarchs — a mosque and a synagogue that the tomb tree also
 * collects — would be admitted as a place at one door and written as somebody's
 * treasure at the other.
 *
 * Two sources for what the row is. The works pool carries one class — the one
 * the work was collected under — and the Cavern arrives there as a tomb; the
 * places pool carries every `P31` of every entity it named, which is where its
 * mosque class is. A row too obscure for the places pool (below its floor, or
 * named by no class question) is judged on its collected class alone.
 */
function isItselfAPlace(
  qid: string,
  work: PoolWork,
  trees: WorshipTrees,
  placeClasses: Map<string, string[]>,
): boolean {
  const own = [...(placeClasses.get(qid) ?? []), ...(work.typeQid ? [work.typeQid] : [])];
  return own.some((cls) => trees.worship.has(cls));
}

/**
 * Which venues a work admits as places: the tier's holders that this kind's own
 * rule would admit anyway.
 *
 * The venue test says whether an entity can *hold* a work — a class of the
 * worship tree, and coordinates — and that is not the same question as whether
 * the catalogue admits the place. The kill list is door one's: the Temple Mount
 * is typed both `mosque` and `hill`, and a traveller who has stood on it has
 * not thereby visited the Dome of the Rock, which is its own row. So the same
 * rule runs here, minus the fame line, which is exactly what this door exists
 * to bypass. The rule itself is `graphVerdict` below, which the fold filter
 * asks too, so the two cannot answer differently about one row.
 */
function admitVenues(
  tier: Tier1Result,
  graph: VenueGraph,
  trees: WorshipTrees,
): { venues: Map<string, AdmittedVenue>; refused: FilteredEntity[] } {
  const venues = new Map<string, AdmittedVenue>();
  const refused: FilteredEntity[] = [];
  for (const [qid, iconic] of tier.museums) {
    const verdict = graphVerdict(qid, graph, trees);
    if (!verdict) continue;
    if (!verdict.pass) {
      refused.push({ externalId: qid, name: graph.details.get(qid)?.label ?? qid, reason: verdict.reason });
      continue;
    }
    venues.set(qid, { iconic, type: verdict.type });
  }
  return { venues, refused };
}

/**
 * Door one's rule asked of a row the venue graph knows, or nothing where the
 * graph cannot answer — no details row, or no coordinates of its own.
 *
 * `onEarth` is passed as true for the reason `admitVenues` gives: the graph does
 * not record which globe a coordinate is on, and reaching this rule already
 * required one.
 */
function graphVerdict(
  qid: string,
  graph: VenueGraph,
  trees: WorshipTrees,
): ReturnType<typeof worshipVerdict> | undefined {
  const row = graph.details.get(qid);
  const facts = graph.facts(qid);
  if (!row || !facts || row.lat === null || row.lon === null) return undefined;
  return worshipVerdict(
    { qid, classes: facts.classes, onEarth: true, lat: row.lat, lon: row.lon }, trees,
  );
}

/**
 * The same collection with only the folds that land on a place this kind could
 * admit, and the placements moved again over what is left.
 *
 * A fold picks its survivor by distance and container — the museum import's
 * rules, which know nothing about worship — and the kind's own verdict is asked
 * of that survivor only afterwards, at `admitVenues`. So a chapel could be
 * folded into a row the kind refuses and taken out of the catalogue with its
 * works: on log 102 the **Cappella Paolina** (17 sitelinks) folded into the
 * **Apostolic Palace** 177 m away, which the kill list refuses as a `palace of
 * the Popes`, and Michelangelo's last two frescoes went with it. Dropping that
 * fold leaves the chapel standing as its own place, admitted through door two
 * for the frescoes it holds.
 *
 * The test is the survivor's, followed to the end of its chain: a place door one
 * already admits, or one this kind's rule would admit — which is enough, because
 * a survivor the rule admits that receives an iconic work is admitted by door
 * two for it, while a survivor the rule refuses can never be admitted at all.
 * Two of log 102's folds land on a row the rule admits and the *line* leaves out
 * — the Temple of Amun at Karnak into the Precinct of Amun-Re (18 sitelinks) and
 * the Santuari vell de Meritxell into Our Lady of Meritxell — and those folds
 * stand: the works they carry are below the line too, so nothing the catalogue
 * would have written is lost.
 */
function foldsOntoAdmitted(
  works: WorksCollection,
  byFame: ReadonlySet<string>,
  trees: WorshipTrees,
): WorksCollection {
  const folds: Record<string, Fold> = {};
  for (const [qid, fold] of Object.entries(works.folds)) {
    const survivor = survivorOf(works.folds, qid);
    if (byFame.has(survivor) || graphVerdict(survivor, works.graph, trees)?.pass) {
      folds[qid] = fold;
    }
  }
  return { ...works, folds, afterFolds: applyFolds(works.placed, folds) };
}

/**
 * A venue that received a work of ours and then folded into another is a place
 * the run proposed and no longer does, so it is reported as a loss with the
 * reason the fold rule gave. A fold of a venue that held nothing is not
 * reported — a line about it would count a loss the catalogue did not have.
 */
function foldLosses(works: WorksCollection, ours: Record<string, string[]>): FilteredEntity[] {
  // Measured on the works that are still ours after the museum, the lost and
  // the place filters: a venue whose only work went to the museum that owns it
  // lost this run nothing, and a line about it would count a loss that is not
  // one. Their pre-fold placements, because the question is which venue
  // received a work and then folded away.
  const received = new Set(Object.keys(ours).flatMap((qid) => works.placed[qid] ?? []));
  const nameOf = (qid: string) => works.graph.details.get(qid)?.label ?? qid;
  return Object.entries(works.folds)
    .filter(([qid]) => received.has(qid))
    .map(([qid, fold]) => ({
      externalId: qid,
      name: nameOf(qid),
      reason: `folded into ${nameOf(fold.into)} — ${fold.why}, ${fold.metres} m away`,
    }));
}

// =============================================================================
// What the run hands back
// =============================================================================

/** The most famous of the works that admitted a place: the one its card names. */
function admittingWork(
  iconic: string[],
  pool: Map<string, PoolWork>,
): { qid: string; label: string } | undefined {
  const best = iconic
    .map((qid) => pool.get(qid))
    .filter((work): work is PoolWork => !!work)
    .sort((a, b) => b.sitelinks - a.sitelinks)[0];
  return best ? { qid: best.qid, label: best.label } : undefined;
}

function itemOf(
  qid: string,
  byFame: PlaceCandidate | undefined,
  venue: AdmittedVenue | undefined,
  graph: VenueGraph,
  works: PoolWork[],
  pool: Map<string, PoolWork>,
): CollectedPlaceOfWorship | undefined {
  const row = byFame?.entity ?? graph.details.get(qid);
  if (!row || row.lat === null || row.lon === null) return undefined;
  const classes = byFame?.classes ?? graph.facts(qid)?.classes ?? [];
  let door: CollectedPlaceOfWorship['door'] = 'work';
  if (byFame) door = venue ? 'both' : 'place';
  return {
    qid,
    label: row.label,
    description: row.description,
    lat: row.lat,
    lon: row.lon,
    imageUrl: row.imageUrl,
    sitelinks: row.sitelinks,
    countryLabel: row.countryLabel,
    articleUrl: row.articleUrl,
    website: row.website,
    type: byFame?.type ?? venue?.type ?? null,
    classes,
    artworks: works.map(toContent),
    admittedFor: venue ? admittingWork(venue.iconic, pool) : undefined,
    door,
  };
}

// =============================================================================
// The pipeline
// =============================================================================

export async function collectPlacesOfWorship(deps: WorshipPipelineDeps): Promise<CollectedWorship> {
  const run = makeRun(deps);
  const trees = await fetchWorshipTrees(run);
  const byFame = await collectPlacesByFame(run, trees, deps.admitted, deps.line);

  const extraClasses = await fetchTreasureClasses(run);
  run.phase('Fetching the classes a museum can be...');
  await run.step();
  const museumClasses = await fetchMuseumClasses(run.sparql);

  // The veto that keeps a church from being called a museum is off: here the
  // church is the venue, and the noun is what a refusal will be named with.
  const rule: VenueRule = { classes: trees.worship, siteVeto: false, noun: 'place of worship' };
  const collected = await collectWorks(run, {
    broadRoots: MUSEUM_BROAD_ROOTS,
    wholeRoots: MUSEUM_WHOLE_ROOTS,
    pinned: MUSEUM_PINNED_CLASSES,
    extraClasses,
    pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES,
    editionRoot: EDITION_ROOT,
    noun: WORSHIP_NOUN,
    rule,
    closure: deps.closure,
    logPrefix: LOG_PREFIX,
  });
  // A fold may only hand a chapel's works to a place this kind could admit.
  const works = foldsOntoAdmitted(collected, new Set(byFame.places.keys()), trees);

  run.phase('Deciding which places their treasures admit...');
  const ours = ourWorks(works, museumClasses, trees, byFame.classesOf);
  const tier = selectTier1([...works.pool.values()].map((work) => ({
    qid: work.qid,
    sitelinks: work.sitelinks,
    venues: ours[work.qid] ?? [],
    multipleMedium: work.typeQid !== null && works.editionClasses.has(work.typeQid),
  })), { threshold: deps.line.enterSitelinks });
  const { venues, refused } = admitVenues(tier, works.graph, trees);

  // What the run will actually write: a work is stored as a treasure of a place
  // this run admits — through either door, since a place admitted for its own
  // fame lists what it holds too — so the diff is measured against the same
  // thing the database will hold.
  const admitted = new Set([...byFame.places.keys(), ...venues.keys()]);
  const current: Record<string, string[]> = {};
  for (const qid of works.pool.keys()) {
    current[qid] = (ours[qid] ?? []).filter((venue) => admitted.has(venue));
  }
  const held = heldBy(works.pool, current);

  const items: CollectedPlaceOfWorship[] = [];
  for (const qid of admitted) {
    const item = itemOf(
      qid, byFame.places.get(qid), venues.get(qid), works.graph, held.get(qid) ?? [], works.pool,
    );
    if (item) items.push(item);
  }
  items.sort((a, b) => b.sitelinks - a.sitelinks);

  // A place this run admits is not also a refusal, whichever door refused it:
  // the Temple Mount is refused at both, and says so once.
  const filtered = new Map<string, FilteredEntity>();
  const add = (entry: FilteredEntity): void => {
    if (admitted.has(entry.externalId) || filtered.has(entry.externalId)) return;
    filtered.set(entry.externalId, entry);
  };
  for (const entry of byFame.filtered) add(entry);
  for (const entry of [...refused, ...foldLosses(works, ours)]) add(entry);

  // Not `tier.homeless`, which the museum run reports: the works pool is the
  // museum's whole pool, so every iconic painting in every gallery is an iconic
  // work with no place of worship, and the number would be thousands of rows
  // this source was never going to write.
  const treasures = Object.values(current).filter((placed) => placed.length).length;
  console.log(
    `${LOG_PREFIX} Admitted ${items.length} places: `
    + `${items.filter((i) => i.door !== 'work').length} for their own fame, `
    + `${items.filter((i) => i.door !== 'place').length} for what they hold; `
    + `${filtered.size} refused, ${treasures} treasures to write`,
  );
  return {
    items,
    // Distinct: a row both pools named — a tower that is a place and a
    // treasure, a tomb that is both — is one entity fetched, not two.
    fetched: new Set([...byFame.classesOf.keys(), ...works.pool.keys()]).size,
    filtered: [...filtered.values()],
    diff: diffPlacements(deps.previousPlacements, current),
  };
}
