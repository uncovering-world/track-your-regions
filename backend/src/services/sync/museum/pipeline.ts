/**
 * Works first, museums second.
 *
 * The old import asked which Wikidata entity owns famous paintings and called the answer a
 * museum, which is how the catalogue ended up with four Louvre departments and no Louvre. This
 * pipeline collects the works the world knows, decides where each one actually hangs, and then
 * admits the venues holding them — so every row has a reason that can be named.
 *
 * Nothing here decides anything on its own: each rule lives in its own tested module, and this
 * file is the wiring. The two compositions no single module can see — the transitive ancestor
 * walk placement needs, and the fold map that has to be followed to a fixed point — live in
 * `venueGraph.ts` with the reasoning that makes them load-bearing.
 */

import { boundedClosure, type ClosureOptions } from '../classClosure.js';
import { placeArtwork } from './placement.js';
import { selectTier1, ICONIC_SITELINKS, type Tier1Result } from './tier1.js';
import { diffPlacements, type PlacementDiff } from './placementDiff.js';
import { artVerdict, isSculptural, EDITORIAL_OUT } from './artTest.js';
import type { Fold } from './venueFolds.js';
import type { Resolution } from './resolveVenue.js';
import {
  loadVenueGraph,
  makeResolver,
  foldVenues,
  applyFolds,
  type VenueGraph,
} from './venueGraph.js';
import {
  fetchMuseumClasses,
  fetchBroadPool,
  fetchClassPool,
  fetchVenueStatements,
  type PoolWork,
  type RawStatement,
} from './queries.js';
import {
  fetchSubclasses,
  chunk,
  unique,
  type QueryRunner,
  type SparqlFn,
} from '../wikidataQueries.js';
import type { FilteredEntity } from '../syncOrchestrator.js';
import type { CollectedMuseum, ProcessedContent } from '../types.js';

const LOG_PREFIX = '[Museum Sync]';

/**
 * The three classes broad enough that no single query can hold them — `painting` alone has half
 * a million instances — so each is asked in fame bands instead. Their labels double as the
 * treasure type a reader sees.
 */
const BROAD_ROOTS = [
  { qid: 'Q3305213', type: 'painting' },
  { qid: 'Q860861', type: 'sculpture' },
  { qid: 'Q179700', type: 'statue' },
];

/**
 * Four more roots, narrow enough to take whole.
 *
 * No closure reaches them from the three above — a print is not a kind of painting — so leaving
 * them out removes whole traditions rather than trimming a tail. Without them the catalogue
 * holds **zero** prints, engravings, drawings, mosaics and tapestries, and Japanese printmaking
 * is absent as a class. That is not a boundary anyone drew.
 *
 * Taken whole in one query each batch, because they are narrow enough to scan directly — no
 * bands, and no ownership requirement: losing a work on the way in is worse than deciding later
 * that it has no placeable venue.
 */
const WHOLE_ROOTS = [
  { qid: 'Q93184', type: 'drawing' },
  { qid: 'Q11060274', type: 'print' },
  { qid: 'Q133067', type: 'mosaic' },
  { qid: 'Q184296', type: 'tapestry' },
];

const ARTWORK_ROOTS = [...BROAD_ROOTS, ...WHOLE_ROOTS];

/**
 * Classes no closure can reach, because they are not kinds of work.
 *
 * A painting series and a group of casts are *collections* of works, so they sit outside the
 * subclass tree under any single work — and they are where several of the most famous things
 * in the catalogue live: Monet's Water Lilies, Van Gogh's Sunflowers, Rodin's Thinker. Without
 * the pin all three are missing, checked by name rather than by QID.
 *
 * The panel forms are here as a floor rather than a necessity: most are reachable under
 * painting, and pinning them means no future tightening of the growth rule can drop them
 * silently. Every QID below was verified against Wikidata on 2026-08-07 — label and
 * description both — rather than assumed from a name, because "engraving" names a technique
 * and an object with different entities for each.
 */
