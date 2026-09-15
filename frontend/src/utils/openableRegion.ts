/**
 * Where a place another surface names can be opened from here, or null when it
 * cannot be opened from here at all.
 *
 * The rule is ADR-0042's, decided for the search and shared since by every link
 * from one card to another (#894): a link opens the object only where the world
 * view already open places it, at the smallest region that holds it. The
 * regions arrive most specific first — the search read's list, and the finds'
 * and the find spot's (`readerRegionsJsonSql`) — so the first one in the
 * reader's own world view is the smallest place: Noord-Holland rather than
 * Europe. The default world view is never a match: it owns no regions, its map
 * is the administrative tree, and an address under it names no region.
 */

import type { ExperienceRegionRef } from '../api/experiences';

export function openableRegion(
  regions: ExperienceRegionRef[],
  worldViewId: number | null,
): ExperienceRegionRef | null {
  if (worldViewId === null) return null;
  return regions.find((region) => region.world_view_id === worldViewId) ?? null;
}
