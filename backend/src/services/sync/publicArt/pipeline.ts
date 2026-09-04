/**
 * Classes first, then the entities, then what each of them is.
 *
 * The old import asked five direct questions and wrote whatever answered; this
 * collects the way the museum import does: it learns which classes count from
 * the class tree, asks for their instances by fame, fetches the facts about
 * each candidate and about what holds it, and only then decides — so every
 * row has a reason that can be named, and every refusal is filed with one.
 *
 * Nothing here decides anything on its own: the rule is `publicArtTest.ts`,
 * the lists are `classes.ts`, the questions are `queries.ts`. This file is
 * the wiring and the fame line.
 */

import { boundedClosure } from '../classClosure.js';
import {
  chunk,
  fetchClassTree,
  fetchSubclasses,
  unique,
  MUSEUM_ROOT,
  type QueryRunner,
} from '../wikidataQueries.js';
import {
  buildTrees,
  COMMEMORATIVE_ROOTS,
  FOUNTAIN_ROOT,
  INDOOR_CLASSES,
  SCULPTURAL_ROOTS,
  WORSHIP_ROOT,
  type PublicArtTrees,
} from './classes.js';
import { publicArtVerdict, type ContainerFact } from './publicArtTest.js';
import {
  fetchBroadPool,
  fetchClassPool,
  fetchEntitiesByIds,
  fetchEntityFacts,
  fetchContainerFacts,
  type PoolEntity,
  type EntityFacts,
  type ContainerFacts,
} from './queries.js';
import type { FilteredEntity } from '../syncOrchestrator.js';
import type { WikidataLandmark } from '../types.js';

/**
 * The world tier's fame line, and the same one the museums use (ADR-0023):
 * a row enters at 22 Wikipedia-language sitelinks and stays until it falls
 * below 18, so the list does not flap as Wikipedia grows. Belonging to the
 * tier is the Iconic badge (ADR-0045 decision 5); the regional tier, which
 * carries none, is filled from regional sources by rules #799 writes.
 */
export const ENTER_SITELINKS = 22;
export const STAY_SITELINKS = 18;

/**
 * The four classes broad enough to need bands: `monument` and `memorial` in
 * the heritage sense have tens of thousands of instances, `sculpture` and
 * `statue` more. Their labels are for the phase message only; the type a
 * reader sees is decided by the verdict.
 */
const BROAD_ROOTS = [
  { qid: 'Q860861', label: 'sculpture' },
  { qid: 'Q179700', label: 'statue' },
  { qid: 'Q4989906', label: 'monument' },
  { qid: 'Q5003624', label: 'memorial' },
];

const CLASS_BATCH = 25;
const FACT_BATCH = 50;

/**
 * How far up from a work its containers are followed: a room, its wing, the
 * museum. The Venus de Milo is located in Room 345 of the Sully Wing of the
 * Louvre, and only the third of those carries a museum class. The museum
 * import walks `P361` the same distance (`VENUE_HOPS`).
 */
const CONTAINER_HOPS = 3;

export interface CollectedPublicArt {
  items: WikidataLandmark[];
  /** Distinct entities the pool named. */
  fetched: number;
  filtered: FilteredEntity[];
}

async function collectTrees(run: QueryRunner): Promise<PublicArtTrees> {
  // A step before every hop, as the museum walk does: each hop is one query,
  // and the runner's step is where the pacing is spent and a cancel is heard.
  const children = async (qids: string[]) => {
    await run.step();
    return fetchSubclasses(run.sparql, qids);
  };

  run.phase('Walking the class tree under sculpture and statue...');
  const sculptural = await boundedClosure(Object.keys(SCULPTURAL_ROOTS), children);
  run.phase('Walking the class trees under fountain, war memorial and cenotaph...');
  const fountain = await boundedClosure([FOUNTAIN_ROOT], children);
  const commemorative = await boundedClosure(Object.keys(COMMEMORATIVE_ROOTS), children);
  for (const refusal of [...sculptural.refused, ...fountain.refused, ...commemorative.refused]) {
    console.log(`[Landmark Sync] Closure under ${refusal.root} stopped at hop ${refusal.hop}: ${refusal.offered} classes offered`);
  }

  run.phase('Reading what a museum and a place of worship are...');
  await run.step();
  const museum = await fetchClassTree(run.sparql, MUSEUM_ROOT, 'museum classes');
  await run.step();
  const worship = await fetchClassTree(run.sparql, WORSHIP_ROOT, 'places of worship');

  return buildTrees({
    sculptural: sculptural.classes,
    fountain: fountain.classes,
    commemorative: commemorative.classes,
    museum,
    worship,
  });
}

