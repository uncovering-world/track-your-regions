/**
 * What an admitted venue holds, read from the venue's side (#890).
 *
 * The works pool is class-first: `collectWorks` asks classes, then reads where
 * what it collected is kept. So an object at an admitted venue that carries no
 * class the pool asks for never reaches the kind's keep rule, however famous —
 * the Pergamon Altar is typed `altar` and carries a discovery place, which is a
 * road into the finds and not a class; the Ishtar Gate is `city gate` and
 * `arch`, made in 575 BC. Neither was ever shown to `findReason`, and the
 * Pergamon Museum arrived without either of the two things it is visited for.
 *
 * This stage asks the other question — *what does Wikidata say this venue
 * holds, by a current `P195` or `P276` statement, at the pool's floor?* — of
 * every venue a kind admits, and hands what comes back to the same keep rule
 * the pool uses, with the venue as a known fact. It runs after a kind's
 * admission is settled, because it is asked of the venues that admission
 * produced; what it keeps is placed by the rule a pool work is placed by and
 * merged into the collection, so the writer, the floor (ADR-0044) and the
 * gate never learn which road an object came in on. What it refuses is not
 * lost silently: each refusal carries the object's classes, which is what the
 * class-list slice (#891) reads.
 *
 * **The fold sources are asked too.** The Ishtar Gate's collection is the
 * Vorderasiatisches Museum, which folds into the Pergamon Museum 64 m away
 * (checked 2026-09-15); asked of the survivor alone, the read would miss the
 * one object it exists for.
 *
 * **Bounded and cached like every other pool question** (ADR-0030): one
 * question per batch of venues, at the floor, never a venue whole; one
 * question per batch of objects for what each is; the venue statements and
 * the graph walk the pool's own. The floor is the pool's (`POOL_MIN_SITELINKS`)
 * and not the kind's finds line, because a venue-side object is a pool object
 * the classes never asked for, and a pool question has one floor: a find at 12
 * sitelinks is on its museum's card whichever road found it.
 */

import { placeArtwork } from './placement.js';
import { extendVenueGraph, makeResolver, applyFolds, survivorOf } from './venueGraph.js';
import { fetchVenueStatements, POOL_MIN_SITELINKS, type PoolWork, type RawStatement } from './queries.js';
import { fetchVenueHoldings, fetchWorksByIds, lowestClass, type WorkDetails } from './venueSideQueries.js';
import { isQid } from '../wikidataUtils.js';
import {
  unseenReason,
  type UnseenWork,
  type WorkFacts,
  type WorksCollection,
  type WorksCollectorOptions,
} from './worksCollector.js';
import { chunk, unique, type QueryRunner } from '../wikidataQueries.js';

const VENUE_BATCH = 50;
const OBJECT_BATCH = 50;

/** An object an admitted venue holds that the kind's rule turned down: what it is, for the report. */
export interface RefusedHolding {
  qid: string;
  label: string;
  sitelinks: number;
  /** Every class it carries, with the label the service gave it. */
  classes: { qid: string; label: string }[];
  /** The admitted venues holding it — survivors, so a fold source's holding names the row the run writes. */
  heldBy: string[];
}

export interface VenueSideRead {
  /** The collection with what the read kept merged in: pool, statements, graph, placements, folds applied. */
  collection: WorksCollection;
  /** What the read kept, by id — already in `collection.pool`; listed so a caller can say what arrived this way. */
  kept: Map<string, PoolWork>;
  /** Every object the rule turned down, whatever its fame: what was fetched and not kept. */
  refused: RefusedHolding[];
  /** The refusals at or above the report line: what the run's changeset names (`reportFloor`). */
  reported: RefusedHolding[];
  /** The facts read of every object the venues hold that the pool did not, kept or not. */
  facts: Map<string, WorkFacts>;
  /** Which admitted venues (survivors) hold each object the read met, kept or not. */
  heldBy: Map<string, string[]>;
  /** Every class each object the read asked about carries, with its label, for the report. */
  classes: Map<string, { qid: string; label: string }[]>;
  /** The line a refusal is named above, as the read was given it. */
  reportFloor: number;
  counts: { venues: number; held: number; alreadyInPool: number };
}

