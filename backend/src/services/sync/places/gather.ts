/**
 * One gather of the candidate places of every Wikidata place kind (#1820,
 * ADR-0132 decision 1): the class trees each kind's rule reads, one pool over
 * every class a kind asks its candidates by, and the facts about each
 * candidate once. No kind filters what is gathered; each kind classifies its
 * own share of it.
 *
 * A kind's share is exact, because a pool question names an entity by a
 * class it carries itself (`wdt:P31`, best rank, on the live service and on
 * the subset alike): an entity the pool named is a candidate of every kind
 * whose classes one of its own classes is, and a row a kind already admits is
 * that kind's candidate whatever it carries now. So Public art never sees the
 * churches only Places of worship asked for, and refuses none of them.
 */

import {
  chunk,
  type QueryRunner,
  type SparqlFn,
} from '../wikidataQueries.js';
import {
  emptyFacts,
  fetchBroadPool,
  fetchClassPool,
  fetchEntitiesByIds,
  fetchEntityFacts,
  type EntityFacts,
  type PoolEntity,
} from '../publicArt/queries.js';
import { emptyContainment, loadContainment, type Containment } from './containment.js';
import { loadSubjects, type SubjectFacts, type SubjectRunner } from '../publicArt/subjects.js';
import type { RegionalPool } from './regionalPool.js';

const CLASS_BATCH = 25;
const FACT_BATCH = 50;

/** A class broad enough to be asked in bands, with the word its phase message names it by. */
export interface PoolRoot {
  qid: string;
  label: string;
}

/**
 * A place kind as the gather reads it: the trees its rule reads, and the
 * classes whose instances are its candidates. What it then decides about them
 * is its classifier's, over its share (`shareOf`).
 */
export interface PlaceKind<Trees> {
  /** Named in a phase message and a log line. */
  name: string;
  /** Walks the class trees the kind's rule reads. */
  trees(run: QueryRunner): Promise<Trees>;
  /** The classes its candidates are asked by: the broad ones in bands, every other one whole. */
  poolClasses(trees: Trees): { broad: readonly PoolRoot[]; narrow: Iterable<string> };
  /**
   * Whether its rule reads what holds a candidate (`P276`, `P361`) and what
   * owns it (`P195`). Only those kinds' candidates have them asked.
   */
  readsContainers: boolean;
  /** Whether its rule reads what a candidate depicts (`P180`): what that item is (`publicArt/subjects.ts`). */
  readsSubjects?: boolean;
  /**
   * The editions among its candidates (#880, ADR-0145): `enter` names the
   * groups that enter the pool through their casts, with no point of their own;
   * `attach` writes each group's casts onto its pool entity once the facts are
   * read, so the rule sees the casts' classes and the run writes their points.
   */
  editions?: {
    enter(run: QueryRunner): Promise<PoolEntity[]>;
    attach(run: QueryRunner, pool: Map<string, PoolEntity>, facts: Map<string, EntityFacts>): Promise<void>;
  };
  /**
   * Classes whose instances are its candidates below the pool's floor, with
   * the floor they are asked at (#1947): a canal's lock or boat lift is a sight
   * read in few languages — the Anderton Boat Lift has 11 Wikipedia editions —
   * and the kind's own line for them decides. Only this kind sees them.
   */
  belowFloor?(trees: Trees): { classes: readonly string[]; floor: number };
  /**
   * Candidates named by what they are filed under rather than by a class
   * (#2035): a street-art place is typed a wall, a road or a tunnel, and the
   * category or genre it is filed under is what names it. Only this kind sees
   * the ones no class question named, and its classifier decides them.
   */
  entrance?(run: QueryRunner): Promise<string[]>;
}