/**
 * Every entity an admitting class names, at the pool's floor or above, once.
 *
 * The broad roots are asked in bands; every other admitting class — the
 * closures' children and the pinned structures — in batches, taken whole. An
 * entity two questions both offer is one entity: a memorial that is also a
 * cenotaph, a colossal statue that is also a sculpture.
 */
async function collectPool(
  run: QueryRunner, trees: PublicArtTrees, admitted: ReadonlySet<string>,
): Promise<Map<string, PoolEntity>> {
  const pool = new Map<string, PoolEntity>();
  for (const root of BROAD_ROOTS) {
    for (const entity of await fetchBroadPool(run, root)) pool.set(entity.qid, entity);
  }

  const broad = new Set(BROAD_ROOTS.map((r) => r.qid));
  const narrow = [...trees.admitting].filter((c) => !broad.has(c));
  const batches = chunk(narrow, CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching the narrow classes (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const entity of await fetchClassPool(run.sparql, batches[i])) {
      if (!pool.has(entity.qid)) pool.set(entity.qid, entity);
    }
  }

  // The rows the category admits that no class question named — fallen below
  // the pool floor, or retyped by Wikidata — are asked for by id, so that
  // every admitted row gets the rule's own reason rather than the sweep's.
  const missing = [...admitted].filter((qid) => !pool.has(qid));
  const missingBatches = chunk(missing, FACT_BATCH);
  for (let i = 0; i < missingBatches.length; i++) {
    run.phase(`Asking after admitted rows the pool did not name (batch ${i + 1}/${missingBatches.length})...`);
    await run.step();
    for (const entity of await fetchEntitiesByIds(run.sparql, missingBatches[i])) pool.set(entity.qid, entity);
  }
  return pool;
}

async function collectFacts(
  run: QueryRunner, qids: string[],
): Promise<{ facts: Map<string, EntityFacts>; containers: Map<string, ContainerFacts> }> {
  const facts = new Map<string, EntityFacts>();
  const batches = chunk(qids, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking what each candidate is (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const [qid, entry] of await fetchEntityFacts(run.sparql, batches[i])) facts.set(qid, entry);
  }

  // What holds the candidates, then what holds that, up to CONTAINER_HOPS: each
  // hop asks only about containers no earlier hop answered for.
  const containers = new Map<string, ContainerFacts>();
  let frontier = unique([...facts.values()].flatMap((f) => [...f.locations, ...f.parents]));
  for (let hop = 1; hop <= CONTAINER_HOPS && frontier.length; hop++) {
    const batches = chunk(frontier, FACT_BATCH);
    for (let i = 0; i < batches.length; i++) {
      run.phase(`Asking what holds them (hop ${hop}/${CONTAINER_HOPS}, batch ${i + 1}/${batches.length})...`);
      await run.step();
      for (const [qid, entry] of await fetchContainerFacts(run.sparql, batches[i])) containers.set(qid, entry);
    }
    frontier = unique(frontier.flatMap((qid) => containers.get(qid)?.parents ?? []))
      .filter((qid) => !containers.has(qid));
  }
  return { facts, containers };
}

/**
 * The building above a container along its own chain: the first thing up the
 * first-parent line that is not itself a room or a wing — the palace above a
 * room's wing, or directly above a room, and never the city above the palace
 * that a deeper fetch happened to reach. Follows the chain as far as the facts
 * pass fetched; where every fetched ancestor is a room or a wing, the
 * outermost of them; nothing when the container is the top of what is known.
 */
function buildingAbove(qid: string, containers: Map<string, ContainerFacts>): string | undefined {
  let top: string | undefined;
  let current = qid;
  for (let hop = 1; hop < CONTAINER_HOPS; hop++) {
    const parent = containers.get(current)?.parents[0];
    if (parent === undefined) break;
    const known = containers.get(parent);
    if (!known) break;
    top = known.label;
    if (!known.classes.some((c) => INDOOR_CLASSES[c])) break;
    current = parent;
  }
  return top;
}