export interface VenueSideOptions {
  /** The venues the kind admits and writes: the survivors. Their fold sources are added here. */
  admitted: Iterable<string>;
  /** The floor the holdings are read at; the pool's unless a caller says otherwise. */
  floor?: number;
  /**
   * The line a refusal is *reported* above: the kind's own contents line — the
   * finds' stay line, a church's, the art museums' release line. What is kept
   * is kept at the pool's floor, like any pool work; what is refused is named
   * only where the world has heard of it, because the report exists for a
   * person to read which classes the pool never asked for, and every painting
   * in the Louvre refused as not a find would bury the Library of Ashurbanipal
   * under a long tail. Absent, every refusal is reported.
   */
  reportFloor?: number;
  /**
   * Objects an earlier read already judged, by id — a kind that reads in
   * rounds hands the last rounds' refusals in, so a museum both hold does not
   * have the same object fetched and refused twice. Its holders are still
   * recorded (`heldBy`), since the question is asked of the venues and the
   * answer names it; only the fetch and the verdict are spared.
   */
  skip?: ReadonlySet<string>;
}

/** The venues to ask about: every admitted survivor, and every venue folded into one. */
function venuesToRead(collection: WorksCollection, admitted: ReadonlySet<string>): string[] {
  const venues = new Set(admitted);
  for (const source of Object.keys(collection.folds)) {
    if (admitted.has(survivorOf(collection.folds, source))) venues.add(source);
  }
  return [...venues];
}

/**
 * The classes a kind calls its own, in the order a label is chosen: the extra
 * classes (a relic, a find class), then the roots, then the pinned ones. An
 * object carrying one is typed by it, because that is the word the kind would
 * have shown had the class pool collected it.
 */
function ownClassesOf(opts: WorksCollectorOptions): Map<string, string> {
  const own = new Map<string, string>();
  for (const [qid, label] of Object.entries(opts.extraClasses ?? {})) own.set(qid, label);
  for (const root of [...opts.broadRoots, ...opts.wholeRoots]) own.set(root.qid, root.type);
  for (const [qid, label] of Object.entries(opts.pinned)) own.set(qid, label);
  return own;
}

/**
 * The object typed as the pool would have typed it: by a class the kind calls
 * its own where it carries one, else by the lowest-numbered class the pool
 * asked for (the closure's word, which the by-id answer labelled), else as the
 * by-id question left it.
 */
function retyped(
  details: WorkDetails,
  own: ReadonlyMap<string, string>,
  asked: ReadonlySet<string>,
): PoolWork {
  for (const [qid, label] of own) {
    if (details.classes.has(qid)) return { ...details.work, type: label, typeQid: qid };
  }
  const inPool = new Map([...details.classes].filter(([qid]) => asked.has(qid)));
  const typeQid = lowestClass(inPool);
  if (typeQid === null) return details.work;
  const label = inPool.get(typeQid);
  return label !== undefined && !isQid(label)
    ? { ...details.work, type: label, typeQid }
    : { ...details.work, typeQid };
}

async function readHoldings(
  run: QueryRunner,
  venues: string[],
  floor: number,
  folds: WorksCollection['folds'],
): Promise<Map<string, { sitelinks: number; heldBy: Set<string>; venues: Set<string> }>> {
  const held = new Map<string, { sitelinks: number; heldBy: Set<string>; venues: Set<string> }>();
  const batches = chunk(venues, VENUE_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Reading what each admitted venue holds (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const holding of await fetchVenueHoldings(run.sparql, batches[i], floor)) {
      const entry = held.get(holding.work)
        ?? { sitelinks: holding.sitelinks, heldBy: new Set<string>(), venues: new Set<string>() };
      entry.heldBy.add(survivorOf(folds, holding.venue));
      entry.venues.add(holding.venue);
      held.set(holding.work, entry);
    }
  }
  return held;
}

async function readDetails(run: QueryRunner, qids: string[]): Promise<Map<string, WorkDetails>> {
  const details = new Map<string, WorkDetails>();
  const batches = chunk(qids, OBJECT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking what each object found from the venue's side is (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const [qid, row] of await fetchWorksByIds(run.sparql, batches[i])) details.set(qid, row);
  }
  return details;
}

