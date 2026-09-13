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
 * **The folds are the museum import's**, narrowed once by this kind: a museum
 * folds only onto a survivor this kind admits — by class, by category, or as a
 * department held for a curator — so an archaeological collection is never taken
 * out of the catalogue by a fold onto a museum the rule refuses.
 * `worship/pipeline.ts` found that shape first, with the Cappella Paolina.
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
import { lineStanding, type LinePair, type SourceLine } from '../sourceLine.js';
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
  /** The most famous find it holds, where a find is what carried it over the line. */
  admittedFor?: { qid: string; label: string };
}

export interface CollectedArchaeology {
  items: CollectedArchaeologyMuseum[];
  /**
   * Distinct entities this run named: the museums the classes gave it, those
   * English Wikipedia's categories added, and the finds kept.
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
 * A museum that received a find above the line and then folded into another is
 * a museum the run proposed and no longer does, so it is reported with the
 * reason the fold rule gave — worship's `foldLosses`, which found the shape.
 * Narrowed by the line, where worship counts any work it kept: a museum whose
 * finds are all below the finds' line was never going to be admitted for them,
 * and a line about it would count a loss the catalogue did not have.
 */
function foldLosses(works: WorksCollection, findLine: LinePair): FilteredEntity[] {
  const received = new Set<string>();
  for (const find of works.pool.values()) {
    if (find.sitelinks < findLine.enterSitelinks) continue;
    for (const venue of works.placed[find.qid] ?? []) received.add(venue);
  }
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
  admittedFor: PoolWork | undefined;
  findFacts: Map<string, FindFacts>;
}): CollectedArchaeologyMuseum {
  const { qid, row, at, facts, nature, note, finds, admittedFor, findFacts } = input;
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
  const finds = ctx.held.get(qid) ?? [];
  const credited = ctx.credited.get(qid) ?? [];
  // The find door is hysteretic too: a museum the source already admits keeps
  // its find while the find is above the finds' *stay* line, so Delphi does not
  // fall out the first time the Charioteer slips from 18 articles to 17.
  const above = ctx.admitted.has(qid) ? ctx.findLine.staySitelinks : ctx.findLine.enterSitelinks;
  const famous = credited.filter((find) => find.sitelinks >= above);

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

  const findLine = deps.line.find ?? deps.line;
  const members = await readMembers(run, named.values(), pool, collected.graph);
  const candidates = candidatesOf(pool, collected, findLine, deps.admitted, members.judged);
  const rows = rowsOf(candidates, pool, collected.graph);
  const classes = await readClasses(run, [...rows.keys()], collected.graph);
  const categories = await readCategories(run, deps.categories, rows);
  const natureOf = (qid: string) => museumNature(factsOf(qid, rows, classes, categories), trees);

  // A fold may only hand a museum's finds to a museum this kind admits.
  const works = foldsOntoAdmitted(collected, (qid) => isThisKind(natureOf(qid)));
  // The listing and the credit, off the same placements: the card shows every
  // find placed here, the counts see only the finds the cap places (`Judging`).
  const held = heldBy(works.pool, works.afterFolds);
  const credited = findsHeldBy(works, works.afterFolds);
  const judged = [
    ...new Set([
      ...pool.keys(),
      ...members.judged,
      ...findJudged(works, works.afterFolds, findLine, deps.admitted),
    ]),
  ].sort((a, b) => (rows.get(b)?.sitelinks ?? 0) - (rows.get(a)?.sitelinks ?? 0));

  const ctx: Judging = {
    trees,
    facts: (qid) => factsOf(qid, rows, classes, categories),
    namedByCategory: (qid) => members.judged.has(qid),
    museumClasses,
    held,
    credited,
    findFacts: reader.facts,
    admitted: deps.admitted,
    line: deps.line,
    findLine,
  };
  const items: CollectedArchaeologyMuseum[] = [];
  const refused: FilteredEntity[] = [];
  for (const qid of judged) {
    const row = rows.get(qid);
    if (!row) {
      // Unreachable: every candidate came from the pool or from the graph, and
      // both answered with a row. Said out loud rather than dropped — a museum
      // that vanished between two stages of one run is a defect, not a verdict.
      refused.push({ externalId: qid, name: qid, reason: `no row to judge: ${qid}` });
      continue;
    }
    const judgement = judgeOne(qid, row, ctx);
    if (judgement && 'item' in judgement) items.push(judgement.item);
    if (judgement && 'refusal' in judgement) refused.push(judgement.refusal);
  }

  // What the run will actually write: a find is stored as a treasure of a museum
  // this run admits, so the diff is measured against what the database will hold.
  const admitted = new Set(items.map((item) => item.qid));
  const current: Record<string, string[]> = {};
  for (const qid of works.pool.keys()) {
    current[qid] = (works.afterFolds[qid] ?? []).filter((venue) => admitted.has(venue));
  }

  // A museum this run admits is not also a refusal, and a fold it survived is
  // not a loss: the guard is worship's, for the same reason.
  const filtered = new Map<string, FilteredEntity>();
  for (const entry of [...refused, ...foldLosses(works, findLine)]) {
    if (admitted.has(entry.externalId) || filtered.has(entry.externalId)) continue;
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
