/**
 * Works first, museums second.
 *
 * The old import asked which Wikidata entity owns famous paintings and called the answer a
 * museum, which is how the catalogue ended up with four Louvre departments and no Louvre. This
 * pipeline collects the works the world knows, decides where each one actually hangs, and then
 * admits the venues holding them — so every row has a reason that can be named.
 *
 * The stages every works-first kind shares — the class closure, the banded pool, the venue
 * statements, the venue graph, placement and folds — live in `worksCollector.ts`, parameterised
 * by roots, pinned classes and a `VenueRule`. What stays here is the museum's own tail: the art
 * test that tells a museum from a church Wikidata also calls one, the tier that decides which
 * admitted venue is worth a visit, and the wiring that composes the two halves.
 */

import { selectTier1, ICONIC_SITELINKS, type Tier1Result } from './tier1.js';
import { diffPlacements, type PlacementDiff } from './placementDiff.js';
import { artVerdict, isSculptural, EDITORIAL_OUT } from './artTest.js';
import { museumRule, type VenueRule } from './venueTest.js';
import type { Fold } from './venueFolds.js';
import type { Resolution } from './resolveVenue.js';
import { applyFolds, foldVenues, type VenueGraph } from './venueGraph.js';
import {
  collectWorks,
  heldBy,
  toContent,
  MUSEUM_BROAD_ROOTS,
  MUSEUM_WHOLE_ROOTS,
  MUSEUM_PINNED_CLASSES,
  MUSEUM_PINNED_EDITION_CLASSES,
  EDITION_ROOT,
  type UnseenWork,
} from './worksCollector.js';
import { fetchMuseumClasses, type PoolWork, type RawStatement } from './queries.js';
import type { ClosureOptions } from '../classClosure.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import type { FilteredEntity } from '../syncOrchestrator.js';
import type { CollectedMuseum } from '../types.js';

const LOG_PREFIX = '[Museum Sync]';

/** The noun this kind's phase lines use for what it collects. */
const MUSEUM_NOUN = { work: 'work of art', works: 'artworks' };

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

/** Enough of the diff to read in a log; the whole of it is returned to the caller. */
const DIFF_LINES = 20;

// =============================================================================
// The museum's own tail
// =============================================================================

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
      // An unknown value named no venue to resolve.
      if (statement.venue === null) continue;
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

/**
 * Why a museum that held only works nobody can see is not in the catalogue (#868).
 *
 * The Isabella Stewart Gardner Museum was in the world tier for *The Storm on the Sea of
 * Galilee* and *The Concert*, both stolen in 1990. Placed nowhere, they admit nothing, and the
 * sweep would refuse the museum as "this run selected nothing that belongs to it" — true, and
 * useless to the curator reading it. So the tier is asked again over the unseen works alone,
 * where their statements would have put them, and a venue that only they would have admitted is
 * refused with their names and the reason each cannot be seen. A venue the run admits anyway is
 * not reported: it lost a work, not its place.
 *
 * The counterfactual is the whole placement as if the unseen works could be seen — the real
 * placements with the would-be ones laid over them, folded and put to the art test as the real
 * run's are. Whole, because the art test's painting share is measured on what a venue holds
 * (`applyArtTest`): a venue with no art class holding six sub-iconic statues and one unseen
 * iconic painting is not an art museum, and judged on the painting alone it would be. A quarter
 * the editors excluded, or a natural-history museum, was never going to be admitted and is not
 * told its works cannot be seen. The folds are computed over that same counterfactual, not
 * taken from the run: `foldVenues` folds only venues that received a work, and a venue only
 * unseen works name received none — as if seen, a collection housed in a better-known palace
 * folds into the palace, and if the palace is admitted the collection lost a work, not its
 * place. Only the tier is then asked over the unseen works alone.
 */
