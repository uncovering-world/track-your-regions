/**
 * One gather of the candidate works of every works kind (#1821, ADR-0132
 * decision 1): the class closures every kind's roots reach, one pool over every
 * class a kind asks its works by, the venue statements of that pool, and the
 * lost tree, each read once. No kind filters what is gathered; each kind takes
 * its own share (`worksShare`) and decides about it in `worksOf`
 * (`worksCollector.ts`).
 *
 * A kind's share is exact. A pool question names a work by a class it carries
 * itself (`wdt:P31`, best rank), and every gathered work keeps the classes it
 * was named by (`PoolWork.classes`), so the share is the works one of whose
 * classes the kind asked for. It is typed by replaying the kind's own questions
 * over them, in the kind's order: its broad roots, then its narrow and extra
 * classes in batches of `CLASS_BATCH`, each typing a work by the first class it
 * carries in that batch, merged as `mergeWork` merges. On the subset that is
 * the answer the kind's own questions gave, row for row. So a museum never sees
 * a relic only Places of worship asked for, and Archaeology, which asks no
 * painting, never sees one.
 */

import { boundedClosure, type ClosureOptions } from '../classClosure.js';
import {
  fetchBroadPool,
  fetchClassPool,
  fetchVenueStatements,
  type PoolClass,
  type PoolWork,
  type RawStatement,
} from './queries.js';
import {
  fetchSubclasses,
  fetchClassTree,
  chunk,
  unique,
  type QueryRunner,
} from '../wikidataQueries.js';
import type { SyncProgress } from '../types.js';

/**
 * The root of the classes a work that no longer exists carries: `lost artwork`
 * (Q4140840), whose `P279*` tree is `destroyed artwork`, `lost sculpture` and
 * `lost painting` (measured 2026-09-12: four classes, read whole by
 * `fetchClassTree` and never pinned, so a class Wikidata adds under it counts).
 *
 * A work in it admits no venue and is nobody's treasure (#868): the Isabella
 * Stewart Gardner Museum was in the world tier for *The Storm on the Sea of
 * Galilee*, stolen in 1990 and never found, and a traveller who went for it
 * would find an empty frame. Read off the work's own classes rather than off
 * the class it was collected under, because the closure under `painting`
 * reaches `lost painting` but not `lost artwork`: *Portrait of a Courtesan* is
 * a `painting` and a `lost artwork`, and arrives typed `painting`. A theft
 * (`P793`) is deliberately not read — 414 of 425 theft events carry no end
 * time, and most of those works were recovered long ago.
 *
 * Places of worship reads the same tree through the same stage: the Statue of
 * Zeus at Olympia opens no door for its temple (ADR-0052 decision 3).
 */
export const LOST_WORK_ROOT = 'Q4140840';

export const CLASS_BATCH = 25;
const STATEMENT_BATCH = 50;

/**
 * What a kind asks the gather for: the classes its works are, and nothing of
 * what it then decides about them.
 */
export interface WorksRequest {
  /** The broad roots asked in fame bands, with the treasure type their label gives. */
  broadRoots: { qid: string; type: string }[];
  /** Roots narrow enough to take whole (drawing, print, …). */
  wholeRoots: { qid: string; type: string }[];
  /** Classes no closure reaches, pinned by name: the label is the type the venue-side read gives a work. */
  pinned: Record<string, string>;
  /** Classes asked whole beside the narrow ones, without a closure: a kind's own roots (relic, tomb). */
  extraClasses?: Record<string, string>;
  /** Pinned classes that are editions. */
  pinnedEditionClasses: ReadonlySet<string>;
  editionRoot: string;
  closure?: ClosureOptions;
}