const PINNED_CLASSES: Record<string, string> = {
  Q15727816: 'painting series',
  Q28890616: 'group of casts',
  Q79218: 'triptych',
  Q1278452: 'polyptych',
  Q475476: 'diptych',
  Q15711026: 'altarpiece',
  Q11801536: 'winged altarpiece',
  Q28913685: 'woodblock print',
  Q11835431: 'engraving (the object, not the technique)',
};

/**
 * The root whose subtree means "this exists in an edition, not as one original".
 *
 * Asked of the tree rather than of a label: the closure records which root each class was
 * reached from, so etching, lithograph, screenprint and woodblock print answer yes without
 * being listed here, and a class labelled "engraving" answers according to which entity it
 * actually is.
 */
const EDITION_ROOT = 'Q11060274';

/**
 * Pinned classes that are editions, which the tree cannot say because nothing reached them.
 * A cast is to a sculpture what an impression is to a plate.
 */
const PINNED_EDITION_CLASSES = new Set(['Q28890616', 'Q28913685', 'Q11835431']);

const BROAD_TYPES = new Set([...ARTWORK_ROOTS.map((r) => r.type), 'artwork']);

const CLASS_BATCH = 25;
const STATEMENT_BATCH = 50;
/** The width of `treasures.treasure_type`. */
const TREASURE_TYPE_MAX = 50;
/** Enough of the diff to read in a log; the whole of it is returned to the caller. */
const DIFF_LINES = 20;

export interface PipelineDeps {
  sparql: SparqlFn;
  /** Where the previous run left each work, so this run can say what it moved. */
  previousPlacements: Record<string, string[]>;
  /** Injected by the test; fetched from Wikidata (the `P279*` tree under museum) otherwise. */
  museumClasses?: ReadonlySet<string>;
  closure?: ClosureOptions;
  onPhase?: (message: string) => void;
  /** Throws to abandon the run; called before every query. */
  checkCancel?: () => void;
  /** Rate limiting between queries. The test passes nothing. */
  pause?: () => Promise<void>;
}

export interface PipelineResult {
  items: CollectedMuseum[];
  fetched: number;
  filtered: FilteredEntity[];
  diff: PlacementDiff;
}

// =============================================================================
// Stages
// =============================================================================

interface ArtworkClasses {
  all: string[];
  /** Classes whose works exist in editions rather than as a single original. */
  edition: ReadonlySet<string>;
}

async function artworkClassesOf(
  run: QueryRunner,
  options?: ClosureOptions,
): Promise<ArtworkClasses> {
  run.phase('Finding the classes a work of art can be...');
  const { classes, refused, byRoot } = await boundedClosure(
    ARTWORK_ROOTS.map((r) => r.qid),
    async (qids) => {
      await run.step();
      return fetchSubclasses(run.sparql, qids);
    },
    options,
  );
  for (const r of refused) {
    console.log(
      `${LOG_PREFIX} Class closure stopped at ${r.root} hop ${r.hop}: ${r.offered} classes offered`,
    );
  }
  const all = [...new Set([...classes, ...Object.keys(PINNED_CLASSES)])];
  const edition = new Set([...(byRoot[EDITION_ROOT] ?? []), ...PINNED_EDITION_CLASSES]);
  console.log(`${LOG_PREFIX} Artwork classes: ${all.length} (${edition.size} of them editions)`);
  return { all, edition };
}

/**
 * A narrow class names a work better than the root it also instantiates, so it wins the type;
 * everything else fills a gap rather than overwriting an answer.
 */
function mergeWork(existing: PoolWork, incoming: PoolWork): void {
  if (BROAD_TYPES.has(existing.type) && !BROAD_TYPES.has(incoming.type)) {
    existing.type = incoming.type;
    // The qid travels with the label it explains, or the medium test would be
    // answered about a class the reader is not being shown.
    existing.typeQid = incoming.typeQid;
  }
  if (!existing.imageUrl) existing.imageUrl = incoming.imageUrl;
  // A list, and still a gap being filled rather than an answer overwritten: both
  // answers are the same work's `P170` statements, and a short one can only come
  // from a truncated pool, which `failIfTruncated` refuses outright.
  if (existing.creators.length === 0) existing.creators = incoming.creators;
  if (existing.year === null) existing.year = incoming.year;
  if (incoming.sitelinks > existing.sitelinks) existing.sitelinks = incoming.sitelinks;
}