/**
 * Everything a candidate stands in or is part of, the containers' own
 * containers included, nearest first — so the reason names the room's museum
 * rather than the room. As many levels as the facts pass fetched and no
 * further: a level nothing was asked about would come back as a bare QID with
 * no classes, and a reason that names one.
 */
function containerFacts(facts: EntityFacts, containers: Map<string, ContainerFacts>): ContainerFact[] {
  const out: ContainerFact[] = [];
  const seen = new Set<string>();
  let frontier = [...facts.locations, ...facts.parents];
  for (let hop = 0; hop < CONTAINER_HOPS && frontier.length; hop++) {
    const next: string[] = [];
    for (const qid of frontier) {
      if (seen.has(qid)) continue;
      seen.add(qid);
      const known = containers.get(qid);
      out.push({
        qid,
        label: known?.label ?? qid,
        classes: known?.classes ?? [],
        building: buildingAbove(qid, containers),
      });
      next.push(...(known?.parents ?? []));
    }
    frontier = next;
  }
  return out;
}

/**
 * Where a candidate that passed the rule stands against the fame line: in,
 * out, or — for a row the category admits that has fallen below the stay
 * line — refused by name, with its number. A candidate that was never in and
 * is below the line is simply out: a refusal names a rule, and none ran on it.
 */
function lineVerdict(
  entity: PoolEntity, admitted: ReadonlySet<string>,
): 'in' | 'out' | 'fell' {
  if (entity.sitelinks >= ENTER_SITELINKS) return 'in';
  if (!admitted.has(entity.qid)) return 'out';
  return entity.sitelinks >= STAY_SITELINKS ? 'in' : 'fell';
}

/**
 * Collect the public art the world knows: the candidates that pass the rule
 * and clear the fame line, and every candidate the rule refused, with the
 * reason it gave.
 *
 * `admitted` is what the category holds as admitted before the run, so the
 * stay line has something to hold. Items come back most famous first, which
 * is the order the run writes them in and the order a person watching it
 * reads.
 */
export async function collectPublicArt(
  run: QueryRunner,
  admitted: ReadonlySet<string>,
): Promise<CollectedPublicArt> {
  const trees = await collectTrees(run);
  const pool = await collectPool(run, trees, admitted);
  const { facts, containers } = await collectFacts(run, [...pool.keys()]);

  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  for (const entity of candidates) {
    const known = facts.get(entity.qid) ?? { classes: [], locations: [], parents: [], creators: [] };
    const verdict = publicArtVerdict({
      qid: entity.qid,
      classes: known.classes,
      containers: containerFacts(known, containers),
      onEarth: entity.onEarth,
      lat: entity.lat,
      lon: entity.lon,
    }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    // The verdict refused anything placeless above; this narrows the type,
    // it cannot fire.
    if (entity.lat === null || entity.lon === null) continue;
    const line = lineVerdict(entity, admitted);
    if (line === 'out') continue;
    if (line === 'fell') {
      filtered.push({
        externalId: entity.qid,
        name: entity.label,
        reason: `${entity.sitelinks} sitelinks: below the world tier's line `
          + `(${ENTER_SITELINKS} to enter, ${STAY_SITELINKS} to stay)`,
      });
      continue;
    }
    items.push({
      qid: entity.qid,
      label: entity.label,
      description: entity.description,
      lat: entity.lat,
      lon: entity.lon,
      imageUrl: entity.imageUrl,
      creators: known.creators,
      year: entity.year,
      sitelinks: entity.sitelinks,
      countryLabel: entity.countryLabel,
      type: verdict.type,
      classes: known.classes,
      artwork: verdict.artwork,
      articleUrl: entity.articleUrl,
      website: entity.website,
    });
  }

  console.log(
    `[Landmark Sync] Pool of ${pool.size}: ${items.length} admitted, ${filtered.length} refused, `
    + `${pool.size - items.length - filtered.length} below the line and never in`,
  );
  return { items, fetched: pool.size, filtered };
}