/** The works of every kind that asked, read once. */
export interface GatheredWorks {
  /** Each asked root's closure, root included, by the root and the closure options it was walked with. */
  closures: ReadonlyMap<string, readonly string[]>;
  /** Every class a pool question asked, so a share can refuse a kind the gather was not asked for. */
  asked: ReadonlySet<string>;
  /** Every work any question named, with every class it was named by. */
  pool: ReadonlyMap<string, PoolWork>;
  /** The works of `pool` by each class they carry. */
  byClass: ReadonlyMap<string, readonly PoolWork[]>;
  /** The venue statements of every work of the pool. */
  statements: ReadonlyMap<string, RawStatement[]>;
  /** Every work of the lost tree at the pool's floor, with the lost-tree class it was named by. */
  lostPool: ReadonlyMap<string, string>;
  /** The lost tree (`LOST_WORK_ROOT`). */
  lostClasses: ReadonlySet<string>;
}

/**
 * The works a pass gathers for its works kinds, as a kind's pipeline asks for
 * them: read on first ask by whichever kind asks first, through the pass's
 * door (ADR-0132 decision 5), with the museum tree every works kind's rule
 * reads and Places of worship's treasure classes read once beside them, so a
 * kind's own request is the one the gather was asked for.
 */
export interface SharedWorks {
  gathered(): Promise<GatheredWorks>;
  museumClasses(): Promise<ReadonlySet<string>>;
  treasureClasses(): Promise<Record<string, string>>;
}

/**
 * The same, as the pass holds them: each read made with the progress of the
 * run that asks first, so its phases show on that run's section and a Cancel
 * of that run stops it.
 */
export interface PassWorks {
  gathered(progress: SyncProgress): Promise<GatheredWorks>;
  museumClasses(progress: SyncProgress): Promise<ReadonlySet<string>>;
  treasureClasses(progress: SyncProgress): Promise<Record<string, string>>;
}

/** The classes a kind's works can be, as its own closure answered them. */
export interface ShareClasses {
  all: string[];
  /** Classes whose works exist in editions rather than as a single original. */
  edition: ReadonlySet<string>;
}

/** A kind's share of the gather: its pool, typed as its own questions type it, and its classes. */
export interface WorksShare {
  pool: Map<string, PoolWork>;
  classes: ShareClasses;
  /** Its narrow and extra classes as it asks them, after the broad roots. */
  narrowAndExtra: string[];
}

/**
 * How the gather's phase lines and log lines name what it reads. A run of one
 * kind names its own things: "Finding the classes a work of art can be" is the
 * wrong sentence on the screen of a run collecting relics and tombs (#753); a
 * pass gathering for several kinds says `work`.
 */
export interface GatherOptions {
  logPrefix: string;
  noun: { work: string; works: string };
}

/** What a pass gathering for several kinds calls the things it reads. */
export const WORK_NOUN = { work: 'work', works: 'works' } as const;

const closureKey = (root: string, opts: ClosureOptions | undefined): string => `${root} ${JSON.stringify(opts ?? {})}`;

const rootsOf = (request: WorksRequest) => [...request.broadRoots, ...request.wholeRoots];

/**
 * A narrow class names a work better than the root it also instantiates, so it wins the type;
 * everything else fills a gap rather than overwriting an answer.
 */
