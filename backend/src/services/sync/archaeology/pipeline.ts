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
 * writes** (`keepFoldsOntoJudged`): the nature test is all that can be asked
 * before the rule runs, because this kind's admission depends on the placements
 * the fold produces, and it lets through a survivor that is archaeological and
 * still never written — whose finds would then be stored for nobody while the
 * museum they came from arrived with an empty case.
 *
 * **And a museum that folded is not a row of its own** (`foldedAway`): it leaves
 * the items whatever its own fame would have said, and is reported once by where
 * it went. The survivor is the name for both, and a second pin holding nothing
 * beside it is a museum whose card is empty because its case is next door.
 *
 * This file is the wiring and the union: nothing here decides what an
 * archaeology museum is (`museumTest.ts`), what a find is (`finds.ts`), which
 * classes count (`classes.ts`), what is known about a candidate (`museums.ts`),
 * or where a find is placed (`museum/placement.ts`).
 */

import { diffPlacements, type PlacementDiff } from '../museum/placementDiff.js';
import { museumRule } from '../museum/venueTest.js';
import { applyFolds, survivorOf } from '../museum/venueGraph.js';
import type { Fold } from '../museum/venueFolds.js';
import { fetchMuseumClasses, type PoolWork } from '../museum/queries.js';
import {
  collectWorks,
  heldBy,
  toContent,
  type WorksCollection,
  type WorksCollectorOptions,
} from '../museum/worksCollector.js';
import { chunk, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { isQid } from '../wikidataUtils.js';
import { collectMuseumPool, fetchArchaeologyTrees, fetchFindFacts } from './queries.js';
import { findsCollectorOptions, type FindFacts } from './finds.js';
import {
  candidatesOf,
  factsOf,
  findJudged,
  findsHeldBy,
  placementOf,
  readCategories,
  readClasses,
  readMembers,
  rowsOf,
  type MuseumRow,
} from './museums.js';
import {
  isMuseumOnWikidata,
  museumNature,
  museumVerdict,
  NOT_A_MUSEUM,
  type MuseumFacts,
  type MuseumNature,
  type MuseumNatureOrVeto,
} from './museumTest.js';
import type { ArchaeologyTrees } from './classes.js';
import { contentsLine, lineStanding, type LinePair, type SourceLine } from '../sourceLine.js';
import type { ClosureOptions } from '../classClosure.js';
import type { FilteredEntity } from '../syncOrchestrator.js';
import type { ProcessedContent } from '../types.js';

const LOG_PREFIX = '[Archaeology Sync]';
const FACT_BATCH = 50;

export interface CollectedArchaeologyMuseum {
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
  /** This kind's other type is the site (ADR-0058 decision 1), which is another door. */
  type: 'museum';
  classes: string[];
  /** What English Wikipedia files the article under; empty where it has none. */
  categories: string[];
  nature: 'archaeological' | 'department';
  /** The signal the nature was read off, so the card can say why. */
  natureWhy: string;
  /** Present on a held row: the question the card shows a curator. */
  admissionNote: string | null;
  /** What it holds that the world knows, with where each was dug up. */
  treasures: ProcessedContent[];
  /**
   * How many of those finds are at or above the finds' **enter** line, kept
   * rather than left to be worked out again from `treasures` and a line this
   * item does not carry.
   *
   * It is what says whether the museum holds a masterpiece, and the badge is
   * the masterpiece (ADR-0045 decision 5): the run badges a museum with one and
   * leaves the Bardo, in the catalogue on its own 35 articles, in the kind
   * without a badge. Not `treasures.length`: a museum arrives with everything
   * it holds, however famous. And not the count the *verdict* was taken on,
   * which forgives a slip to the stay line so an admitted museum does not fall
   * out — the badge grants nothing for a slip, because the same enter line
   * decides each find's own flag where the treasures are written (`judgeOne`).
   */
  findsAboveLine: number;
  /** The most famous find it holds, where a find is what carried it over the line. */
  admittedFor?: { qid: string; label: string };
}

export interface CollectedArchaeology {
  items: CollectedArchaeologyMuseum[];
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
  diff: PlacementDiff;
}

export interface ArchaeologyPipelineDeps {
  sparql: SparqlFn;
  /** Where the previous run left each find, so this run can say what it moved. */
  previousPlacements: Record<string, string[]>;
  /** What the source holds as admitted before the run, so the stay line has something to hold. */
  admitted: ReadonlySet<string>;
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
 * The finds, collected with the museum import's stages under this kind's rule.
 * The site veto is on, where the places of worship switch it off: a park or a
 * church is not a venue for this kind — an open-air excavation is a site
 * (ADR-0058 decision 4), admitted through its own door.
 */
function collectFinds(
  run: QueryRunner,
  deps: ArchaeologyPipelineDeps,
  options: Omit<Parameters<typeof findsCollectorOptions>[0], 'logPrefix'>,
): Promise<WorksCollection> {
  return collectWorks(run, {
    ...findsCollectorOptions({ ...options, logPrefix: LOG_PREFIX }),
    closure: deps.closure,
  });
}

/** A nature this kind admits: one of the two answers that carry a reason. */
type AdmittedNature = Extract<MuseumNature, { why: string }>;

/**
 * Whether a nature is one this kind admits at all: not a veto, and not nothing.
 *
 * A department counts. The Hermitage and the Vatican Museums arrive **held**
 * rather than refused (ADR-0058 decision 2) — a question for a curator, not a
 * museum kept out — and a held survivor is the name on the ticket all the same.
 */
const isThisKind = (nature: MuseumNatureOrVeto): nature is AdmittedNature =>
  !('veto' in nature) && nature.nature !== 'none';

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
 * The same narrowing again, against the museums the run really writes —
 * **a fold stands only onto a survivor this run admits or holds; otherwise the
 * finds stay with the museum that held them.**
 *
 * Asked *after* the verdict, which is the whole reason it is a second step and
 * not a stricter `admits` above. Worship can test its admitted set before its
 * folds because a place there is admitted for its own fame or for a work of its
 * own; this kind's admission depends on the placements the fold produces — a
 * find above the finds' line carries a museum below the place line — so the set
 * does not exist until the rule has run. The nature test is what can be asked
 * first, and it is weaker than it looks: a survivor can be archaeological by
 * class or category and still be a museum no verdict is ever taken on, because
 * nothing put it in a pool, no category named it, and after the fold it holds
 * only finds below the finds' line. The finds moved onto it were then written
 * nowhere and the museum they came from arrived with an empty case.
 *
 * `null` where every fold's survivor is written, which is what ends the caller's
 * loop and what a run with nothing to drop answers on its first round.
 *
 * **Asked in a loop, because one more pass does not settle it.** Dropping a fold
 * does not merely give finds back: it un-folds one survivor into the several
 * museums that claimed those finds, and the holder cap is counted on the length
 * of that list (`selectTier1`). A find claimed by two museums inside one
 * container and by a third elsewhere is held by two venues while the container
 * stands and by three once it does not — over the cap, crediting nobody — so a
 * museum admitted for that find alone stops being admitted, and a fold whose
 * survivor it was must be dropped in its turn. The round has to be asked of the
 * answer the last one gave.
 *
 * What makes that reachable is the clause it is easy to miss: **the finds' line
 * is hysteretic too, so "below the line" is two lines and not one.** `judgeOne`
 * measures a find at the finds' *stay* line for a museum the source already
 * admits and at the *enter* line for one it does not, while the cap is applied
 * to every pool find before any line is read (`placedFinds`). A find **in the
 * band** — between the two — therefore carries a museum already in the catalogue
 * and leaves an unadmitted survivor uncarried: the unadmitted one goes unwritten
 * and its folds drop, the un-folding pushes that same find over the cap, and the
 * admitted one falls with it. Without the band the two would stand or fall
 * together and one pass would do.
 *
 * Two things do bound it, and they are why the loop is short. The fold map is a
 * forest (`breakFoldCycles`), so a chain-terminal survivor never itself gains a
 * fold; and every fold of one tree shares that terminal survivor, so a tree is
 * kept or dropped whole. Termination is simpler still: a round never puts a fold
 * back, so the kept set strictly shrinks.
 */
function keepFoldsOntoJudged(
  works: WorksCollection,
  written: ReadonlySet<string>,
): WorksCollection | null {
  const folds: Record<string, Fold> = {};
  let dropped = 0;
  for (const [qid, fold] of Object.entries(works.folds)) {
    if (written.has(survivorOf(works.folds, qid))) folds[qid] = fold;
    else dropped += 1;
  }
  if (dropped === 0) return null;
  console.log(
    `${LOG_PREFIX} kept ${dropped} museum(s) out of a fold onto a survivor this run does not write`,
  );
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
// What the run hands back
// =============================================================================

/** A find as this kind stores it: the museum import's treasure, saying where it was dug up. */
const treasureOf = (find: PoolWork, facts: Map<string, FindFacts>): ProcessedContent => ({
  ...toContent(find),
  foundAt: facts.get(find.qid)?.discoveryPlace ?? null,
});

/** What this run has decided before it can judge one museum against the rule. */
interface Judging {
  trees: ArchaeologyTrees;
  facts: (qid: string) => MuseumFacts;
  /**
   * Whether English Wikipedia's categories named this museum, and so whether
   * Wikidata has to call it a museum too (`isMuseumOnWikidata`). Asked of every
   * member and not only of those nothing else knows: the venue graph holds
   * every entity a work points at, refused venues included, so a dig one find
   * names in situ is in it exactly as a museum is. What another road really did
   * vouch for passes the gate by construction (`CategoryMembers`).
   */
  namedByCategory: (qid: string) => boolean;
  /** What a museum may be, as the museum import's own closure answers. */
  museumClasses: ReadonlySet<string>;
  /**
   * What each museum holds, most famous first (`heldBy`) — everything a find's
   * statements place there, whatever the holder cap says. This is the card: the
   * treasures the run writes under the museum.
   */
  held: Map<string, PoolWork[]>;
  /**
   * The same map with the holder cap applied (`findsHeldBy`) — what each museum
   * is *credited* with, which is what the three counts below are read off.
   *
   * Two maps and not one, as the art import keeps two (`buildItems` lists
   * `heldBy` while `tier.museums` admits): a hoard split between Athens and
   * London is a real thing to go and see in both, and dropping it from both
   * cards would tell a traveller less than the source knows. What the cap
   * settles is only whether one of them may be admitted or badged *for* it.
   */
  credited: Map<string, PoolWork[]>;
  findFacts: Map<string, FindFacts>;
  admitted: ReadonlySet<string>;
  line: SourceLine;
  findLine: LinePair;
}

function itemOf(input: {
  qid: string;
  row: MuseumRow;
  at: { lat: number; lon: number };
  facts: MuseumFacts;
  nature: AdmittedNature;
  note: string | null;
  finds: PoolWork[];
  findsAboveLine: number;
  admittedFor: PoolWork | undefined;
  findFacts: Map<string, FindFacts>;
}): CollectedArchaeologyMuseum {
  const { qid, row, at, facts, nature, note, finds, findsAboveLine, admittedFor, findFacts } = input;
  return {
    qid,
    label: row.label,
    description: row.description,
    lat: at.lat,
    lon: at.lon,
    imageUrl: row.imageUrl,
    sitelinks: row.sitelinks,
    countryLabel: row.countryLabel,
    articleUrl: row.articleUrl,
    website: row.website,
    type: 'museum',
    classes: facts.classes,
    categories: facts.categories,
    nature: nature.nature,
    natureWhy: nature.why,
    admissionNote: note,
    treasures: finds.map((find) => treasureOf(find, findFacts)),
    findsAboveLine,
    admittedFor: admittedFor ? { qid: admittedFor.qid, label: admittedFor.label } : undefined,
  };
}

/**
 * One museum's fate: admitted, refused by name, or nothing at all — the last
 * being `museumVerdict`'s `out`, a museum nobody has heard of that the source
 * never admitted, on which no rule ran. Naming those would bury the refusals a
 * curator has to read under the long tail.
 */
function judgeOne(
  qid: string,
  row: MuseumRow,
  ctx: Judging,
): { item: CollectedArchaeologyMuseum } | { refusal: FilteredEntity } | null {
  const facts = ctx.facts(qid);
  const refusal = (reason: string) => ({ refusal: { externalId: qid, name: row.label, reason } });

  // What walked in through the editorial shelf is asked whether Wikidata calls
  // it a museum at all: Wikipedia files Pompeii, Sforza Castle and Chichén
  // Itzá under `Archaeological museums in …`, and nothing else in the rule
  // refuses them.
  //
  // Named only where the world has heard of it, which is `lineStanding`'s
  // answer and no second rule: the 27 sites at or above the place line are a
  // worklist the site door will want (ADR-0058 decision 4), while a country's
  // whole archaeology named one row at a time is the long tail that buries the
  // refusals a curator reads — a report nobody finishes is the same silence in
  // a louder voice. An admitted row reaches this gate like any other: the pool
  // carries what the source already admits and the category names it again, so
  // a classless row that has slipped is held to the stay line exactly as the
  // verdict below holds every other, and `fell` names it with its number — a
  // row that leaves the catalogue leaves it with a reason.
  if (ctx.namedByCategory(qid) && !isMuseumOnWikidata(facts, ctx.museumClasses)) {
    const standing = lineStanding(row.sitelinks, ctx.admitted.has(qid), ctx.line);
    return standing === 'out' ? null : refusal(NOT_A_MUSEUM);
  }

  const nature = museumNature(facts, ctx.trees);
  // **The cap binds what a museum is credited with, never what its card lists.**
  // Everything the finds place here is listed and written as this museum's
  // treasures, as the art import lists `heldBy` whatever `selectTier1` did with
  // it: a group of sculptures split between Athens and London is worth seeing in
  // both rooms. The three counts come off `credited` instead — the door's
  // `famous`, the badge's `aboveEnter`, and the `admittedFor` a museum below the
  // place line is carried in by — because a find claimed by more venues than the
  // cap allows admits none of them through `findJudged`, and a museum that
  // arrived by its class or its category must not be admitted and badged for the
  // very find the same run says admits nobody.
  const finds = ctx.held.get(qid) ?? [];
  const credited = ctx.credited.get(qid) ?? [];
  // The find door is hysteretic too: a museum the source already admits keeps
  // its find while the find is above the finds' *stay* line, so Delphi does not
  // fall out the first time the Charioteer slips from 18 articles to 17.
  const above = ctx.admitted.has(qid) ? ctx.findLine.staySitelinks : ctx.findLine.enterSitelinks;
  const famous = credited.filter((find) => find.sitelinks >= above);
  // And the badge counts at the *enter* line, hysteresis or none. Two
  // questions, two numbers: whether the museum stays is the door's, and it
  // forgives a slip; whether it wears the must-see badge is the masterpiece's,
  // and the same enter line decides the find's own flag in the treasure writer.
  // Counted hysteretically, an admitted museum would be badged for a find at 16
  // that the writer leaves unbadged — a museum marked must-see for a work shown
  // without the mark, which ADR-0045 decision 5 and ADR-0023 decision 2 forbid
  // between them.
  //
  // The band the other way is accepted as under-badging: a find that slips from
  // 18 to 16 keeps its own flag (the writer's stay line holds it) while the
  // museum stops counting it, so the museum can stand unbadged beside a badged
  // find. That way round misses a badge; the other claims one the catalogue
  // cannot show.
  const aboveEnter = credited.filter(
    (find) => find.sitelinks >= ctx.findLine.enterSitelinks,
  ).length;

  const verdict = museumVerdict({
    facts,
    sitelinks: row.sitelinks,
    findsForTheDoor: famous.length,
    nature,
    admitted: ctx.admitted,
    line: ctx.line,
  });
  if (!verdict.pass) return 'out' in verdict ? null : refusal(verdict.reason);
  const at = placementOf(row);
  if ('reason' in at) return refusal(at.reason);
  // Unreachable: `museumVerdict` refuses a veto and a `none` above. The check is
  // how the compiler learns what the verdict already decided.
  if (!isThisKind(nature)) return null;

  return {
    item: itemOf({
      qid,
      row,
      at,
      facts,
      nature,
      note: verdict.held ? verdict.note : null,
      finds,
      // The badge's count, not the door's: the verdict above was taken on the
      // hysteretic one, and this is the one the treasure writer will read of
      // each find (ADR-0045 decision 5). Carried rather than worked out again
      // from the treasures, which arrive without a line to measure against.
      findsAboveLine: aboveEnter,
      // A find is what got it in only where the museum's own fame did not
      // (ADR-0058 decision 2), and then the card names the most famous of them.
      //
      // Asked as the standing and not as the enter line alone, because the place
      // line is hysteretic too: a museum the source already admits that has
      // slipped into the band between stay and enter is kept by its *own* fame
      // forgiving the slip, not by anything it holds, and naming a find there
      // would tell a curator the Zeugma Mosaic Museum is in the catalogue for a
      // mosaic when what keeps it is the 20 languages it is written up in.
      admittedFor: lineStanding(row.sitelinks, ctx.admitted.has(qid), ctx.line) === 'in'
        ? undefined
        : famous[0],
      findFacts: ctx.findFacts,
    }),
  };
}

// =============================================================================
// The pipeline
// =============================================================================

export async function collectArchaeologyMuseums(
  deps: ArchaeologyPipelineDeps,
): Promise<CollectedArchaeology> {
  const run = makeRun(deps);
  const trees = await fetchArchaeologyTrees(run);
  const pool = await collectMuseumPool(run, trees, deps.admitted);

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
  const collected = await collectFinds(run, deps, {
    trees, rule: museumRule(museumClasses), workFacts: reader.workFacts,
  });

  const findLine = contentsLine(deps.line);
  const members = await readMembers(run, named.values(), pool, collected.graph);
  const candidates = candidatesOf(pool, collected, members.judged);
  const rows = rowsOf(candidates, pool, collected.graph);
  const classes = await readClasses(run, [...rows.keys()], collected.graph);
  const categories = await readCategories(run, deps.categories, rows);
  const natureOf = (qid: string) => museumNature(factsOf(qid, rows, classes, categories), trees);

  /**
   * The whole verdict over one set of placements: who is judged, what each
   * museum holds and is credited with, and what the rule made of it.
   *
   * A function because it is asked twice on a run where a fold is dropped
   * (below). Nothing in it reads Wikidata — the rows, the classes, the
   * categories and the finds were all read above — so a second pass is a second
   * walk over maps this run already holds.
   */
  const judgeAll = (w: WorksCollection) => {
    // The listing and the credit, off the same placements: the card shows every
    // find placed here, the counts see only the finds the cap places (`Judging`).
    const ctx: Judging = {
      trees,
      facts: (qid) => factsOf(qid, rows, classes, categories),
      namedByCategory: (qid) => members.judged.has(qid),
      museumClasses,
      held: heldBy(w.pool, w.afterFolds),
      credited: findsHeldBy(w, w.afterFolds),
      findFacts: reader.facts,
      admitted: deps.admitted,
      line: deps.line,
      findLine,
    };
    const judged = [
      ...new Set([
        ...pool.keys(),
        ...members.judged,
        ...findJudged(w, w.afterFolds, findLine, deps.admitted),
      ]),
    ].sort((a, b) => (rows.get(b)?.sitelinks ?? 0) - (rows.get(a)?.sitelinks ?? 0));

    const judgedItems: CollectedArchaeologyMuseum[] = [];
    const judgedRefusals: FilteredEntity[] = [];
    for (const qid of judged) {
      const row = rows.get(qid);
      if (!row) {
        // Unreachable, and `candidatesOf` is what makes it so — provably, now.
        // Everything this loop judges comes from the pool, the category walk, or
        // a find's holders under whichever fold set the round is judging. A
        // holder's qid is a value of `applyFolds(works.placed, folds)`, and
        // `applyFolds` maps each venue to itself or to its fold's survivor, so
        // every holder under *any* fold set is a value of `works.placed` or a
        // survivor of a fold — and the candidate set is exactly those two plus
        // the pool, the members and the fold sources.
        //
        // It used to be read off the holders at the two extreme fold sets
        // instead, which is not the same set: the holder cap counts a find's
        // venue list and a kept fold merges two venues into one, so a partial
        // set can name a venue neither extreme does (#888 wave 8).
        //
        // Said out loud rather than dropped — a museum that vanished between two
        // stages of one run is a defect, not a verdict.
        judgedRefusals.push({ externalId: qid, name: qid, reason: `no row to judge: ${qid}` });
        continue;
      }
      const judgement = judgeOne(qid, row, ctx);
      if (judgement && 'item' in judgement) judgedItems.push(judgement.item);
      if (judgement && 'refusal' in judgement) judgedRefusals.push(judgement.refusal);
    }
    return { items: judgedItems, refused: judgedRefusals };
  };

  // A fold may only hand a museum's finds to a museum this kind admits — asked
  // here as the survivor's nature, which is all that can be known before the
  // rule has run.
  let works = foldsOntoAdmitted(collected, (qid) => isThisKind(natureOf(qid)));
  let verdict = judgeAll(works);
  // And asked again against the museums the run really writes, which is the
  // whole of the rule: a survivor can be archaeological by class or category and
  // still be a row no verdict ever admits, and the finds handed to it would be
  // written nowhere.
  //
  // **To a fixed point, not once.** Dropping a fold un-folds a survivor back
  // into the several museums that claimed its finds, and the holder cap is
  // counted on that list (`selectTier1`, `MAX_HOLDERS`): a find claimed by two
  // museums inside one container and by a third elsewhere is under the cap while
  // the two are folded and over it once they are not, so it stops crediting
  // anybody — and the third museum, admitted for that find alone, silently
  // leaves. If it was itself the survivor of another kept fold, that fold's
  // museum would be reported as folded into a row the catalogue does not hold.
  // So each round is asked of the answer the last one gave.
  //
  // It terminates: a round either keeps every fold, or drops at least one and
  // never puts one back, so the kept set strictly shrinks and the empty set is
  // the floor. Nothing in a round reads Wikidata — the rows, the classes, the
  // categories and the finds were all read above — so the cost is a walk over
  // maps this run already holds, once per fold at worst.
  for (;;) {
    const kept = keepFoldsOntoJudged(works, new Set(verdict.items.map((item) => item.qid)));
    if (!kept) break;
    works = kept;
    verdict = judgeAll(works);
  }
  // A museum that folded into a survivor this run writes is that survivor's, and
  // is not a second row beside it: it leaves the items whatever its own fame
  // would have said, and is reported once by the address below.
  const folded = foldedAway(works);
  const items = verdict.items.filter((item) => !folded.has(item.qid));
  const refused = verdict.refused;

  // What the run will actually write: a find is stored as a treasure of a museum
  // this run admits, so the diff is measured against what the database will hold.
  const admitted = new Set(items.map((item) => item.qid));
  const current: Record<string, string[]> = {};
  for (const qid of works.pool.keys()) {
    current[qid] = (works.afterFolds[qid] ?? []).filter((venue) => admitted.has(venue));
  }

  // One line each, never two. The fold's own line comes first, so a museum that
  // folded is reported by where it went rather than by a rule that ran on it
  // before the fold was settled.
  //
  // Nothing guards against a *written* museum turning up here, because nothing
  // can any more: `judgeOne` answers with an item or a refusal and never both,
  // and a museum that folded has already left the items above. Worship's version
  // of this loop checks the admitted set as well, and that check used to be here
  // too — kept while a folded museum could still be admitted, and dead since it
  // cannot.
  const filtered = new Map<string, FilteredEntity>();
  for (const entry of [...folded.values(), ...refused]) {
    if (filtered.has(entry.externalId)) continue;
    filtered.set(entry.externalId, entry);
  }

  const treasures = Object.values(current).filter((placed) => placed.length).length;
  const heldNames = items.filter((item) => item.admissionNote).map((item) => item.label);
  const forFind = items.flatMap((item) => (
    item.admittedFor ? [`${item.label} (${item.admittedFor.label})`] : []
  ));
  console.log(
    `${LOG_PREFIX} Admitted ${items.length} museums `
    + `(${heldNames.length} held for a curator, `
    + `${forFind.length} for a find they hold); `
    + `${filtered.size} refused, ${treasures} treasures to write`,
  );
  // The two counts above, named. A dry run writes nothing, so these two lists
  // exist nowhere but this log: counted alone, neither the museums held for a
  // curator nor the museums a find carried over the line can be read back, and
  // they are exactly the rows ADR-0058 decision 2 is judged on — the open
  // questions a curator would be asked, and the museums admitted for what they
  // hold rather than for their own fame. One line each rather than one per
  // museum, so a run admitting eighty-five still reports them in two.
  if (heldNames.length) console.log(`${LOG_PREFIX} held: ${heldNames.join(', ')}`);
  if (forFind.length) console.log(`${LOG_PREFIX} for a find: ${forFind.join(', ')}`);
  return {
    items,
    // Distinct: a row two doors named is one entity fetched, not two. The
    // members are counted from what the by-id question *answered*, not from
    // what the pool kept — a row dropped for want of an English article was
    // fetched all the same, and a run reports what it asked the source for.
    fetched: new Set([...pool.keys(), ...works.pool.keys(), ...members.fetched]).size,
    filtered: [...filtered.values()],
    diff: diffPlacements(deps.previousPlacements, current),
  };
}
