/**
 * An archaeology museum is in the catalogue for what it is, and the finds it
 * holds are what it shows — never what admits it (ADR-0058 decision 2).
 *
 * That is one door where the places of worship have two, and it is the whole
 * difference between this file and `worship/pipeline.ts`, whose shape it
 * otherwise follows: the pool is the museums Wikidata types archaeological
 * rather than the places the world knows by name, the finds are collected with
 * the museum import's own stages (`museum/worksCollector.ts`) under this kind's
 * rule (`finds.ts`), and one verdict decides where worship unions two.
 *
 * **Who is judged at all.** A museum reaches the verdict three ways: the class
 * question named it, English Wikipedia files its article under the
 * archaeological-museum categories, or it holds a find above the finds' own
 * line. Nothing else, so the long tail of everything that owns an ancient statue
 * produces no named refusals. The first two are the two signals of one nature
 * and both are doors, because the class misses half the canon and a museum it
 * misses reaches no pool at all — the Bardo is `museum` at 35 sitelinks. A find
 * carries a museum that already passed the nature door below the place line
 * (Delphi at 15 sitelinks for the Charioteer); it never carries one that failed
 * that door, which is the decision's whole point.
 *
 * **The folds are the museum import's**, narrowed twice by this kind. A museum
 * folds only onto a survivor this kind admits — by class, by category, or as a
 * department held for a curator — so an archaeological collection is never taken
 * out of the catalogue by a fold onto a museum the rule refuses.
 * `worship/pipeline.ts` found that shape first, with the Cappella Paolina. And
 * then, once the verdict is in, **only onto a survivor this run actually
 * writes** (`keepFoldsOntoJudged` in `museumHoldings.ts`): the nature test is
 * all that can be asked before the rule runs, because this kind's admission
 * depends on the placements the fold produces, and it lets through a survivor
 * that is archaeological and still never written — whose finds would then be
 * stored for nobody while the museum they came from arrived with an empty
 * case.
 *
 * **And a museum that folded is not a row of its own** (`foldedAway`): it leaves
 * the items whatever its own fame would have said, and is reported once by where
 * it went. The survivor is the name for both, and a second pin holding nothing
 * beside it is a museum whose card is empty because its case is next door.
 *
 * This file is the wiring and the union: nothing here decides what an
 * archaeology museum is (`museumTest.ts`), what a find is (`finds.ts`), which
 * classes count (`classes.ts`), what is known about a candidate (`museums.ts`),
 * where a find is placed (`museum/placement.ts`), or which folds survive the
 * verdict and what the admitted museums hold from their own side
 * (`museumHoldings.ts`).
 *
 * **The verdict itself is `museumVerdict.ts`** (#581's final pass), which is
 * where this file was first split: the rule over one candidate, the row a
 * museum becomes, and the same asked of a whole pass. **The loop over that
 * verdict is `museumHoldings.ts`** (#890, the second split at the same seam):
 * the verdict and the fold decision asked of each other to a fixed point, and
 * the venue-side read asked of what the verdict admits until nothing is new.
 * What is left here is the collection and the union — what is fetched, in
 * what order, and how the two doors' answers are joined — and the seam holds
 * because nothing in the verdict reads Wikidata.
 *
 * **And the kind's other door is here too** (ADR-0058 decision 1): the sites,
 * collected by `sites.ts` over their own pool with OpenStreetMap as the second
 * signal, and returned in the same list of items. One collector and one
 * proposal, not two runs, because the orchestrator reads absence from that list
 * as a withdrawal — two runs would have each door retire the other's rows on
 * every pass. What a site row looks like, and what the run says at the end, are
 * `proposal.ts`.
 */