/** A kind's share of the gather: its trees, and its candidates with what is known of them. */
export interface KindShare<Trees> {
  trees: Trees;
  pool: Map<string, PoolEntity>;
  /**
   * The rows of `pool` the kind admits that no class question named, asked
   * for by id: such a row vouches for nothing but its id, and a kind that reads
   * other entrances (Archaeology's map) asks them about it first.
   */
  byId: Set<string>;
  facts: Map<string, EntityFacts>;
  /** What holds and owns its candidates; empty for a kind that reads none. */
  containers: Containment;
  /** What its candidates depict, by item id; empty for a kind that reads none. */
  subjects: Map<string, SubjectFacts>;
  /** The rows of `pool` its entrance named (`entrance`); empty for a kind that has none. */
  entered: Set<string>;
  /**
   * The rows of `entered` that are candidates by the entrance alone: no class
   * question of the kind named them and the kind does not admit them.
   */
  enteredOnly: Set<string>;
}

/** The kinds a gather was asked for, with what each of them admits before the run. */
export interface GatherRequest {
  kind: PlaceKind<unknown>;
  admitted: ReadonlySet<string>;
}

/** What one gather read, before any kind decided anything. */
export interface GatheredPlaces {
  shares: Map<PlaceKind<unknown>, KindShare<unknown>>;
  /** Distinct entities the pool questions named, the rows asked for by id aside. */
  pooled: number;
  /** Every class the kinds' pool questions asked by, together: the regional tier's pool is their items (ADR-0171, #2178). */
  classes: ReadonlySet<string>;
}

/** What a pass's gather hands each of its sources: the shares, and the door they were read through. */
export interface PlaceGather {
  gathered: GatheredPlaces;
  sparql: SparqlFn;
  /** The runner the gather read with, for what a source reads after it through the same door (the regional tier, #2178). */
  run: SubjectRunner;
  /** The pass's regional pool (ADR-0171), read once on first ask; null where the run read the live service. */
  regional: () => Promise<RegionalPool | null>;
}

/** One kind's share, typed by its declaration. */
export function shareOf<Trees>(gathered: GatheredPlaces, kind: PlaceKind<Trees>): KindShare<Trees> {
  const share = gathered.shares.get(kind as PlaceKind<unknown>);
  if (!share) throw new Error(`The gather was not asked for ${kind.name}`);
  return share as KindShare<Trees>;
}

/**
 * Every entity the kinds' classes name, at the pool's floor or above, once.
 *
 * The broad roots are asked in bands, each once however many kinds ask for it;
 * every other class in batches, taken whole. An entity two questions both
 * offer is one entity.
 */
async function collectPool(
  run: QueryRunner, roots: PoolRoot[], narrow: string[],
): Promise<Map<string, PoolEntity>> {
  const pool = new Map<string, PoolEntity>();
  for (const root of roots) {
    for (const entity of await fetchBroadPool(run, root)) pool.set(entity.qid, entity);
  }
  const batches = chunk(narrow, CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching the narrow classes (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const entity of await fetchClassPool(run, batches[i])) {
      if (!pool.has(entity.qid)) pool.set(entity.qid, entity);
    }
  }
  return pool;
}

/** The rows `missing` names that no class question named, asked for by id; `what` names them in the phase. */
async function collectById(run: QueryRunner, missing: string[], what: string): Promise<Map<string, PoolEntity>> {
  const found = new Map<string, PoolEntity>();
  const batches = chunk(missing, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking after ${what} the pool did not name (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const entity of await fetchEntitiesByIds(run, batches[i])) found.set(entity.qid, entity);
  }
  return found;
}

async function collectFacts(run: QueryRunner, qids: string[]): Promise<Map<string, EntityFacts>> {
  const facts = new Map<string, EntityFacts>();
  const batches = chunk(qids, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking what each candidate is (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const [qid, entry] of await fetchEntityFacts(run.sparql, batches[i])) facts.set(qid, entry);
  }
  return facts;
}

