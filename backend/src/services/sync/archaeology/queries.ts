/**
 * The three questions this kind asks that no other collector already asks.
 *
 * Everything else it needs is a question some other import already sends: the
 * pool of places and the facts about them are the public-art questions, generic
 * over `P31` (`publicArt/queries.ts`); the pool of works, the venue statements
 * and the venue graph are the museum's, through the shared works collector. What
 * is particular to a kind whose subject is both a building and what is inside it
 * is which classes make an archaeology museum, which of them are really parks,
 * and where an object in a case was dug up.
 *
 * Nothing here decides anything: what an archaeology museum is, is
 * `museumTest.ts` over the sets `classes.ts` composes, and what a find is, is
 * `finds.ts`. This file is the wiring.
 */

import { extractQid, isQid, LABEL_LANGS } from '../wikidataUtils.js';
import {
  chunk,
  fetchClassTree,
  values,
  type QueryRunner,
  type SparqlFn,
} from '../wikidataQueries.js';
import {
  fetchClassPool,
  fetchEntitiesByIds,
  standing,
  type PoolEntity,
} from '../publicArt/queries.js';
import {
  ARCHAEOLOGICAL_PARK,
  ARTEFACT_ROOT,
  MUSEUM_ROOTS,
  NATURAL_HISTORY_ROOT,
  SETTLEMENT_ROOT,
  SHIPWRECK_ROOT,
  SITE_ROOT,
  WORLD_HERITAGE_DESIGNATION,
  buildArchaeologyTrees,
  type ArchaeologyTrees,
} from './classes.js';
import type { FindFacts } from './finds.js';

const CLASS_BATCH = 25;
const ID_BATCH = 50;

/**
 * The seven class trees the rules read: what an archaeology museum is, which of
 * those classes are parks, what vetoes a museum, what was dug up, what an
 * archaeological site is, what a human settlement is, and what a shipwreck is.
 *
 * The last three are the site door's (#581 PR 2). Measured on 2026-09-14: 590
 * classes under `archaeological site`, 2,720 under `human settlement`, 4 under
 * `shipwreck` — all three cheap, because the traversal is in class space.
 *
 * A tree each rather than one walk, because each answers a different question
 * and two of them are subtractions from the others. The museum roots are walked
 * one after another and their answers concatenated: `egyptological museum` is a
 * subclass of `archaeological museum` and adds no branch the first walk does not
 * reach, and it is asked anyway as the floor under a closure that stops short.
 *
 * The park tree is walked for the same reason it is subtracted whole rather than
 * by its one QID: Wikidata files `archaeological park` under `archaeological
 * museum`, and a row typed only `Fudoki no oka` (Q11665453) — Japan's word for
 * an archaeological park with a museum on it, filed under the park — would
 * otherwise read as a museum. The park set is handed on rather than discarded,
 * since the museum door has a second signal and the rule has to be able to ask
 * whether a class is a park (`buildArchaeologyTrees`).
 *
 * The traversal is in class space, which is cheap; `classes.ts` carries the
 * measurements behind each root.
 */
export async function fetchArchaeologyTrees(run: QueryRunner): Promise<ArchaeologyTrees> {
  run.phase('Reading what an archaeology museum is...');
  const museum: string[] = [];
  for (const [root, label] of Object.entries(MUSEUM_ROOTS)) {
    await run.step();
    museum.push(...(await fetchClassTree(run.sparql, root, `${label} classes`)));
  }

  run.phase('Reading what an archaeological park is...');
  await run.step();
  const park = await fetchClassTree(run.sparql, ARCHAEOLOGICAL_PARK, 'archaeological park classes');

  run.phase('Reading what a natural history museum is...');
  await run.step();
  const naturalHistory = await fetchClassTree(
    run.sparql, NATURAL_HISTORY_ROOT, 'natural history museum classes',
  );

  run.phase('Reading what an archaeological artefact is...');
  await run.step();
  const artefact = await fetchClassTree(run.sparql, ARTEFACT_ROOT, 'archaeological artefact classes');

  run.phase('Reading what an archaeological site is...');
  await run.step();
  const site = await fetchClassTree(run.sparql, SITE_ROOT, 'archaeological site classes');

  run.phase('Reading what a human settlement is...');
  await run.step();
  const settlement = await fetchClassTree(run.sparql, SETTLEMENT_ROOT, 'human settlement classes');

  run.phase('Reading what a shipwreck is...');
  await run.step();
  const shipwreck = await fetchClassTree(run.sparql, SHIPWRECK_ROOT, 'shipwreck classes');

  return buildArchaeologyTrees({
    museum,
    park: [...park],
    naturalHistory: [...naturalHistory],
    artefact: [...artefact],
    site: [...site],
    settlement: [...settlement],
    shipwreck: [...shipwreck],
  });
}

/**
 * What each work of a batch is, and where it was dug up: every `P31`, and the
 * discovery place (`P189`) with the name a reader would see.
 *
 * One question per call, by UNION so the two facts do not cross-multiply, and
 * one call per batch: the caller chunks, because it is the caller that paces the
 * run and reports its phases (`workFacts` in the works collector). Every QID
 * asked about gets an entry, empty where the answer said nothing — a rule
 * reading a missing entry as "no facts" would be reading a failed batch as a
 * statement about the world.
 *
 * The discovery place is read as a statement that still holds (`standing`,
 * shared with the public-art facts): best-ranked and carrying no end time. It is
 * single-valued here where the classes are a list, because it is one place on
 * the card: the first best-ranked statement that still holds is taken, and a
 * find whose item names two places it was found at is a question for a curator,
 * not for a batch of fifty.
 *
 * A label that is itself a QID is kept, where the makers' parse drops one
 * (`addCreator`): the label service answering with the bare id means only that
 * the place has no name in the eight languages, and a place with no name is
 * still where the thing was found. What a reader is shown then is the id, which
 * is honest; dropping it would say the find was never dug up anywhere.
 */