function unseenLosses(
  pool: Map<string, PoolWork>,
  unseen: Record<string, UnseenWork>,
  placed: Record<string, string[]>,
  rule: VenueRule,
  editionClasses: ReadonlySet<string>,
  admitted: ReadonlySet<string>,
  graph: VenueGraph,
): FilteredEntity[] {
  const asIfSeen: Record<string, string[]> = { ...placed };
  for (const [qid, work] of Object.entries(unseen)) asIfSeen[qid] = work.wouldBe;
  const folds = foldVenues(asIfSeen, graph, rule);
  const { placements: afterArtTest } = applyArtTest(pool, applyFolds(asIfSeen, folds), graph);
  const tier = selectTier1(Object.keys(unseen).map((qid) => {
    const work = pool.get(qid);
    return {
      qid,
      sitelinks: work?.sitelinks ?? 0,
      venues: afterArtTest[qid] ?? [],
      multipleMedium: work?.typeQid != null && editionClasses.has(work.typeQid),
    };
  }));

  const losses: FilteredEntity[] = [];
  for (const [venue, works] of tier.museums) {
    if (admitted.has(venue)) continue;
    const named = works
      .map((qid) => pool.get(qid))
      .filter((work): work is PoolWork => !!work)
      .sort((a, b) => b.sitelinks - a.sitelinks)
      .map((work) => `${work.label} (${unseen[work.qid].reason})`);
    losses.push({
      externalId: venue,
      name: graph.details.get(venue)?.label ?? venue,
      reason: `its famous works cannot be seen — ${named.join(', ')}`,
    });
  }
  return losses;
}

function logUnseen(unseen: Record<string, UnseenWork>, nameOf: (qid: string) => string): void {
  const entries = Object.entries(unseen);
  for (const [qid, work] of entries.slice(0, DIFF_LINES)) {
    console.log(
      `${LOG_PREFIX}   unseen ${nameOf(qid)}: ${work.reason}`
      + (work.wouldBe.length ? `, statements name ${work.wouldBe.map(nameOf).join(', ')}` : ''),
    );
  }
  if (entries.length > DIFF_LINES) console.log(`${LOG_PREFIX}   … and ${entries.length - DIFF_LINES} more`);
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

  const rule = museumRule(museumClasses);
  const { pool, statements, graph, editionClasses, resolver, placed, unseen, folds, afterFolds } =
    await collectWorks(run, {
      broadRoots: MUSEUM_BROAD_ROOTS,
      wholeRoots: MUSEUM_WHOLE_ROOTS,
      pinned: MUSEUM_PINNED_CLASSES,
      pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES,
      editionRoot: EDITION_ROOT,
      noun: MUSEUM_NOUN,
      rule,
      closure: deps.closure,
      logPrefix: LOG_PREFIX,
    });

  run.phase('Asking whether each venue is an art museum...');
  const { placements: afterArtTest, rejected: notArt } = applyArtTest(pool, afterFolds, graph);

  const tier = selectTier1([...pool.values()].map((work) => ({
    qid: work.qid,
    sitelinks: work.sitelinks,
    venues: afterArtTest[work.qid] ?? [],
    multipleMedium: work.typeQid !== null && editionClasses.has(work.typeQid),
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
  // A venue named once: the unseen losses come last, so a venue the resolver or the art test
  // already refused keeps that reason rather than being told its works cannot be seen.
  const filtered = new Map<string, FilteredEntity>();
  for (const entry of [
    ...nameFiltered(pool, statements, resolver.resolution, graph, folds, venues),
    ...notArt,
    ...unseenLosses(pool, unseen, placed, rule, editionClasses, admitted, graph),
  ]) {
    if (!filtered.has(entry.externalId)) filtered.set(entry.externalId, entry);
  }
  const diff = diffPlacements(deps.previousPlacements, current);

  const nameOf = (qid: string) => pool.get(qid)?.label ?? graph.details.get(qid)?.label ?? qid;
  console.log(
    `${LOG_PREFIX} Admitted ${items.length} museums; ${Object.keys(folds).length} folds, `
    + `${tier.homeless.length} iconic works with no venue, ${tier.shared.length} held too widely, `
    + `${Object.keys(unseen).length} works nobody can see`,
  );
  logUnseen(unseen, nameOf);
  logDiff(diff, nameOf);

  return { items, fetched: pool.size, filtered: [...filtered.values()], diff };
}
