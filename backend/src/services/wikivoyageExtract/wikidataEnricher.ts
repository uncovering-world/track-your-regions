/**
 * Wikidata ID enrichment — batch-fetch Wikidata IDs for tree nodes
 *
 * Ported from Python fetch_wikidata_ids() + enrich_wikidata_ids().
 * Uses action=query&prop=pageprops&ppprop=wikibase_item with up to
 * 50 titles per request (MediaWiki API limit).
 */

import type { TreeNode, ExtractionProgress } from './types.js';
import type { WikivoyageFetcher } from './fetcher.js';

const BATCH_SIZE = 50;

/** Collect all unique page names from the tree */
export function collectPageTitles(node: TreeNode): Set<string> {
  const titles = new Set<string>();
  titles.add(node.name);
  for (const child of node.children) {
    for (const title of collectPageTitles(child)) {
      titles.add(title);
    }
  }
  return titles;
}

/** Build a redirect+normalization map (from → to) from the API response. */
function buildRedirectMap(query: Record<string, unknown>): Map<string, string> {
  const redirectMap = new Map<string, string>();
  for (const redir of (query['redirects'] ?? []) as Array<{ from: string; to: string }>) {
    redirectMap.set(redir.from, redir.to);
  }
  for (const norm of (query['normalized'] ?? []) as Array<{ from: string; to: string }>) {
    redirectMap.set(norm.from, norm.to);
  }
  return redirectMap;
}

/** Follow the redirect chain for a single title, capped at 5 hops. */
function resolveTitle(title: string, redirectMap: Map<string, string>): string {
  let chain = title;
  for (let hop = 0; hop < 5; hop++) {
    const next = redirectMap.get(chain);
    if (!next) break;
    chain = next;
  }
  return chain;
}

/** Map each resolved title back to the original batch title. */
function buildResolvedToOriginal(batch: string[], redirectMap: Map<string, string>): Map<string, string> {
  const resolvedToOriginal = new Map<string, string>();
  for (const title of batch) {
    resolvedToOriginal.set(resolveTitle(title, redirectMap), title);
  }
  return resolvedToOriginal;
}

/** Collect wikidata IDs from the API page map into result, keyed by original batch title. */
function collectWikidataIds(
  pages: Record<string, { title?: string; pageprops?: { wikibase_item?: string } }>,
  resolvedToOriginal: Map<string, string>,
  result: Map<string, string>,
): void {
  for (const page of Object.values(pages)) {
    const pageTitle = page.title ?? '';
    const wikidataId = page.pageprops?.wikibase_item;
    if (wikidataId) {
      const original = resolvedToOriginal.get(pageTitle) ?? pageTitle;
      result.set(original, wikidataId);
    }
  }
}

/**
 * Process a single batch of titles, adding discovered Wikidata IDs to result.
 */
async function processBatch(
  fetcher: WikivoyageFetcher,
  batch: string[],
  result: Map<string, string>,
): Promise<void> {
  const data = await fetcher.apiGet({
    action: 'query',
    titles: batch.join('|'),
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    redirects: '1',
  }) as Record<string, unknown>;

  if ('error' in data || !('query' in data)) return;

  const query = data['query'] as Record<string, unknown>;
  const redirectMap = buildRedirectMap(query);
  const resolvedToOriginal = buildResolvedToOriginal(batch, redirectMap);
  const pages = (query['pages'] ?? {}) as Record<
    string,
    { title?: string; pageprops?: { wikibase_item?: string } }
  >;
  collectWikidataIds(pages, resolvedToOriginal, result);
}

/**
 * Batch-query Wikidata IDs for a set of page titles.
 * Returns a map of page title → Wikidata ID (e.g. "Bavaria" → "Q980").
 */
export async function fetchWikidataIds(
  fetcher: WikivoyageFetcher,
  titles: Set<string>,
  progress: ExtractionProgress,
): Promise<Map<string, string>> {
  const titleList = [...titles].sort();
  const result = new Map<string, string>();

  for (let i = 0; i < titleList.length; i += BATCH_SIZE) {
    if (progress.cancel) break;

    const batch = titleList.slice(i, i + BATCH_SIZE);
    await processBatch(fetcher, batch, result);

    if ((i + BATCH_SIZE) % 500 < BATCH_SIZE) {
      console.log(
        `[WV Enrich] Wikidata IDs: ${i + batch.length}/${titleList.length} titles queried, ${result.size} found`,
      );
    }
  }

  return result;
}

/** Add wikidataId to each node in the tree from the lookup map */
export function enrichWikidataIds(node: TreeNode, wikidataMap: Map<string, string>): void {
  const wid = wikidataMap.get(node.name);
  if (wid) {
    node.wikidataId = wid;
  }
  for (const child of node.children) {
    enrichWikidataIds(child, wikidataMap);
  }
}