async function collectPool(run: QueryRunner, classes: string[]): Promise<Map<string, PoolWork>> {
  const pool = new Map<string, PoolWork>();
  const add = (works: PoolWork[]) => {
    for (const work of works) {
      const existing = pool.get(work.qid);
      if (existing) mergeWork(existing, work);
      else pool.set(work.qid, { ...work });
    }
  };

  // Each broad root paces and reports its own bands: they are minutes apart, not seconds.
  for (const root of BROAD_ROOTS) {
    add(await fetchBroadPool(run, root));
  }

  // Everything the broad fetch did not already cover, the four whole roots included.
  const narrow = classes.filter((c) => !BROAD_ROOTS.some((r) => r.qid === c));
  const batches = chunk(narrow, CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching narrow artwork classes ${i + 1}/${batches.length}...`);
    await run.step();
    add(await fetchClassPool(run.sparql, batches[i]));
  }

  console.log(`${LOG_PREFIX} Pool: ${pool.size} works`);
  return pool;
}

async function collectStatements(
  run: QueryRunner,
  workQids: string[],
): Promise<Map<string, RawStatement[]>> {
  const byWork = new Map<string, RawStatement[]>();
  const batches = chunk(workQids, STATEMENT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Reading venue statements ${i + 1}/${batches.length}...`);
    await run.step();
    for (const statement of await fetchVenueStatements(run.sparql, batches[i])) {
      const held = byWork.get(statement.work) ?? [];
      held.push(statement);
      byWork.set(statement.work, held);
    }
  }
  return byWork;
}

function placeWorks(
  pool: Map<string, PoolWork>,
  statements: Map<string, RawStatement[]>,
  resolve: (qid: string) => string | null,
  ancestors: (qid: string) => ReadonlySet<string>,
): Record<string, string[]> {
  const placements: Record<string, string[]> = {};
  for (const qid of pool.keys()) {
    placements[qid] = placeArtwork(statements.get(qid) ?? [], resolve, ancestors);
  }
  return placements;
}

function heldBy(
  pool: Map<string, PoolWork>,
  placements: Record<string, string[]>,
): Map<string, PoolWork[]> {
  const held = new Map<string, PoolWork[]>();
  for (const work of pool.values()) {
    for (const venue of placements[work.qid] ?? []) {
      const list = held.get(venue) ?? [];
      list.push(work);
      held.set(venue, list);
    }
  }
  for (const list of held.values()) list.sort((a, b) => b.sitelinks - a.sitelinks);
  return held;
}

/**
 * Venues worth putting the art test to: those holding at least one work above the iconic
 * threshold, which is to say every venue that could otherwise reach `selectTier1`. A venue whose
 * placements are all sub-iconic was never going to be admitted regardless of what the test says,
 * and running it anyway would put noise on the curation screen for nothing the catalogue loses.
 */
function candidateVenues(
  pool: Map<string, PoolWork>,
  placements: Record<string, string[]>,
): Set<string> {
  const venues = new Set<string>();
  for (const work of pool.values()) {
    if (work.sitelinks < ICONIC_SITELINKS) continue;
    for (const venue of placements[work.qid] ?? []) venues.add(venue);
  }
  return venues;
}

/**
 * Rules 1, 2 and 4 of the art test (`artTest.ts`): whether a venue that resolution and folding
 * already settled on is an *art* museum, and the four named entities kept out regardless of what
 * their classes say. Rule 3, the site-class veto, already ran inside venue resolution — a site
 * with no art class fails `venueVerdict` itself, so it never reaches this stage at all.
 *
 * Decided after folds, not before: a fold can hand a surviving venue works it never itself had a
 * statement for, and the painting share has to be measured on what a venue actually ends up
 * holding, not on what it was named for before its duplicates merged into it.
 */
