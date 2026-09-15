/**
 * The site pool's second entrance (#895, ADR-0060): what OpenStreetMap tags
 * as a dig or as ruins, counted, fetched at the floor, and given the one vote
 * a living place it named can still get.
 *
 * Split out of `sites.ts` at the entrance's own seam, the way `siteClasses.ts`
 * left `classes.ts`: that file is the pool, the facts, the one OSM read and
 * the verdict loop, and this is how a candidate the class tree never named
 * reaches the same pool. Nothing here decides anything — `siteTest.ts` does —
 * and the two files share the pool map and nothing else.
 */

import { chunk, type QueryRunner } from '../wikidataQueries.js';
import { fetchEntitiesByIds, POOL_MIN_SITELINKS, type PoolEntity } from '../publicArt/queries.js';
import { fetchSitelinksByIds, SITELINKS_BATCH, type SiteFactsRow } from './queries.js';
import { SITE_CATEGORY, type ArchaeologyTrees } from './classes.js';
import type { OsmDigs, OsmObject } from '../osm/types.js';
import { enwikiTitleOf } from '../wikipediaCategories.js';
import { lineStanding, type SourceLine } from '../sourceLine.js';

const FACT_BATCH = 50;

/**
 * The pool's second entrance (#895, ADR-0060): what OpenStreetMap tags as a
 * dig or as ruins, resolved to items, and the one vote a living place it
 * named can still get. Three functions rather than clients, for the reason
 * `OsmReader` is one: this module neither knows how any of them is asked nor
 * needs them asked at all in a test.
 */
export interface SiteEntrance {
  /** Every object tagged as a dig or as ruins, by item and by article (`readOsmDigs`). */
  digs: (run: Pick<QueryRunner, 'phase' | 'step'>) => Promise<OsmDigs>;
  /** `lang:Title` → the item the article is about (`resolveWikipediaArticles`). */
  resolveArticles: (tags: string[]) => Promise<Map<string, string>>;
  /** English Wikipedia's categories for a batch of article titles (`fetchWikipediaCategories`). */
  categories: (titles: string[]) => Promise<Map<string, string[]>>;
}

/**
 * The second entrance (#895, ADR-0060): every item an OpenStreetMap object
 * tagged as a dig or as ruins carries, asked for once, counted, and — only
 * at the pool's floor — fetched like any other candidate.
 *
 * **The count is asked before the row.** 40,572 items the map named on dry
 * run 136 (2026-09-15), 39,587 of them in no class under the tree, 601 at the
 * pool's floor (`POOL_MIN_SITELINKS`, 15 — below the place line, so that an
 * admitted row that slipped under it still arrives to be refused by name): a
 * sitelinks question five hundred at a time is eighty cheap questions, where
 * the pool's own question of all of them would be some eight hundred
 * expensive ones. What the class pool
 * already named is not asked again — Troy comes in by class and the tag on
 * its excavation adds nothing — and an admitted row is fetched whatever its
 * count, so that a row this entrance let in and the count has since dropped
 * gets a refusal with its number rather than the sweep's silence.
 *
 * An object carrying an article and no item (Nemrut's tumulus, `tr:Nemrut
 * Dağı`) is resolved through that wiki first, and its objects are then the
 * item's. What the map said about each item — the objects that named it — is
 * handed on (`named`), because the per-item read asks by the `wikidata` tag
 * and never sees an object that carried only the article.
 */
