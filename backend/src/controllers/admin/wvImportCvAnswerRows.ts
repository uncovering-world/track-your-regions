/**
 * The map matching's answers, from what a model returns to what
 * `api/responses/wvImportCvMatch.ts` declares (ADR-0066): key by key, so a
 * model's own words — a key it adds, a cluster nobody asked about, a region
 * name that is not a child region — stay on the server.
 */

import type { ChildRegionRef, ClusterRegionMatch } from '../../api/responses/wvImportCvMatch.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The model's list, wherever its JSON put it: bare, under `matches` or under `result`. */
function listOf(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];
  const list = parsed.matches ?? parsed.result;
  return Array.isArray(list) ? list : [];
}

/**
 * Which child region each asked-about cluster is, as the model answered it.
 * A cluster is answered once, first answer kept; a region name is matched to a
 * child region case-insensitively and answered with that region's own name,
 * and a child region already given to one cluster is given to no other.
 */
export function clusterRegionMatchesOf(
  content: string,
  askedClusterIds: ReadonlySet<number>,
  childRegions: readonly ChildRegionRef[],
): ClusterRegionMatch[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const regionByName = new Map(childRegions.map(r => [r.name.toLowerCase(), r]));
  const answeredClusters = new Set<number>();
  const usedRegionIds = new Set<number>();
  const matches: ClusterRegionMatch[] = [];
  for (const entry of listOf(parsed)) {
    if (!isRecord(entry)) continue;
    const { clusterId, regionName } = entry;
    if (typeof clusterId !== 'number' || !askedClusterIds.has(clusterId) || answeredClusters.has(clusterId)) continue;
    answeredClusters.add(clusterId);

    const region = typeof regionName === 'string' ? regionByName.get(regionName.toLowerCase()) : undefined;
    if (!region || usedRegionIds.has(region.id)) {
      if (region) console.log(`  [AI Suggest Clusters] Dedup: cluster ${clusterId} tried to use already-assigned region "${region.name}" → null`);
      matches.push({ clusterId, regionId: null, regionName: null });
      continue;
    }
    usedRegionIds.add(region.id);
    matches.push({ clusterId, regionId: region.id, regionName: region.name });
  }
  return matches;
}