import { diffPlacements, type PlacementDiff } from '../museum/placementDiff.js';
import { museumRule } from '../museum/venueTest.js';
import { applyFolds, survivorOf } from '../museum/venueGraph.js';
import type { Fold } from '../museum/venueFolds.js';
import { fetchMuseumClasses } from '../museum/queries.js';
import {
  collectWorks,
  type WorksCollection,
  type WorksCollectorOptions,
} from '../museum/worksCollector.js';
import { holdingReason, keptElsewhere, refusedHoldingReason } from '../museum/venueSide.js';
// The verdict and the fold decision to a fixed point, and the venue-side read
// asked of what it admits until nothing is new: the museum door's second half
// (`museumHoldings.ts`, split out at the seam the review of #890 named).
import { judgeToAFixedPoint, readAdmittedHoldings } from './museumHoldings.js';
import { chunk, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { isQid } from '../wikidataUtils.js';
import { collectMuseumPool, fetchArchaeologyTrees, fetchFindFacts } from './queries.js';
import { findsCollectorOptions, type FindFacts } from './finds.js';
import {
  candidatesOf,
  factsOf,
  readCategories,
  readClasses,
  readMembers,
  rowsOf,
} from './museums.js';
import { museumNature } from './museumTest.js';
// The verdict over one candidate and over a whole pass, with the row a museum
// becomes: everything that is decided once the fetching is done
// (`museumVerdict.ts`, split out at this file's own seam).
import {
  isThisKind,
  type CollectedArchaeologyMuseum,
  type MuseumJudging,
} from './museumVerdict.js';
export type { CollectedArchaeologyMuseum } from './museumVerdict.js';
import { collectSitesByFame, type OsmReader } from './sites.js';
import { reportProposal, uniteDoors, type CollectedArchaeologySite } from './proposal.js';
import { contentsLine, type SourceLine } from '../sourceLine.js';
import type { ClosureOptions } from '../classClosure.js';
import type { FilteredEntity } from '../syncOrchestrator.js';

const LOG_PREFIX = '[Archaeology Sync]';
const FACT_BATCH = 50;

/** What this run proposes: the kind's two types, in one list (ADR-0058 decision 1). */
export type CollectedArchaeologyItem = CollectedArchaeologyMuseum | CollectedArchaeologySite;

export interface CollectedArchaeology {
  items: CollectedArchaeologyItem[];
  /**
   * Distinct entities this run named, which is what the panel shows as
   * *fetched*. Exactly three sets, deduplicated because a row two doors named is
   * one entity and not two:
   *
   *   - every museum the class pools answered with, before any verdict;
   *   - every category member the by-id question *answered for* — including one
   *     then dropped for want of an English article, since it was fetched all
   *     the same;
   *   - the finds pool **after this kind's own keep rule** (`finds.ts`): a
   *     diamond or a tyrannosaur the class pool returned is not counted, having
   *     been refused as not a find before the museums were ever judged.
   *
   * That last set is a pool after a cut and is counted that way on purpose: it
   * is what `worship/pipeline.ts` counts (`byFame.classesOf` plus `works.pool`),
   * and a kind that counted its contents differently would make the number on
   * one source's card mean something else on the next (#887).
   */
  fetched: number;
  filtered: FilteredEntity[];
  /**
   * The objects the admitted museums hold that the find rule refused — an
   * exhibition, a painting, a diamond — each with its classes (#890).
   * Reported, never marked (`FetchResult`).
   */
  refusedContents: FilteredEntity[];
  diff: PlacementDiff;
}

export interface ArchaeologyPipelineDeps {
  sparql: SparqlFn;
  /** Where the previous run left each find, so this run can say what it moved. */
  previousPlacements: Record<string, string[]>;
  /**
   * What the source holds as admitted before the run, so the stay line has
   * something to hold — split by door, because one source fills both. Each
   * door asks after its own rows and judges its own rows: the museum door
   * asked after the sites would refuse Athens as "no museum class" ahead of the
   * site door's own reason, and the site door asked after the museums would
   * write a museum the museum door stopped admitting as a site.
   */
  admittedMuseums: ReadonlySet<string>;
  admittedSites: ReadonlySet<string>;
  /** The two lines the source row states: one for places, one for finds (`sourceLine.ts`). */
  line: SourceLine;
  /**
   * English Wikipedia's categories for a batch of article titles. A function
   * rather than the client itself, so this pipeline neither knows how Wikipedia
   * is asked nor needs it to be asked at all in a test.
   */
  categories: (titles: string[]) => Promise<Map<string, string[]>>;
  /**
   * The museums English Wikipedia's archaeological-museum categories name, as
   * article title → Wikidata id. A function for the same reason `categories`
   * is one: which categories are walked and how is the caller's, and a test
   * asks no wiki anything.
   */
  categoryMembers: () => Promise<Map<string, string>>;
  /**
   * What OpenStreetMap maps at each site candidate. A function for the reason
   * `categories` is one: this pipeline neither knows how OSM is asked nor needs
   * it to be asked at all in a test.
   */
  osm: OsmReader;
  onPhase?: (message: string) => void;
  /** Throws to abandon the run; called before every query. */
  checkCancel?: () => void;
  /** Rate limiting between queries. The test passes nothing. */
  pause?: () => Promise<void>;
  closure?: ClosureOptions;
}

function makeRun(deps: ArchaeologyPipelineDeps): QueryRunner {
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
// The finds
// =============================================================================

/**
 * The collector's `workFacts` hook, keeping what it read: it batches here
 * because it is the run that paces itself and reports its phases, and it keeps
 * the answer because the find rule reads the classes on the way in and the
 * treasure carries the discovery place on the way out.
 */
function findFactsReader(): {
  workFacts: NonNullable<WorksCollectorOptions['workFacts']>;
  facts: Map<string, FindFacts>;
} {
  const facts = new Map<string, FindFacts>();
  const workFacts = async (run: QueryRunner, qids: string[]): Promise<Map<string, FindFacts>> => {
    // Only Wikidata-answered ids reach here; the filter spells that out.
    const batches = chunk(qids.filter(isQid), FACT_BATCH);
    for (let i = 0; i < batches.length; i++) {
      run.phase(
        `Reading what each find is, and where it was found (batch ${i + 1}/${batches.length})...`,
      );
      await run.step();
      for (const [qid, row] of await fetchFindFacts(run.sparql, batches[i])) facts.set(qid, row);
    }
    return facts;
  };
  return { workFacts, facts };
}

/**
 * The collector options the finds are collected with, and the venue-side read
 * is judged by (#890): the museum import's stages under this kind's rule. The
 * site veto is on, where the places of worship switch it off: a park or a
 * church is not a venue for this kind — an open-air excavation is a site
 * (ADR-0058 decision 4), admitted through its own door.
 */
function findsOptions(
  deps: ArchaeologyPipelineDeps,
  options: Omit<Parameters<typeof findsCollectorOptions>[0], 'logPrefix'>,
): WorksCollectorOptions {
  return {
    ...findsCollectorOptions({ ...options, logPrefix: LOG_PREFIX }),
    closure: deps.closure,
  };
}

// =============================================================================
// The folds
// =============================================================================

/**
 * The same collection with only the folds that land on a museum this kind
 * admits, and the placements moved again over what is left.
 *
 * Worship's `foldsOntoAdmitted` with this kind's test. A fold picks its survivor
 * by distance and container — the museum import's rules, which know nothing
 * about archaeology — so without this question a collection inside a museum is
 * taken out of the catalogue by a fold onto a row the kind refuses, as worship
 * lost the Cappella Paolina into the Apostolic Palace.
 *
 * The test is the survivor's nature, followed to the end of its chain, and it is
 * the *whole* of what this kind admits — the category as well as the class, a
 * department as well as a nature. The Pio-Clementino museum (10 sitelinks, no
 * English article) is housed in the Vatican Museums 86 m away and they are one
 * ticket: the Vatican's article carries `Museums of ancient Greece`, so the fold
 * stands and the Laocoön is shown under the name a traveller looks for. A
 * survivor with no archaeological signal at all is what the filter exists for,
 * and then the collection stands on its own.
 */
function foldsOntoAdmitted(
  works: WorksCollection,
  admits: (qid: string) => boolean,
): WorksCollection {
  const folds: Record<string, Fold> = {};
  for (const [qid, fold] of Object.entries(works.folds)) {
    if (admits(survivorOf(works.folds, qid))) folds[qid] = fold;
  }
  return { ...works, folds, afterFolds: applyFolds(works.placed, folds) };
}

/**
 * The museums a kept fold took out of this run, each with the line it is
 * reported by — worship's `foldLosses`, which found the shape.
 *
 * **A museum that folded is not also a row of its own.** That is what a fold
 * means: the survivor is *the* name for both, one ticket and one visit, so a
 * second pin holding nothing beside it would offer a traveller a museum whose
 * card is empty because its case is next door. The art import says the same by
 * construction — a folded venue is never in `tier.museums`, only its survivor
 * is — and this kind used to say it only by accident, because a folded museum
 * was usually below the place line and came out `out`. One above the line (the
 * Pio-Clementino raised to 30 in the fixture; an Egyptian collection housed in a
 * better-known museum, on the ground) stood as its own empty row.
 *
 * Every kept fold, not only the ones a find above the line carried. The old
 * narrowing was about a *loss* — a museum whose finds were all below the line
 * was never going to be admitted for them, so counting it as lost overstated
 * what the catalogue had. This line is not a loss but an address: it says where
 * this name went, and that is true of every museum that folded.
 *
 * Read off the folds as they stand after the verdict (`keepFoldsOntoJudged`), so
 * one set answers "did this museum fold" for the items and the refusals alike.
 */
function foldedAway(works: WorksCollection): Map<string, FilteredEntity> {
  const nameOf = (qid: string) => works.graph.details.get(qid)?.label ?? qid;
  return new Map(Object.entries(works.folds).map(([qid, fold]) => [qid, {
    externalId: qid,
    name: nameOf(qid),
    reason: `folded into ${nameOf(fold.into)} — ${fold.why}, ${fold.metres} m away`,
  }]));
}

// =============================================================================
// The pipeline
// =============================================================================

export async function collectArchaeology(
  deps: ArchaeologyPipelineDeps,
): Promise<CollectedArchaeology> {
  const run = makeRun(deps);
  const trees = await fetchArchaeologyTrees(run);
  const pool = await collectMuseumPool(run, trees, deps.admittedMuseums);

  // Asked here, beside the pool it stands next to, though the ids it answers
  // with cannot be looked up until the venue graph exists: the two doors of one
  // nature are read one after the other, and an answer this run never uses
  // would be a question it never asked.
  run.phase('Reading English Wikipedia\'s archaeological-museum categories...');
  await run.step();
  const named = await deps.categoryMembers();

  run.phase('Fetching the classes a museum can be...');
  await run.step();
  const museumClasses = await fetchMuseumClasses(run.sparql);

  const reader = findFactsReader();
  const options = findsOptions(deps, {
    trees, rule: museumRule(museumClasses), workFacts: reader.workFacts,
  });
  const collected = await collectWorks(run, options);

  const findLine = contentsLine(deps.line);
  const members = await readMembers(run, named.values(), pool, collected.graph);
  const candidates = candidatesOf(pool, collected, members.judged);
  const rows = rowsOf(candidates, pool, collected.graph);
  const classes = await readClasses(run, [...rows.keys()], collected.graph);
  const categories = await readCategories(run, deps.categories, rows);
  const natureOf = (qid: string) => museumNature(factsOf(qid, rows, classes, categories), trees);

  /**
   * What every pass of the verdict reads: the rows, the classes, the
   * categories and the finds this run has already fetched. Handed to
   * `judgeAllMuseums` with the placements of the pass being judged — twice,
   * where a fold is dropped — and nothing in it is read from Wikidata again.
   */
  const judging: MuseumJudging = {
    trees,
    facts: (qid) => factsOf(qid, rows, classes, categories),
    rows,
    named: [...pool.keys(), ...members.judged],
    namedByCategory: (qid) => members.judged.has(qid),
    museumClasses,
    findFacts: reader.facts,
    admitted: deps.admittedMuseums,
    line: deps.line,
    findLine,
  };

  // A fold may only hand a museum's finds to a museum this kind admits — asked
  // here as the survivor's nature, which is all that can be known before the
  // rule has run. Then the verdict, asked against the museums the run really
  // writes until neither it nor the fold decision moves (`judgeToAFixedPoint`):
  // a survivor can be archaeological by class or category and still be a row
  // no verdict ever admits, and the finds handed to it would be written
  // nowhere.
  const settled = judgeToAFixedPoint(
    foldsOntoAdmitted(collected, (qid) => isThisKind(natureOf(qid))), judging,
  );

  // What the admitted museums hold that no class question asked for (#890):
  // read of the survivors the verdict admits and of every museum folded into
  // one, judged by this kind's own find rule with the facts it reads — the
  // Pergamon Altar by its discovery place, the Ishtar Gate by its date — and
  // merged as if the pool had collected it. The verdict is then asked once more
  // over the merged placements, since what a museum holds is what it is badged
  // and, below the place line, admitted for. An object read here can name a
  // museum no pool find named, which the verdict has to have a row for: those
  // are added from the extended graph, their classes off it and their
  // categories asked of Wikipedia once more, for the few there are.
  //
  // **Until every museum the verdict admits has been read.** An object read
  // at one museum can carry another over the line — its statements name a
  // second holder, which the second verdict admits for it — and that museum's
  // own holdings are then unread. So the read is asked again of whatever the
  // last verdict admitted that no round has read, and stops when nothing is
  // new. It terminates: the set of museums read only grows, and every one of
  // them is a candidate of a finite pass.
  const { works, verdict, side } = await readAdmittedHoldings(run, settled, options, judging, {
    pool,
    members: members.judged,
    rows,
    classes,
    categories,
    categoriesDoor: deps.categories,
    // Named where a find would keep its badge: below the finds' stay line
    // the Louvre's paintings refused as not finds would bury the real misses.
    reportFloor: findLine.staySitelinks,
  });

  // A museum that folded into a survivor this run writes is that survivor's, and
  // is not a second row beside it: it leaves the items whatever its own fame
  // would have said, and is reported once by the address below.
  const folded = foldedAway(works);
  const items = verdict.items.filter((item) => !folded.has(item.qid));
  const refused = verdict.refused;

  // The kind's other door, run after the museums and over its own pool
  // (ADR-0058 decision 1). One collector and one proposal, because the
  // orchestrator's sweep reads absence from `items` as a withdrawal: two runs
  // would have each door retire the other's rows on every pass.
  const sites = await collectSitesByFame(run, trees, deps.admittedSites, deps.line, deps.osm);

  // What the run will actually write: a find is stored as a treasure of a museum
  // this run admits, so the diff is measured against what the database will hold.
  const admitted = new Set(items.map((item) => item.qid));
  const current: Record<string, string[]> = {};
  for (const qid of works.pool.keys()) {
    current[qid] = (works.afterFolds[qid] ?? []).filter((venue) => admitted.has(venue));
  }

  // The two doors into one proposal: one row per entity, and one refusal list
  // without a row this run writes in it (`proposal.ts` states both rules).
  // Nothing guards against a *written museum* turning up among the museum
  // refusals, because nothing can: `judgeOne` answers with an item or a refusal
  // and never both, and a museum that folded has already left the items above.
  const union = uniteDoors({
    museums: items,
    sites: sites.sites,
    museumRefusals: [...folded.values(), ...refused],
    siteRefusals: sites.filtered,
  });

  const nameOf = (qid: string) => rows.get(qid)?.label ?? works.graph.details.get(qid)?.label ?? qid;
  reportProposal({
    museums: items.length,
    held: items.filter((item) => item.admissionNote).map((item) => item.label),
    forFind: items.flatMap((item) => (
      item.admittedFor ? [`${item.label} (${item.admittedFor.label})`] : []
    )),
    sites: union.siteItems,
    refused: union.filtered.length,
    treasures: Object.values(current).filter((placed) => placed.length).length,
    siteRefusals: union.siteRefusals,
    venueSide: {
      kept: [...side.kept.values()].map((find) => find.label),
      refused: side.refused.length,
    },
  });
  return {
    items: union.items,
    // Distinct: a row two doors named is one entity fetched, not two. The
    // members are counted from what the by-id question *answered*, not from
    // what the pool kept — a row dropped for want of an English article was
    // fetched all the same, and a run reports what it asked the source for.
    // What the admitted museums hold besides is fetched too, kept or refused.
    fetched: new Set([
      ...pool.keys(), ...works.pool.keys(), ...members.fetched, ...sites.fetched,
      ...side.refused.map((refusal) => refusal.qid),
    ]).size,
    filtered: union.filtered,
    // What the find rule refused, and what it kept that the run still writes
    // nowhere — a find whose statements resolve to no admitted museum, or one
    // nobody can see — each with its reason; never a row this run writes, the
    // rule `uniteDoors` keeps for the places.
    refusedContents: [
      ...side.reported.map((refusal) => ({
        externalId: refusal.qid,
        name: refusal.label,
        reason: refusedHoldingReason(refusal, { work: 'find' }, nameOf),
      })),
      ...keptElsewhere(side, current).map((refusal) => ({
        externalId: refusal.qid,
        name: refusal.label,
        reason: holdingReason(refusal, works.unseen[refusal.qid]
          ? `nobody can see it: ${works.unseen[refusal.qid].reason}`
          : 'its own statements place it at no admitted museum', nameOf),
      })),
    ].filter((entry) => !union.items.some((item) => item.qid === entry.externalId)),
    diff: diffPlacements(deps.previousPlacements, current),
  };
}