export async function collectOsmEntrance(
  run: QueryRunner,
  pool: Map<string, PoolEntity>,
  admitted: ReadonlySet<string>,
  entrance: SiteEntrance,
): Promise<{ byOsm: Set<string>; named: Map<string, OsmObject[]>; byArticleOnly: Set<string> }> {
  const digs = await entrance.digs(run);
  const named = new Map<string, OsmObject[]>(digs.byItem);
  // The items only an article reached: no dig carries their `wikidata` tag,
  // though another object may (Nemrut's peak node does, its tumulus carries
  // the article), so the per-item read may or may not answer about them and
  // the answer floor counts them on neither side.
  const byArticleOnly = new Set<string>();
  const articles = [...digs.byArticle.keys()];
  if (articles.length > 0) {
    run.phase(`Asking the Wikipedias which item ${articles.length} tagged articles are about...`);
    await run.step();
    const resolved = await entrance.resolveArticles(articles);
    for (const [article, objects] of digs.byArticle) {
      const qid = resolved.get(article);
      if (!qid) continue;
      if (!digs.byItem.has(qid)) byArticleOnly.add(qid);
      named.set(qid, [...(named.get(qid) ?? []), ...objects]);
    }
  }

  const unnamed = [...named.keys()].filter((qid) => !pool.has(qid));
  const batches = chunk(unnamed, SITELINKS_BATCH);
  const sitelinks = new Map<string, number>();
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking Wikidata how many articles each dig OpenStreetMap maps has (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const [qid, count] of await fetchSitelinksByIds(run.sparql, batches[i])) sitelinks.set(qid, count);
  }

  const wanted = unnamed.filter((qid) => admitted.has(qid) || (sitelinks.get(qid) ?? 0) >= POOL_MIN_SITELINKS);
  const byOsm = new Set<string>();
  const wantedBatches = chunk(wanted, FACT_BATCH);
  for (let i = 0; i < wantedBatches.length; i++) {
    run.phase(`Fetching the digs OpenStreetMap maps that Wikidata knows by name (batch ${i + 1}/${wantedBatches.length})...`);
    await run.step();
    for (const entity of await fetchEntitiesByIds(run.sparql, wantedBatches[i], 'digs OpenStreetMap maps')) {
      pool.set(entity.qid, entity);
      byOsm.add(entity.qid);
    }
  }
  console.log(
    `[Archaeology Sync] OpenStreetMap names ${named.size} items as digs or ruins; `
    + `${unnamed.length} the classes did not, ${wanted.length} of those at the pool's floor`,
  );
  return { byOsm, named, byArticleOnly };
}

/**
 * The item's own objects, and the ones that named it: an object both reads
 * carry is one object, with the tags of both (the per-item read's first —
 * it carries the geometry), and one only the enumeration carried — the tumulus
 * that names Nemrut by its article — is listed after the item's own.
 */
export function withNamed(mapped: OsmObject[], named: OsmObject[]): OsmObject[] {
  const out = mapped.map((object) => ({ ...object, tags: { ...object.tags } }));
  for (const object of named) {
    const held = out.find((o) => o.ref === object.ref);
    if (!held) {
      out.push(object);
      continue;
    }
    for (const [key, value] of Object.entries(object.tags)) held.tags[key] ??= value;
  }
  return out;
}

/**
 * English Wikipedia's second vote (#895, ADR-0060 decision 3), asked only
 * where it can change the answer: a row the map named and no class vouches
 * for, that states a population, is not World Heritage itself, has an
 * English article, and stands where the line would name its refusal. A
 * handful of titles a run — the categories of the article, never a walk —
 * against the eighteen comuni and the Jerash that share the shape.
 */
export async function categoryVotes(
  run: QueryRunner,
  candidates: PoolEntity[],
  facts: ReadonlyMap<string, SiteFactsRow>,
  trees: ArchaeologyTrees,
  named: ReadonlyMap<string, OsmObject[]>,
  line: SourceLine,
  admitted: ReadonlySet<string>,
  entrance: SiteEntrance,
): Promise<Set<string>> {
  const titles = new Map<string, string>();
  for (const entity of candidates) {
    // The map names it — whichever question named it first: a class-pool
    // row whose classes vanished is judged by the map's word too (`sites.ts`),
    // and gets the same vote.
    if ((named.get(entity.qid)?.length ?? 0) === 0) continue;
    const row = facts.get(entity.qid);
    if (!row || !row.statesPopulation || row.worldHeritage) continue;
    if (row.classes.some((cls) => trees.site.has(cls))) continue;
    if (lineStanding(entity.sitelinks, admitted.has(entity.qid), line) === 'out') continue;
    const title = enwikiTitleOf(entity.articleUrl);
    if (title) titles.set(entity.qid, title);
  }
  const voted = new Set<string>();
  if (titles.size === 0) return voted;
  run.phase(`Reading what English Wikipedia files ${titles.size} living places the map calls digs under...`);
  await run.step();
  const categories = await entrance.categories([...new Set(titles.values())]);
  for (const [qid, title] of titles) {
    if ((categories.get(title) ?? []).some((category) => SITE_CATEGORY.test(category))) voted.add(qid);
  }
  return voted;
}
