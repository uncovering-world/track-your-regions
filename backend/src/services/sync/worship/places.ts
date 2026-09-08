/**
 * Door one: a place of worship the world already knows by name.
 *
 * The public-art shape over the worship tree — a banded pool of what the
 * admitting classes name, the facts about each candidate, the rule, and then
 * the fame line — with one difference of its own: the line is not a constant
 * here but a number the source row states (`sourceLine.ts`), so a kind can be
 * widened from the admin panel rather than by a deploy.
 *
 * Nothing here decides what a place of worship is: that is `worshipTest.ts`,
 * over the sets `classes.ts` composes. This file is the wiring.
 */

import { chunk, type QueryRunner } from '../wikidataQueries.js';
import {
  fetchBroadPool,
  fetchClassPool,
  fetchEntitiesByIds,
  fetchEntityFacts,
  type EntityFacts,
  type PoolEntity,
} from '../publicArt/queries.js';
import { worshipVerdict } from './worshipTest.js';
import { BROAD_WORSHIP_ROOTS, type WorshipTrees, type WorshipType } from './classes.js';
import type { SourceLine } from '../sourceLine.js';
import type { FilteredEntity } from '../syncOrchestrator.js';

const CLASS_BATCH = 25;
const FACT_BATCH = 50;

/** A place the rule admitted and the line let in, with what the run learned about it. */
export interface PlaceCandidate {
  entity: PoolEntity;
  /** Every `P31` it carries, as the catalogue stores them. */
  classes: string[];
  type: WorshipType | null;
}

export interface PlacesByFame {
  places: Map<string, PlaceCandidate>;
  /** Refusals, most famous first: what the rule turned away, and by what name. */
  filtered: FilteredEntity[];
  /**
   * Every `P31` of every entity the pool named — the admitted, the refused and
   * the merely unfamous alike, keyed by QID.
   *
   * The pipeline reads it for a question door one does not ask: whether a
   * *work* the other door collected is itself a place of worship. The works
   * pool knows only the one class a work was collected under, and the Cavern of
   * the Patriarchs (`mosque, synagogue, tomb, mausoleum, …`) arrives there as a
   * tomb — this map is where its mosque class is (#753).
   */
  classesOf: Map<string, string[]>;
}

/**
 * Every entity an admitting class names, at the pool's floor or above, once.
 *
 * The nine broad roots are asked in fame bands; every other class of the tree
 * in batches, taken whole. **The part classes are asked too**, though the rule
 * refuses every one of them: a bell tower Wikidata types nothing else is a row
 * a person looking at the run should see refused by name — the Leaning Tower,
 * the Giralda, St Mark's Campanile — rather than one that silently never
 * arrived. It is 22 rows at the pool's floor, measured on 2026-09-04.
 */
async function collectPool(
  run: QueryRunner,
  trees: WorshipTrees,
  admitted: ReadonlySet<string>,
): Promise<Map<string, PoolEntity>> {
  const pool = new Map<string, PoolEntity>();
  for (const root of BROAD_WORSHIP_ROOTS) {
    for (const entity of await fetchBroadPool(run, root)) pool.set(entity.qid, entity);
  }

  const broad = new Set(BROAD_WORSHIP_ROOTS.map((r) => r.qid));
  const narrow = [...trees.worship, ...trees.parts].filter((c) => !broad.has(c));
  const batches = chunk(narrow, CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching the narrow worship classes (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const entity of await fetchClassPool(run.sparql, batches[i])) {
      if (!pool.has(entity.qid)) pool.set(entity.qid, entity);
    }
  }

  // The rows the source admits that no class question named — fallen below the
  // pool floor, or retyped by Wikidata — are asked for by id, so that every
  // admitted row gets a reason of its own rather than the sweep's silence.
  const missing = [...admitted].filter((qid) => !pool.has(qid));
  const missingBatches = chunk(missing, FACT_BATCH);
  for (let i = 0; i < missingBatches.length; i++) {
    run.phase(`Asking after admitted rows the pool did not name (batch ${i + 1}/${missingBatches.length})...`);
    await run.step();
    for (const entity of await fetchEntitiesByIds(run.sparql, missingBatches[i])) {
      pool.set(entity.qid, entity);
    }
  }
  return pool;
}

/**
 * What each candidate is: every `P31` it carries, in batches of 50.
 *
 * The rule reads a row's own classes and nothing else — a tower is a tower
 * whether a cathedral stands beside it or not (`WORSHIP_PART_CLASSES`) — so the
 * containers `fetchEntityFacts` also answers with are not read here.
 */
async function collectFacts(run: QueryRunner, qids: string[]): Promise<Map<string, EntityFacts>> {
  const facts = new Map<string, EntityFacts>();
  const batches = chunk(qids, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking what each candidate is (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const [qid, row] of await fetchEntityFacts(run.sparql, batches[i])) {
      facts.set(qid, row);
    }
  }
  return facts;
}

/**
 * Where a candidate that passed the rule stands against the fame line: in, out,
 * or — for a row the source admits that has fallen below the stay line —
 * refused by name, with its number. A candidate that was never in and is below
 * the line is simply out: a refusal names a rule, and none ran on it.
 */
function lineVerdict(
  entity: PoolEntity,
  admitted: ReadonlySet<string>,
  line: SourceLine,
): 'in' | 'out' | 'fell' {
  if (entity.sitelinks >= line.enterSitelinks) return 'in';
  if (!admitted.has(entity.qid)) return 'out';
  return entity.sitelinks >= line.staySitelinks ? 'in' : 'fell';
}

/**
 * The places this run would admit for their own fame, and every candidate the
 * rule refused with the reason it gave.
 *
 * `admitted` is what the source holds as admitted before the run, so the stay
 * line has something to hold. Candidates are judged most famous first, which is
 * the order the refusals are reported in.
 */
export async function collectPlacesByFame(
  run: QueryRunner,
  trees: WorshipTrees,
  admitted: ReadonlySet<string>,
  line: SourceLine,
): Promise<PlacesByFame> {
  const pool = await collectPool(run, trees, admitted);
  const facts = await collectFacts(run, [...pool.keys()]);
  const classesOf = new Map([...facts].map(([qid, row]) => [qid, row.classes]));

  const places = new Map<string, PlaceCandidate>();
  const filtered: FilteredEntity[] = [];
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  for (const entity of candidates) {
    const classes = classesOf.get(entity.qid) ?? [];
    const verdict = worshipVerdict({
      qid: entity.qid,
      classes,
      onEarth: entity.onEarth,
      lat: entity.lat,
      lon: entity.lon,
    }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const stands = lineVerdict(entity, admitted, line);
    if (stands === 'out') continue;
    if (stands === 'fell') {
      filtered.push({
        externalId: entity.qid,
        name: entity.label,
        reason: `${entity.sitelinks} sitelinks: below the world tier's line `
          + `(${line.enterSitelinks} to enter, ${line.staySitelinks} to stay)`,
      });
      continue;
    }
    places.set(entity.qid, { entity, classes, type: verdict.type });
  }
  return { places, filtered, classesOf };
}
