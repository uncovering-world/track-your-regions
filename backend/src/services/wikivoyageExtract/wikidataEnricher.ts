/**
 * Wikidata ID enrichment — the Wikidata ID of each tree node's page
 *
 * Ported from Python fetch_wikidata_ids() + enrich_wikidata_ids(). The item
 * is the one the page's properties name in English Wikivoyage's copy
 * (`pageCopy.ts`), through the page's redirects.
 */

import type { TreeNode } from './types.js';

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
