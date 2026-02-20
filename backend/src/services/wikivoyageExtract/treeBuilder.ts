/**
 * Recursive tree builder — uses fetcher + parser to build region hierarchy
 *
 * Ported from Python build_tree() + get_page_data().
 * Per-branch ancestor tracking (not global visited set) so the same region
 * can appear under multiple parents (e.g. Caucasus under both Asia and Europe).
 */

import type { TreeNode, PageData, ExtractionProgress, WikiSection } from './types.js';
import type { WikivoyageFetcher } from './fetcher.js';
import {
  findRegionsSection,
  parseRegionlist,
  parseBulletLinks,
  extractFileMapImage,
  extractImageCandidates,
} from './parser.js';

export const CONTINENTS = [
  'Africa', 'Antarctica', 'Asia', 'Europe',
  'North America', 'Oceania', 'South America',
];

/** Build a Wikivoyage page URL from a title */
function wikivoyageUrl(title: string): string {
  return `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

// ─── Page data fetching ─────────────────────────────────────────────────────

/**
 * Fetch and parse a single Wikivoyage page.
 * Returns structured page data including regions and map images.
 */
export async function getPageData(
  fetcher: WikivoyageFetcher,
  title: string,
): Promise<PageData> {
  // Step 1: Get sections
  const data = await fetcher.apiGet({
    action: 'parse', page: title, prop: 'sections', redirects: '1',
  }) as Record<string, unknown>;

  if ('error' in data) {
    return {
      resolved: title, exists: false, mapImage: null,
      mapImageCandidates: [], regions: [],
    };
  }

  const parseResult = data['parse'] as Record<string, unknown>;
  const resolved = (parseResult['title'] as string) ?? title;
  const sections = (parseResult['sections'] as WikiSection[]) ?? [];

  const result: PageData = {
    resolved,
    exists: true,
    mapImage: null,
    mapImageCandidates: [],
    regions: [],
  };

  if (sections.length === 0) return result;

  // Step 2: Parse Regions section
  const sectionIdx = findRegionsSection(sections);
  if (sectionIdx !== null) {
    const data2 = await fetcher.apiGet({
      action: 'parse', page: resolved, prop: 'wikitext',
      section: sectionIdx,
    }) as Record<string, unknown>;

    if (!('error' in data2)) {
      const parse2 = data2['parse'] as Record<string, unknown>;
      const wikitext = (parse2['wikitext'] as Record<string, string>)?.['*'] ?? '';

      if (wikitext) {
        if (wikitext.includes('{{Regionlist') || wikitext.includes('{{regionlist')) {
          const { mapImage, regions } = parseRegionlist(wikitext);
          result.mapImage = mapImage;
          result.mapImageCandidates = extractImageCandidates(wikitext);
          if (regions.length > 0) {
            result.regions = regions;
          }
        } else {
          // No Regionlist — try plain bullet links
          const links = parseBulletLinks(wikitext);
          result.regions = links.map((link) => ({
            name: link, items: [], hasLink: true,
          }));
        }
      }
    }
  }

  // Step 3: Fallback map image from full page wikitext
  if (!result.mapImage || result.mapImageCandidates.length === 0) {
    const dataFull = await fetcher.apiGet({
      action: 'parse', page: resolved, prop: 'wikitext',
    }) as Record<string, unknown>;

    if (!('error' in dataFull)) {
      const parseFull = dataFull['parse'] as Record<string, unknown>;
      const fullWt = (parseFull['wikitext'] as Record<string, string>)?.['*'] ?? '';

      if (fullWt) {
        if (!result.mapImage) {
          result.mapImage = extractFileMapImage(fullWt);
        }
        // Merge full-page candidates (section first, then full-page, deduplicated)
        const existing = new Set(result.mapImageCandidates);
        for (const url of extractImageCandidates(fullWt)) {
          if (!existing.has(url)) {
            result.mapImageCandidates.push(url);
            existing.add(url);
          }
        }
      }
    }
  }

  return result;
}

// ─── Tree building ──────────────────────────────────────────────────────────

/**
 * Build a region tree by recursively fetching Wikivoyage pages.
 *
 * Uses per-branch ancestor tracking so the same region can appear under
 * multiple parents. Cycles prevented by checking ancestors only.
 *
 * Returns TreeNode, 'self_ref', or 'missing'.
 */
export async function buildTree(
  fetcher: WikivoyageFetcher,
  title: string,
  maxDepth: number,
  progress: ExtractionProgress,
  currentDepth = 0,
  ancestors: Set<string> = new Set(),
): Promise<TreeNode | 'self_ref' | 'missing'> {
  if (progress.cancel) return 'missing';

  if (ancestors.has(title)) {
    return 'self_ref';
  }

  if (currentDepth >= maxDepth) {
    return { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  }

  // Update progress
  progress.regionsFetched++;
  progress.currentPage = title;
  if (progress.regionsFetched % 100 === 0) {
    const elapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(0);
    const rate = progress.regionsFetched / (Date.now() - progress.startedAt) * 1000;
    console.log(
      `[WV Extract] Progress: ${progress.regionsFetched} regions, ` +
      `${rate.toFixed(1)} regions/s, ${elapsed}s elapsed, ` +
      `API=${progress.apiRequests}, cache=${progress.cacheHits}`,
    );
  }

  const page = await getPageData(fetcher, title);
  const resolved = page.resolved;

  if (!page.exists) {
    return 'missing';
  }

  if (resolved !== title && ancestors.has(resolved)) {
    return 'self_ref';
  }

  const branchAncestors = new Set([...ancestors, title, resolved]);

  const node: TreeNode = { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  if (page.mapImage) {
    node.regionMapUrl = page.mapImage;
  }

  // Ensure regionMapUrl is always first in candidates
  const candidates = [...page.mapImageCandidates];
  if (page.mapImage) {
    const idx = candidates.indexOf(page.mapImage);
    if (idx > 0) {
      candidates.splice(idx, 1);
      candidates.unshift(page.mapImage);
    } else if (idx === -1) {
      candidates.unshift(page.mapImage);
    }
  }
  if (candidates.length > 0) {
    node.mapImageCandidates = candidates;
  }

  const childRegions = page.regions;

  if (childRegions.length === 0) {
    return node;
  }

  // Build children (sequential for safety; fetcher serializes anyway)
  for (const region of childRegions) {
    if (progress.cancel) break;

    if (region.hasLink) {
      const child = await buildTree(
        fetcher, region.name, maxDepth, progress,
        currentDepth + 1, branchAncestors,
      );
      const processed = processLinked(region.name, region.items, child, branchAncestors);
      if (processed) node.children.push(processed);
    } else {
      const grouping = await buildGroupingNode(
        fetcher, region.name, region.items, maxDepth, progress,
        currentDepth + 1, branchAncestors,
      );
      if (grouping) node.children.push(grouping);
    }
  }

  return node;
}

/** Process a linked child result */
function processLinked(
  name: string,
  _items: string[],
  childNode: TreeNode | 'self_ref' | 'missing',
  _ancestors: Set<string>,
): TreeNode | null {
  if (childNode === 'self_ref') {
    return { name, sourceUrl: wikivoyageUrl(name), children: [] };
  }
  if (childNode === 'missing') {
    return null;
  }
  return childNode;
}

/** Build a grouping node for a plain-text region name */
async function buildGroupingNode(
  fetcher: WikivoyageFetcher,
  name: string,
  items: string[],
  maxDepth: number,
  progress: ExtractionProgress,
  depth: number,
  ancestors: Set<string>,
): Promise<TreeNode | null> {
  const gnode: TreeNode = { name, children: [] };

  for (const itemName of items) {
    if (progress.cancel) break;

    const itemChild = await buildTree(
      fetcher, itemName, maxDepth, progress,
      depth, ancestors,
    );
    if (itemChild === 'self_ref') {
      gnode.children.push({ name: itemName, sourceUrl: wikivoyageUrl(itemName), children: [] });
    } else if (itemChild !== 'missing') {
      gnode.children.push(itemChild);
    }
  }

  return gnode.children.length > 0 ? gnode : null;
}

/** Count total nodes in a tree */
export function countNodes(node: TreeNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}
