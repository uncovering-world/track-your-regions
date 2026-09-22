/**
 * Classes first, then the entities, then what each of them is.
 *
 * Not five direct questions with whatever answers written down: this
 * collects the way the museum import does. It learns which classes count from
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
import { belowLineReason, lineStanding, type LinePair } from '../sourceLine.js';
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
 * carries none, is filled from regional sources by the rules of
 * docs/tech/filling-a-kind.md (ADR-0048).
 */
export const ENTER_SITELINKS = 22;
export const STAY_SITELINKS = 18;

/**
 * Those two as the pair every kind's line standing is asked with
 * (`sourceLine.ts`). This source states its line in code rather than on its row,
 * so the pair is built here; what is asked of it — in, out, or fallen by name —
 * and the sentence a fallen row is refused with are the shared ones, written
 * once for the whole catalogue (#884).
 */
const LINE: LinePair = { enterSitelinks: ENTER_SITELINKS, staySitelinks: STAY_SITELINKS };

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

  // The rows the source admits that no class question named — fallen below
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

  // What owns the candidates: one hop and no walk, because ownership is not
  // a place — the rule reads an owner only for a candidate nothing places,
  // and asks only whether it is a museum or a church (#804). The same
  // question the containers are asked, for the owners no hop reached.
  const owners = unique([...facts.values()].flatMap((f) => f.collections))
    .filter((qid) => !containers.has(qid));
  const ownerBatches = chunk(owners, FACT_BATCH);
  for (let i = 0; i < ownerBatches.length; i++) {
    run.phase(`Asking what owns them (batch ${i + 1}/${ownerBatches.length})...`);
    await run.step();
    for (const [qid, entry] of await fetchContainerFacts(run.sparql, ownerBatches[i])) containers.set(qid, entry);
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

/** A container still to be described: how the entity reaches it, and from where when walked. */
type Reach = Pick<ContainerFact, 'qid' | 'relation' | 'via'>;

/**
 * Everything a candidate stands in or is part of, the containers' own
 * containers included, nearest first — so the reason names the room's museum
 * rather than the room — each saying how it was reached: by the candidate's
 * own `located in` or `part of`, or walked up to from the containers `via`
 * names — every one of them, so that the rule, which reads a museum the
 * candidate is part of as its owner rather than its place and drops what
 * stands only above that museum (#803), sees a second route to the same
 * thing whichever order the source listed the statements in. As many levels
 * as the facts pass fetched and no further: a level nothing was asked about
 * would come back as a bare QID with no classes, and a reason that names
 * one.
 */
function containerFacts(facts: EntityFacts, containers: Map<string, ContainerFacts>): ContainerFact[] {
  const out: ContainerFact[] = [];
  const seen = new Map<string, ContainerFact>();
  let frontier: Reach[] = [
    ...facts.locations.map((qid): Reach => ({ qid, relation: 'located in' })),
    ...facts.parents.map((qid): Reach => ({ qid, relation: 'part of' })),
  ];
  for (let hop = 0; hop < CONTAINER_HOPS && frontier.length; hop++) {
    const next: Reach[] = [];
    for (const reach of frontier) {
      const already = seen.get(reach.qid);
      if (already) {
        // Listed once, reached again: another walk arrives at it, which is
        // recorded — on a container the candidate's own statement names too,
        // so that a museum the candidate is part of and stands in the
        // courtyard of is read as where it stands.
        if (reach.via) already.via = [...(already.via ?? []), ...reach.via];
        continue;
      }
      const known = containers.get(reach.qid);
      const fact: ContainerFact = {
        ...reach,
        label: known?.label ?? reach.qid,
        classes: known?.classes ?? [],
        building: buildingAbove(reach.qid, containers),
      };
      seen.set(reach.qid, fact);
      out.push(fact);
      next.push(...(known?.parents ?? []).map((qid): Reach => ({ qid, relation: 'above', via: [reach.qid] })));
    }
    frontier = next;
  }
  return out;
}

/**
 * What owns a candidate, one level and no further: an owner is not a place,
 * so it has no chain and no building above it. Handed in whatever the
 * candidate's containers say; the rule decides when to read it.
 */
function collectionFacts(facts: EntityFacts, containers: Map<string, ContainerFacts>): ContainerFact[] {
  return facts.collections.map((qid) => {
    const known = containers.get(qid);
    return { qid, label: known?.label ?? qid, classes: known?.classes ?? [], relation: 'in the collection of' };
  });
}

/**
 * Collect the public art the world knows: the candidates that pass the rule
 * and clear the fame line, and every candidate the rule refused, with the
 * reason it gave.
 *
 * `admitted` is what the source holds as admitted before the run, so the
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
    const known = facts.get(entity.qid)
      ?? { classes: [], locations: [], parents: [], collections: [], creators: [] };
    const verdict = publicArtVerdict({
      qid: entity.qid,
      classes: known.classes,
      containers: containerFacts(known, containers),
      collections: collectionFacts(known, containers),
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
    const standing = lineStanding(entity.sitelinks, admitted.has(entity.qid), LINE);
    if (standing === 'out') continue;
    if (standing === 'fell') {
      filtered.push({
        externalId: entity.qid,
        name: entity.label,
        reason: belowLineReason(entity.sitelinks, LINE),
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