/**
 * The facts the keep rule reads: every class the by-id question answered with,
 * and whatever the kind's own `workFacts` adds — the discovery place, for the
 * finds. The kind's hook is asked of the same ids, so a caller that keeps what
 * it read (the archaeology run keeps the find spot for the treasure) sees these
 * objects in the same map as the pool's.
 */
async function readFacts(
  run: QueryRunner,
  details: Map<string, WorkDetails>,
  opts: WorksCollectorOptions,
): Promise<Map<string, WorkFacts>> {
  const facts = new Map<string, WorkFacts>();
  for (const [qid, row] of details) {
    facts.set(qid, { classes: [...row.classes.keys()], discoveryPlace: null });
  }
  if (!opts.workFacts || !details.size) return facts;
  for (const [qid, extra] of await opts.workFacts(run, [...details.keys()])) {
    const base = facts.get(qid);
    if (!base) continue;
    base.classes = unique([...base.classes, ...extra.classes]);
    base.discoveryPlace = extra.discoveryPlace;
  }
  return facts;
}

async function readStatements(
  run: QueryRunner,
  qids: string[],
): Promise<Map<string, RawStatement[]>> {
  const byWork = new Map<string, RawStatement[]>();
  const batches = chunk(qids, OBJECT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Reading venue statements of the objects kept (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const statement of await fetchVenueStatements(run.sparql, batches[i])) {
      const held = byWork.get(statement.work) ?? [];
      held.push(statement);
      byWork.set(statement.work, held);
    }
  }
  return byWork;
}

/**
 * Read what every admitted venue holds, keep what the kind's rule keeps, and
 * merge it into the collection as if the pool had collected it.
 *
 * `opts` are the collector options the pool was collected with — the same
 * `keep`, `workFacts`, rule and classes — so the venue-side read cannot answer
 * the kind's question differently from the pool. A kind with no `keep` keeps
 * what carries a class the pool asked for (`askedClasses`): the pool's own
 * vocabulary, which is the honest answer until the class list learns
 * (#891) — and every refusal names the classes that would teach it.
 */