/** Every kind's trees, and the classes the pool is asked by: the broad roots once each, then the rest. */
async function askedClasses(run: QueryRunner, requests: GatherRequest[]) {
  const trees = new Map<PlaceKind<unknown>, unknown>();
  const classesOf = new Map<PlaceKind<unknown>, Set<string>>();
  const roots = new Map<string, PoolRoot>();
  for (const { kind } of requests) {
    const kindTrees = await kind.trees(run);
    trees.set(kind, kindTrees);
    const asked = kind.poolClasses(kindTrees);
    for (const root of asked.broad) roots.set(root.qid, root);
    classesOf.set(kind, new Set([...asked.broad.map((root) => root.qid), ...asked.narrow]));
  }
  const narrow = new Set([...classesOf.values()].flatMap((classes) => [...classes]).filter((qid) => !roots.has(qid)));
  return { trees, classesOf, roots: [...roots.values()], narrow: [...narrow] };
}

/**
 * A kind's candidates: what the pool named by one of the kind's classes, the
 * entity's own, every row the kind admits, and every row its entrance named.
 */
function candidatesOf(
  classes: ReadonlySet<string>,
  admitted: ReadonlySet<string>,
  named: ReadonlySet<string>,
  pooled: Map<string, PoolEntity>,
  byId: Map<string, PoolEntity>,
  facts: Map<string, EntityFacts>,
): { pool: Map<string, PoolEntity>; byId: Set<string>; facts: Map<string, EntityFacts>; entered: Set<string>; enteredOnly: Set<string> } {
  const byClass = (qid: string) => (facts.get(qid)?.classes ?? []).some((c) => classes.has(c));
  const wanted = (qid: string) => admitted.has(qid) || named.has(qid);
  const pool = new Map([...pooled].filter(([qid]) => wanted(qid) || byClass(qid)));
  for (const [qid, entity] of byId) if (wanted(qid)) pool.set(qid, entity);
  // A row the kind admits that none of its own classes names is one it has by
  // id, whichever question fetched it: another kind's class question may name
  // a site Archaeology admits, and that vouches for nothing of the site's.
  const askedById = new Set([...pool.keys()].filter((qid) => admitted.has(qid) && (byId.has(qid) || !byClass(qid))));
  const known = new Map<string, EntityFacts>();
  for (const qid of pool.keys()) {
    const entry = facts.get(qid);
    if (entry) known.set(qid, entry);
  }
  const entered = new Set([...pool.keys()].filter((qid) => named.has(qid)));
  const enteredOnly = new Set([...entered].filter((qid) => !admitted.has(qid) && !byClass(qid)));
  return { pool, byId: askedById, facts: known, entered, enteredOnly };
}

/**
 * The candidates each kind asks for below the pool's floor (`belowFloor`), by
 * kind: entities the pool already named stay the pool's, and the rest are the
 * asking kind's alone, so no other kind meets a candidate under its floor.
 */
async function collectBelowFloor(
  run: QueryRunner, requests: GatherRequest[], trees: Map<PlaceKind<unknown>, unknown>, pooled: Map<string, PoolEntity>,
): Promise<Map<PlaceKind<unknown>, Map<string, PoolEntity>>> {
  const out = new Map<PlaceKind<unknown>, Map<string, PoolEntity>>();
  for (const { kind } of requests) {
    if (!kind.belowFloor) continue;
    const { classes, floor } = kind.belowFloor(trees.get(kind));
    const own = new Map<string, PoolEntity>();
    const batches = chunk([...classes], CLASS_BATCH);
    for (let i = 0; i < batches.length; i++) {
      run.phase(`Fetching ${kind.name} below the pool floor (batch ${i + 1}/${batches.length})...`);
      await run.step();
      for (const entity of await fetchClassPool(run, batches[i], undefined, floor)) {
        if (!pooled.has(entity.qid)) own.set(entity.qid, entity);
      }
    }
    out.set(kind, own);
  }
  return out;
}