function applyArtTest(
  pool: Map<string, PoolWork>,
  placements: Record<string, string[]>,
  graph: VenueGraph,
): { placements: Record<string, string[]>; rejected: FilteredEntity[] } {
  const held = heldBy(pool, placements);
  const candidates = candidateVenues(pool, placements);
  const admitted = new Set<string>();
  const rejected: FilteredEntity[] = [];

  for (const venue of candidates) {
    const name = graph.details.get(venue)?.label ?? venue;
    const editorial = EDITORIAL_OUT[venue];
    if (editorial) {
      rejected.push({ externalId: venue, name, reason: `editorial exclusion: ${editorial}` });
      continue;
    }
    const classes = graph.facts(venue)?.classes ?? [];
    const works = (held.get(venue) ?? []).map((w) => ({ sculptural: isSculptural(w.type) }));
    const verdict = artVerdict(classes, works);
    if (verdict.art) {
      admitted.add(venue);
    } else {
      rejected.push({ externalId: venue, name, reason: `not an art museum — ${verdict.why}` });
    }
  }

  const kept: Record<string, string[]> = {};
  for (const [work, venues] of Object.entries(placements)) {
    kept[work] = venues.filter((venue) => !candidates.has(venue) || admitted.has(venue));
  }
  return { placements: kept, rejected };
}

// =============================================================================
// What the run hands back
// =============================================================================

function toContent(work: PoolWork): ProcessedContent {
  return {
    externalId: work.qid,
    name: work.label,
    // `treasures.treasure_type` is varchar(50) and the type is now a Wikidata class label rather
    // than one of two literals: "Anthropomorphic wooden cult figurines of Central and Northern
    // Europe" (Q574422) is 68 characters. An over-long value would make the insert throw, which
    // the orchestrator would record as the whole museum failing, losing its remaining treasures
    // with it. A clipped display string is the cheaper failure.
    treasureType: work.type.slice(0, TREASURE_TYPE_MAX),
    artists: work.creators,
    year: work.year,
    imageUrl: work.imageUrl,
    sitelinksCount: work.sitelinks,
  };
}

function buildItems(
  tier: Tier1Result,
  pool: Map<string, PoolWork>,
  placements: Record<string, string[]>,
  graph: VenueGraph,
): CollectedMuseum[] {
  const held = heldBy(pool, placements);
  const items: CollectedMuseum[] = [];

  for (const [venue, iconic] of tier.museums) {
    const row = graph.details.get(venue);
    if (!row || row.lat === null || row.lon === null) continue;
    const works = held.get(venue) ?? [];
    const admittedBy = iconic
      .map((qid) => pool.get(qid))
      .filter((work): work is PoolWork => !!work)
      .sort((a, b) => b.sitelinks - a.sitelinks)[0];

    items.push({
      qid: venue,
      label: row.label,
      admittedFor: admittedBy ? { qid: admittedBy.qid, label: admittedBy.label } : undefined,
      artworks: works.map(toContent),
      details: {
        museumQid: venue,
        museumLabel: row.label,
        description: row.description,
        lat: row.lat,
        lon: row.lon,
        countryLabel: row.countryLabel,
        imageUrl: row.imageUrl,
        website: row.website,
        articleUrl: row.articleUrl,
      },
    });
  }
  return items.sort((a, b) => b.artworks.length - a.artworks.length);
}

/**
 * Why a candidate the works pointed at is not in the catalogue.
 *
 * Restricted to candidates an *iconic* work named, plus every fold of a venue that received a
 * work: a rejection that cost the catalogue nothing is noise on the curation screen, and the
 * pool names some 1500 entities. A door's own fold — written when the door walk goes on from a
 * door to the door's door — is not reported: the door held no work and was never proposed, so
 * a line about it would count a loss the catalogue did not have.
 */
