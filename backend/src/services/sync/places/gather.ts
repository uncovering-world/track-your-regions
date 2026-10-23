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
  fetchBroadPool,
  fetchClassPool,
  fetchEntitiesByIds,
  fetchEntityFacts,
  type EntityFacts,
  type PoolEntity,
} from '../publicArt/queries.js';
import { emptyContainment, loadContainment, type Containment } from './containment.js';

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
}

/** What a pass's gather hands each of its sources: the shares, and the door they were read through. */
export interface PlaceGather {
  gathered: GatheredPlaces;
  sparql: SparqlFn;
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

/**
 * The rows the kinds admit that no class question named — fallen below the
 * pool floor, or retyped by Wikidata — asked for by id, so that every admitted
 * row gets its kind's own reason rather than the sweep's.
 */
async function collectAdmitted(run: QueryRunner, missing: string[]): Promise<Map<string, PoolEntity>> {
  const found = new Map<string, PoolEntity>();
  const batches = chunk(missing, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking after admitted rows the pool did not name (batch ${i + 1}/${batches.length})...`);
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
 * entity's own, and every row the kind admits.
 */
function candidatesOf(
  classes: ReadonlySet<string>,
  admitted: ReadonlySet<string>,
  pooled: Map<string, PoolEntity>,
  byId: Map<string, PoolEntity>,
  facts: Map<string, EntityFacts>,
): { pool: Map<string, PoolEntity>; byId: Set<string>; facts: Map<string, EntityFacts> } {
  const byClass = (qid: string) => (facts.get(qid)?.classes ?? []).some((c) => classes.has(c));
  const pool = new Map([...pooled].filter(([qid]) => admitted.has(qid) || byClass(qid)));
  for (const [qid, entity] of byId) if (admitted.has(qid)) pool.set(qid, entity);
  // A row the kind admits that none of its own classes names is one it has by
  // id, whichever question fetched it: another kind's class question may name
  // a site Archaeology admits, and that vouches for nothing of the site's.
  const askedById = new Set([...pool.keys()].filter((qid) => admitted.has(qid) && (byId.has(qid) || !byClass(qid))));
  const known = new Map<string, EntityFacts>();
  for (const qid of pool.keys()) {
    const entry = facts.get(qid);
    if (entry) known.set(qid, entry);
  }
  return { pool, byId: askedById, facts: known };
}

/** Gather the candidate places of every kind asked for, and what each of them is. */
export async function gatherPlaces(run: QueryRunner, requests: GatherRequest[]): Promise<GatheredPlaces> {
  const { trees, classesOf, roots, narrow } = await askedClasses(run, requests);
  const pooled = await collectPool(run, roots, narrow);
  const admitted = new Set(requests.flatMap(({ admitted: ids }) => [...ids]));
  const byId = await collectAdmitted(run, [...admitted].filter((qid) => !pooled.has(qid)));
  const facts = await collectFacts(run, [...pooled.keys(), ...byId.keys()]);

  const shares = new Map<PlaceKind<unknown>, KindShare<unknown>>();
  for (const { kind, admitted: ids } of requests) {
    const share = candidatesOf(classesOf.get(kind)!, ids, pooled, byId, facts);
    shares.set(kind, { trees: trees.get(kind), ...share, containers: emptyContainment() });
  }

  // Containers once, for the candidates of the kinds that read them.
  const reading = requests.filter(({ kind }) => kind.readsContainers).map(({ kind }) => shares.get(kind)!);
  if (reading.length) {
    const asked = new Map(reading.flatMap((share) => [...share.facts]));
    const containers = await loadContainment(run, [...asked.values()]);
    for (const share of reading) share.containers = containers;
  }
  return { shares, pooled: pooled.size };
}