export async function readVenueSide(
  run: QueryRunner,
  collection: WorksCollection,
  opts: WorksCollectorOptions,
  venueSide: VenueSideOptions,
): Promise<VenueSideRead> {
  const admitted = new Set(venueSide.admitted);
  const floor = venueSide.floor ?? POOL_MIN_SITELINKS;
  const venues = venuesToRead(collection, admitted);
  const held = await readHoldings(run, venues, floor, collection.folds);

  // The pool's decision stands, kept or refused: what it holds is placed
  // already, and what its keep turned down would only be fetched again, judged
  // the same and named twice.
  const skip = venueSide.skip ?? new Set<string>();
  const fresh = [...held.keys()].filter(
    (qid) => !collection.pool.has(qid) && !collection.refusedByKeep.has(qid) && !skip.has(qid),
  );
  const details = await readDetails(run, fresh);
  const facts = await readFacts(run, details, opts);
  const own = ownClassesOf(opts);
  const keep = opts.keep
    ?? ((_work: PoolWork, workFacts: WorkFacts | undefined) =>
      (workFacts?.classes ?? []).some((cls) => collection.askedClasses.has(cls)));

  const reportFloor = venueSide.reportFloor ?? floor;
  const kept = new Map<string, PoolWork>();
  const refused: RefusedHolding[] = [];
  for (const [qid, row] of details) {
    const work = retyped(row, own, collection.askedClasses);
    if (keep(work, facts.get(qid))) {
      kept.set(qid, work);
    } else {
      refused.push({
        qid,
        label: work.label,
        sitelinks: work.sitelinks,
        classes: [...row.classes].map(([cls, label]) => ({ qid: cls, label })),
        heldBy: [...(held.get(qid)?.heldBy ?? [])],
      });
    }
  }

  const statements = await readStatements(run, [...kept.keys()]);
  // The venues the kept objects name, and the ones they were read at: an
  // admitted venue that entered by its class or category and holds no pool
  // work is in no graph yet, and placing the object needs its facts.
  const seeds = unique([
    ...[...statements.values()].flat().map((s) => s.venue).filter((v): v is string => v !== null),
    ...[...kept.keys()].flatMap((qid) => [...(held.get(qid)?.venues ?? [])]),
  ]);
  const graph = await extendVenueGraph(run, collection.graph, seeds, opts.rule);
  const resolver = makeResolver(graph, opts.rule);

  const pool = new Map(collection.pool);
  const allStatements = new Map(collection.statements);
  const placed = { ...collection.placed };
  const unseen: Record<string, UnseenWork> = { ...collection.unseen };
  const arrived: Record<string, string[]> = {};
  for (const [qid, work] of kept) {
    const ownStatements = statements.get(qid) ?? [];
    const venuesOfWork = placeArtwork(ownStatements, resolver.resolve, graph.ancestors);
    // The lost tree asked of the object's own classes, since it was never in
    // the class pool `collectLost` intersects with; the label is its own class's.
    const lost = new Map<string, string>();
    for (const [cls, label] of details.get(qid)?.classes ?? []) {
      if (collection.lostClasses.has(cls)) lost.set(qid, label);
    }
    const reason = unseenReason(qid, ownStatements, lost);
    pool.set(qid, work);
    allStatements.set(qid, ownStatements);
    if (reason === null) {
      placed[qid] = venuesOfWork;
      arrived[qid] = venuesOfWork;
    } else {
      placed[qid] = [];
      arrived[qid] = [];
      unseen[qid] = { reason, wouldBe: venuesOfWork };
    }
  }
  const afterFolds = { ...collection.afterFolds, ...applyFolds(arrived, collection.folds) };

  const reported = refused.filter((refusal) => refusal.sitelinks >= reportFloor);
  console.log(
    `${opts.logPrefix} Venue-side read: ${venues.length} venues hold ${held.size} objects at `
    + `${floor}+ sitelinks; ${held.size - fresh.length} already in the pool, ${kept.size} kept as `
    + `${opts.noun.works}, ${refused.length} refused (${reported.length} at ${reportFloor}+ sitelinks, named)`,
  );
  return {
    collection: { ...collection, pool, statements: allStatements, graph, resolver, placed, unseen, afterFolds },
    kept,
    refused,
    reported,
    facts,
    heldBy: new Map([...held].map(([qid, entry]) => [qid, [...entry.heldBy]])),
    classes: new Map([...details].map(([qid, row]) => [
      qid, [...row.classes].map(([cls, label]) => ({ qid: cls, label })),
    ])),
    reportFloor,
    counts: { venues: venues.length, held: held.size, alreadyInPool: held.size - fresh.length },
  };
}

/**
 * The objects the read kept that the kind then wrote nowhere: placed at no
 * venue the kind admits, once its own rules have run over the merged
 * collection (`current`). A kept object is not a written one — its statements
 * can resolve to a venue the kind refuses, or to nothing, and a place of
 * worship's rules can hand it to the museum that owns it — and a kind that
 * only reported what `keep` refused would lose these silently. Named at the
 * same line as the refusals; the reason is the kind's to give.
 */
export function keptElsewhere(
  read: VenueSideRead,
  current: Record<string, string[]>,
): RefusedHolding[] {
  const out: RefusedHolding[] = [];
  for (const [qid, work] of read.kept) {
    if ((current[qid] ?? []).length > 0 || work.sitelinks < read.reportFloor) continue;
    out.push({
      qid,
      label: work.label,
      sitelinks: work.sitelinks,
      classes: read.classes.get(qid) ?? [],
      heldBy: read.heldBy.get(qid) ?? [],
    });
  }
  return out;
}

/** One sentence for the changeset: the reason, then which of the run's rows hold the object. */
export function holdingReason(
  refusal: RefusedHolding,
  reason: string,
  nameOf: (qid: string) => string,
): string {
  return `${reason} — held by ${refusal.heldBy.map(nameOf).join(', ')}`;
}

/**
 * The sentence a refusal is reported with: what the object is by its classes,
 * and which of the run's rows hold it. The names are the caller's, since the
 * admitted venues are the kind's rows and the graph need not know them.
 */
export function refusedHoldingReason(
  refusal: RefusedHolding,
  noun: { work: string },
  nameOf: (qid: string) => string,
): string {
  const classes = refusal.classes.length
    ? refusal.classes.map((c) => `${c.label} (${c.qid})`).join(', ')
    : 'no class at all';
  return holdingReason(refusal, `not a ${noun.work} by its classes: ${classes}`, nameOf);
}