export async function fetchFindFacts(
  sparql: SparqlFn,
  qids: string[],
): Promise<Map<string, FindFacts>> {
  const out = new Map<string, FindFacts>();
  if (!qids.length) return out;
  for (const qid of qids) out.set(qid, { classes: [], discoveryPlace: null });

  const rows = await sparql(`
    SELECT ?w ?cls ?disc ?discLabel WHERE {
      VALUES ?w { ${values(qids)} }
      { ?w wdt:P31 ?cls } UNION {
        ${standing('?w', 'P189', '?disc')}
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
    }`, { kind: 'edges', label: `classes and discovery places of ${qids.length} finds` });

  for (const row of rows) {
    const facts = out.get(extractQid(row.w?.value ?? ''));
    if (!facts) continue;
    const cls = extractQid(row.cls?.value ?? '');
    if (isQid(cls)) facts.classes.push(cls);
    const disc = extractQid(row.disc?.value ?? '');
    if (isQid(disc) && !facts.discoveryPlace) {
      facts.discoveryPlace = { qid: disc, label: row.discLabel?.value || disc };
    }
  }
  return out;
}

/**
 * Every entity the museum classes name, at the pool's floor or above, once.
 *
 * The worship pool's shape without its fame bands, because this tree needs none:
 * the whole museum closure answers with 87 museums at the pool floor — 14 at 40
 * sitelinks or more, 30 between 22 and 39, 43 between 15 and 21, measured on
 * 2026-09-13 (`docs/sources/global/wikidata-archaeology.md`) — where `monument`
 * alone has tens of thousands and has to be asked a band at a time. So the
 * classes are asked in batches, each taken whole.
 *
 * The class is only one of the two signals this kind's door reads, and it is
 * silent about most of the canon — the British Museum carries no archaeological
 * class at all. What the other signal admits is the pipeline's business: the
 * museums the finds name are looked up beside this pool, and the categories are
 * read of both. This function answers only "which museums does the class say so
 * about".
 *
 * The rows the source already admits that no class question named — retyped by
 * Wikidata, or fallen below the floor — are asked for by id afterwards, so that
 * each gets a refusal with a reason of its own rather than the sweep's silence.
 */
export async function collectMuseumPool(
  run: QueryRunner,
  trees: ArchaeologyTrees,
  admitted: ReadonlySet<string>,
): Promise<Map<string, PoolEntity>> {
  const pool = new Map<string, PoolEntity>();
  const batches = chunk([...trees.museum], CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching the archaeology museum classes (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const entity of await fetchClassPool(run.sparql, batches[i])) {
      if (!pool.has(entity.qid)) pool.set(entity.qid, entity);
    }
  }

  const missing = [...admitted].filter((qid) => !pool.has(qid));
  const missingBatches = chunk(missing, ID_BATCH);
  for (let i = 0; i < missingBatches.length; i++) {
    run.phase(`Asking after admitted rows the pool did not name (batch ${i + 1}/${missingBatches.length})...`);
    await run.step();
    for (const entity of await fetchEntitiesByIds(run.sparql, missingBatches[i])) {
      pool.set(entity.qid, entity);
    }
  }
  return pool;
}

/** What the site rule reads off the item itself. */
export interface SiteFactsRow {
  /** Every `P31`. */
  classes: string[];
  /** `P757` present, or `P1435` naming World Heritage: the place is one itself. */
  worldHeritage: boolean;
  /** `P1082` present — any number, 0 included. */
  statesPopulation: boolean;
}

/**
 * What each candidate of a batch is, and the two facts the living-place dispute
 * turns on.
 *
 * One question per batch by UNION, so the four do not cross-multiply — an item
 * with nine population statements (Asyut has nine) would otherwise arrive nine
 * times over every class it carries. Every QID asked about gets an entry, empty
 * where the answer said nothing: a rule reading a missing entry as "no facts"
 * would be reading a failed batch as a statement about the world.
 *
 * The statements are read at `wdt:` rather than through `standing`, and
 * deliberately: the question is not "what is true today" but "has anybody ever
 * said this place holds people" — a population statement from 1950 still tells
 * Asyut from Saqqara, and `P757` on a delisted site still says the Committee
 * once inscribed it.
 */
export async function fetchSiteFacts(
  sparql: SparqlFn,
  qids: string[],
): Promise<Map<string, SiteFactsRow>> {
  const out = new Map<string, SiteFactsRow>();
  const asked = qids.filter(isQid);
  if (!asked.length) return out;
  for (const qid of asked) {
    out.set(qid, { classes: [], worldHeritage: false, statesPopulation: false });
  }

  const rows = await sparql(`
    SELECT ?e ?cls ?whc ?desig ?pop WHERE {
      VALUES ?e { ${values(asked)} }
      { ?e wdt:P31 ?cls } UNION { ?e wdt:P757 ?whc } UNION
      { ?e wdt:P1435 ?desig } UNION { ?e wdt:P1082 ?pop }
    }`, { kind: 'edges', label: `classes, listings and populations of ${asked.length} sites` });

  for (const row of rows) {
    const facts = out.get(extractQid(row.e?.value ?? ''));
    if (!facts) continue;
    const cls = extractQid(row.cls?.value ?? '');
    if (isQid(cls)) facts.classes.push(cls);
    if (row.whc?.value) facts.worldHeritage = true;
    if (extractQid(row.desig?.value ?? '') === WORLD_HERITAGE_DESIGNATION) {
      facts.worldHeritage = true;
    }
    if (row.pop?.value) facts.statesPopulation = true;
  }
  return out;
}