/** The ids each kind's entrance names (`entrance`), by kind. */
async function collectEntrances(run: QueryRunner, requests: GatherRequest[]): Promise<Map<PlaceKind<unknown>, Set<string>>> {
  const out = new Map<PlaceKind<unknown>, Set<string>>();
  for (const { kind } of requests) {
    if (!kind.entrance) continue;
    run.phase(`Reading what names ${kind.name} beside its classes...`);
    await run.step();
    out.set(kind, new Set(await kind.entrance(run)));
  }
  return out;
}

/** The pool as one kind sees it: the shared pool and what it asked below the floor. */
function withOwn(pooled: Map<string, PoolEntity>, own: Map<string, PoolEntity> | undefined): Map<string, PoolEntity> {
  return own ? new Map([...own, ...pooled]) : pooled;
}

/** Gather the candidate places of every kind asked for, and what each of them is. */
export async function gatherPlaces(run: SubjectRunner, requests: GatherRequest[]): Promise<GatheredPlaces> {
  const { trees, classesOf, roots, narrow } = await askedClasses(run, requests);
  const pooled = await collectPool(run, roots, narrow);
  const editions = requests.map(({ kind }) => kind.editions).filter((e): e is NonNullable<typeof e> => e !== undefined);
  for (const edition of editions) {
    for (const entity of await edition.enter(run)) if (!pooled.has(entity.qid)) pooled.set(entity.qid, entity);
  }
  const admitted = new Set(requests.flatMap(({ admitted: ids }) => [...ids]));
  // An admitted row fallen below the pool floor, or retyped by Wikidata, gets
  // its kind's own reason rather than the sweep's.
  const byId = await collectById(run, [...admitted].filter((qid) => !pooled.has(qid)), 'admitted rows');
  const named = await collectEntrances(run, requests);
  const namedIds = new Set([...named.values()].flatMap((ids) => [...ids]));
  for (const [qid, entity] of await collectById(run, [...namedIds].filter((qid) => !pooled.has(qid) && !byId.has(qid)), 'the places an entrance named')) {
    byId.set(qid, entity);
  }
  const low = await collectBelowFloor(run, requests, trees, pooled);
  const lowIds = [...low.values()].flatMap((own) => [...own.keys()]);
  const facts = await collectFacts(run, [...new Set([...pooled.keys(), ...byId.keys(), ...lowIds])]);
  for (const edition of editions) await edition.attach(run, pooled, facts);

  const shares = new Map<PlaceKind<unknown>, KindShare<unknown>>();
  for (const { kind, admitted: ids } of requests) {
    const share = candidatesOf(classesOf.get(kind)!, ids, named.get(kind) ?? new Set(), withOwn(pooled, low.get(kind)), byId, facts);
    shares.set(kind, { trees: trees.get(kind), ...share, containers: emptyContainment(), subjects: new Map() });
  }

  // Containers once, for the candidates of the kinds that read them.
  const reading = requests.filter(({ kind }) => kind.readsContainers).map(({ kind }) => shares.get(kind)!);
  if (reading.length) {
    const asked = new Map(reading.flatMap((share) => [...share.facts]));
    // A group of casts is judged where each cast stands (#2036), so what holds
    // the casts is asked with what holds the candidates.
    const casts = reading.flatMap((share) => [...share.pool.values()].flatMap((entity) => entity.casts ?? []))
      .flatMap((cast) => cast.placements?.length ? [{ ...emptyFacts(), locations: cast.placements }] : []);
    const containers = await loadContainment(run, [...asked.values(), ...casts]);
    for (const share of reading) share.containers = containers;
  }
  // Subjects once, for the candidates of the kinds that read them.
  const depicting = requests.filter(({ kind }) => kind.readsSubjects).map(({ kind }) => shares.get(kind)!);
  if (depicting.length) {
    const subjects = await loadSubjects(run, depicting.flatMap((share) => [...share.facts.values()].flatMap((f) => f.depicts)));
    for (const share of depicting) share.subjects = subjects;
  }
  return { shares, pooled: pooled.size, classes: new Set([...classesOf.values()].flatMap((set) => [...set])) };
}