function nameFiltered(
  pool: Map<string, PoolWork>,
  statements: Map<string, RawStatement[]>,
  resolution: (qid: string) => Resolution,
  graph: VenueGraph,
  folds: Record<string, Fold>,
  venues: ReadonlySet<string>,
): FilteredEntity[] {
  const nameOf = (qid: string) => graph.details.get(qid)?.label ?? qid;
  const filtered = new Map<string, FilteredEntity>();

  for (const work of pool.values()) {
    if (work.sitelinks < ICONIC_SITELINKS) continue;
    for (const statement of statements.get(work.qid) ?? []) {
      const found = resolution(statement.venue);
      if ('venue' in found || filtered.has(statement.venue)) continue;
      filtered.set(statement.venue, {
        externalId: statement.venue,
        name: nameOf(statement.venue),
        reason: `${found.unresolved} — named by ${work.label} (${work.sitelinks} sitelinks)`,
      });
    }
  }

  for (const [qid, fold] of Object.entries(folds)) {
    if (!venues.has(qid)) continue;
    filtered.set(qid, {
      externalId: qid,
      name: nameOf(qid),
      reason: `folded into ${nameOf(fold.into)} — ${fold.why}, ${fold.metres} m away`,
    });
  }
  return [...filtered.values()];
}

function logDiff(diff: PlacementDiff, nameOf: (qid: string) => string): void {
  console.log(
    `${LOG_PREFIX} Placement diff: ${diff.moved.length} moved, ${diff.gained.length} gained, `
    + `${diff.lost.length} lost, ${diff.dropped.length} dropped`,
  );
  for (const move of diff.moved.slice(0, DIFF_LINES)) {
    console.log(
      `${LOG_PREFIX}   moved ${nameOf(move.work)}: `
      + `${move.from.map(nameOf).join(', ')} -> ${move.to.map(nameOf).join(', ')}`,
    );
  }
  for (const work of diff.lost.slice(0, DIFF_LINES)) {
    console.log(`${LOG_PREFIX}   lost ${nameOf(work)}: still in the pool, placed nowhere`);
  }
}

function makeRun(deps: PipelineDeps): QueryRunner {
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
// The pipeline
// =============================================================================

export async function collectTier1Museums(deps: PipelineDeps): Promise<PipelineResult> {
  const run = makeRun(deps);

  let museumClasses = deps.museumClasses;
  if (!museumClasses) {
    run.phase('Fetching the classes a museum can be...');
    await run.step();
    museumClasses = await fetchMuseumClasses(run.sparql);
  }

  const classes = await artworkClassesOf(run, deps.closure);
  const pool = await collectPool(run, classes.all);
  const statements = await collectStatements(run, [...pool.keys()]);

  const seeds = unique([...statements.values()].flat().map((s) => s.venue));
  const graph = await loadVenueGraph(run, seeds, museumClasses);
  const { resolve, resolution } = makeResolver(graph, museumClasses);

  run.phase('Placing works in the venues that hold them...');
  const placed = placeWorks(pool, statements, resolve, graph.ancestors);
  const folds = foldVenues(placed, graph, museumClasses);
  const afterFolds = applyFolds(placed, folds);

  run.phase('Asking whether each venue is an art museum...');
  const { placements: afterArtTest, rejected: notArt } = applyArtTest(pool, afterFolds, graph);

  const tier = selectTier1([...pool.values()].map((work) => ({
    qid: work.qid,
    sitelinks: work.sitelinks,
    venues: afterArtTest[work.qid] ?? [],
    multipleMedium: work.typeQid !== null && classes.edition.has(work.typeQid),
  })));

  // What the run will actually write: a work is only stored as a treasure of a museum this run
  // admits, so the diff has to be measured against the same thing the database will hold.
  const admitted = new Set(tier.museums.keys());
  const current: Record<string, string[]> = {};
  for (const qid of pool.keys()) {
    current[qid] = (afterArtTest[qid] ?? []).filter((venue) => admitted.has(venue));
  }

  const items = buildItems(tier, pool, current, graph);
  const venues = new Set(Object.values(placed).flat());
  const filtered = [...nameFiltered(pool, statements, resolution, graph, folds, venues), ...notArt];
  const diff = diffPlacements(deps.previousPlacements, current);

  console.log(
    `${LOG_PREFIX} Admitted ${items.length} museums; ${Object.keys(folds).length} folds, `
    + `${tier.homeless.length} iconic works with no venue, ${tier.shared.length} held too widely`,
  );
  logDiff(diff, (qid) => pool.get(qid)?.label ?? graph.details.get(qid)?.label ?? qid);

  return { items, fetched: pool.size, filtered, diff };
}