export function mergeWork(existing: PoolWork, incoming: PoolWork, broadTypes: ReadonlySet<string>): void {
  if (broadTypes.has(existing.type) && !broadTypes.has(incoming.type)) {
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
  existing.classes = mergeClasses(existing.classes, incoming.classes);
}

/** Two answers' classes of one work: the first answer's order, a label filled where it lacked one. */
function mergeClasses(existing: PoolClass[] | undefined, incoming: PoolClass[] | undefined): PoolClass[] | undefined {
  if (!incoming?.length) return existing;
  if (!existing?.length) return incoming.map((c) => ({ ...c }));
  const merged = existing.map((c) => ({ ...c }));
  for (const c of incoming) {
    const held = merged.find((m) => m.qid === c.qid);
    if (!held) merged.push({ ...c });
    else if (held.label === null) held.label = c.label;
  }
  return merged;
}

/** The labels a kind's types merge under: its roots' and the generic one. */
export function broadTypesOf(request: WorksRequest): ReadonlySet<string> {
  return new Set(rootsOf(request).map((r) => r.type).concat('artwork'));
}

async function walkClosures(run: QueryRunner, requests: WorksRequest[], { logPrefix, noun }: GatherOptions): Promise<Map<string, string[]>> {
  run.phase(`Finding the classes a ${noun.work} can be...`);
  const closures = new Map<string, string[]>();
  for (const request of requests) {
    for (const root of rootsOf(request)) {
      const key = closureKey(root.qid, request.closure);
      if (closures.has(key)) continue;
      const { refused, byRoot } = await boundedClosure(
        [root.qid],
        async (qids) => {
          await run.step();
          return fetchSubclasses(run.sparql, qids);
        },
        request.closure,
      );
      for (const r of refused) {
        console.log(`${logPrefix} Class closure stopped at ${r.root} hop ${r.hop}: ${r.offered} classes offered`);
      }
      closures.set(key, byRoot[root.qid] ?? [root.qid]);
    }
  }
  return closures;
}

/** The classes a kind's works can be: its roots' closures in its own order, then its pinned classes. */
function classesOf(request: WorksRequest, closures: ReadonlyMap<string, readonly string[]>): ShareClasses {
  const reached = new Set<string>();
  const byRoot = new Map<string, readonly string[]>();
  for (const root of rootsOf(request)) {
    const closure = closures.get(closureKey(root.qid, request.closure));
    if (!closure) throw new Error(`The gather of works was not asked for the classes of ${root.type} (${root.qid})`);
    byRoot.set(root.qid, closure);
    for (const qid of closure) reached.add(qid);
  }
  const all = [...new Set([...reached, ...Object.keys(request.pinned)])];
  const edition = new Set([...(byRoot.get(request.editionRoot) ?? []), ...request.pinnedEditionClasses]);
  return { all, edition };
}

/** A kind's narrow and extra classes as it asks them: everything but its broad roots, then its extra classes, once each. */
function narrowAndExtraOf(request: WorksRequest, all: readonly string[]): string[] {
  const narrow = all.filter((c) => !request.broadRoots.some((r) => r.qid === c));
  return unique([...narrow, ...Object.keys(request.extraClasses ?? {})]);
}

async function collectUnionPool(
  run: QueryRunner,
  requests: WorksRequest[],
  closures: ReadonlyMap<string, readonly string[]>,
  { logPrefix, noun }: GatherOptions,
): Promise<{ pool: Map<string, PoolWork>; asked: Set<string> }> {
  const pool = new Map<string, PoolWork>();
  const asked = new Set<string>();
  // Merged with no type of its own winning: a kind's type is its own replay's (`worksShare`).
  const add = (works: PoolWork[]) => {
    for (const work of works) {
      const existing = pool.get(work.qid);
      if (existing) mergeWork(existing, work, new Set([existing.type, work.type]));
      else pool.set(work.qid, { ...work, classes: work.classes?.map((c) => ({ ...c })) });
    }
  };

  // Each broad root paces and reports its own bands: they are minutes apart, not seconds.
  const broad = new Map<string, { qid: string; type: string }>();
  for (const request of requests) for (const root of request.broadRoots) if (!broad.has(root.qid)) broad.set(root.qid, root);
  for (const root of broad.values()) {
    add(await fetchBroadPool(run, root));
    asked.add(root.qid);
  }

  // Batched kind by kind, each kind's classes no earlier kind asked, so no batch
  // mixes two kinds' classes: a question's row limit (`failIfTruncated` on the
  // live service) is then met by one kind's classes, as it was when each kind
  // asked its own. The museums ask first and their batches are their own; Places
  // of worship then asks only its treasures' classes.
  const batches: string[][] = [];
  for (const request of requests) {
    const own = unique(narrowAndExtraOf(request, classesOf(request, closures).all)).filter((c) => !broad.has(c) && !asked.has(c));
    for (const c of own) asked.add(c);
    batches.push(...chunk(own, CLASS_BATCH));
  }
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching narrow classes of ${noun.works} ${i + 1}/${batches.length}...`);
    await run.step();
    add(await fetchClassPool(run, batches[i]));
  }

  console.log(`${logPrefix} Pool: ${pool.size} ${noun.works}`);
  return { pool, asked };
}

/** The venue statements of the works named, in batches of `STATEMENT_BATCH`. */
export async function collectStatements(
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

/**
 * The lost tree and its works at the pool's floor (`LOST_WORK_ROOT`).
 *
 * The tree is asked whole (`fetchClassTree`, four classes) and then asked for
 * its works the way a narrow class is (`fetchClassPool`, one question); a
 * kind's lost works are what that answer has in common with its pool. Kept
 * whole rather than intersected here, because a kind's pool can still grow
 * past the gather's: the finds Archaeology reads under the pool's floor.
 */
async function collectLostPool(run: QueryRunner, { noun }: GatherOptions): Promise<{ lostPool: Map<string, string>; tree: ReadonlySet<string> }> {
  run.phase(`Asking which ${noun.works} no longer exist...`);
  await run.step();
  const tree = await fetchClassTree(run.sparql, LOST_WORK_ROOT, 'lost artwork classes');
  const lostPool = new Map<string, string>();
  // A step before each query, as every other stage takes one: the pause and the
  // cancel check land between the two questions, not only before the first.
  await run.step();
  for (const work of await fetchClassPool(run, [...tree])) lostPool.set(work.qid, work.type);
  return { lostPool, tree };
}

/** Read the candidate works of every kind asking, once. */
export async function gatherWorks(run: QueryRunner, requests: WorksRequest[], options: GatherOptions): Promise<GatheredWorks> {
  const closures = await walkClosures(run, requests, options);
  const { pool, asked } = await collectUnionPool(run, requests, closures, options);
  const byClass = new Map<string, PoolWork[]>();
  for (const work of pool.values()) {
    for (const c of work.classes ?? []) {
      const held = byClass.get(c.qid) ?? [];
      held.push(work);
      byClass.set(c.qid, held);
    }
  }
  const statements = await collectStatements(run, [...pool.keys()]);
  const { lostPool, tree } = await collectLostPool(run, options);
  return { closures, asked, pool, byClass, statements, lostPool, lostClasses: tree };
}

/**
 * A kind's share of the gather, typed as its own questions would have typed
 * it: its broad roots first, each typing a work by its label, then its narrow
 * and extra classes in its own batches, each typing a work by the first class
 * it carries in that batch, all merged by `mergeWork` under the kind's own
 * broad types.
 */
export function worksShare(gathered: GatheredWorks, request: WorksRequest): WorksShare {
  const classes = classesOf(request, gathered.closures);
  const narrowAndExtra = narrowAndExtraOf(request, classes.all);
  const unasked = [...request.broadRoots.map((r) => r.qid), ...narrowAndExtra].filter((c) => !gathered.asked.has(c));
  if (unasked.length) throw new Error(`The gather of works did not ask ${unasked.length} classes this kind asks, ${unasked.slice(0, 3).join(', ')} among them`);

  const broadTypes = broadTypesOf(request);
  const pool = new Map<string, PoolWork>();
  const add = (work: PoolWork, type: string, typeQid: string | null) => {
    // A copy per kind: a kind's tail writes on its works (`handedBy`, `placedBy`), and the gather is every kind's.
    const typed: PoolWork = { ...work, creators: [...work.creators], classes: work.classes?.map((c) => ({ ...c })), type, typeQid };
    const existing = pool.get(work.qid);
    if (existing) mergeWork(existing, typed, broadTypes);
    else pool.set(work.qid, typed);
  };

  for (const root of request.broadRoots) {
    for (const work of gathered.byClass.get(root.qid) ?? []) add(work, root.type, root.qid);
  }
  for (const batch of chunk(narrowAndExtra, CLASS_BATCH)) {
    const inBatch = new Set(batch);
    const named = new Set<PoolWork>();
    for (const c of batch) for (const work of gathered.byClass.get(c) ?? []) named.add(work);
    for (const work of named) {
      const cls = (work.classes ?? []).find((c) => inBatch.has(c.qid));
      if (cls) add(work, cls.label ?? 'artwork', cls.qid);
    }
  }
  return { pool, classes, narrowAndExtra };
}
