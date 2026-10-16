/**
 * The dialog's groups as it holds them (`SubdivisionGroup`, with the members
 * themselves) and as the database keeps them (#595: each member by its row).
 * Also the groups an earlier session left in this browser's saved state,
 * adopted once into a database that has none and then forgotten here.
 */

import type { RegionMember, RegionSubdivisionGroups, RegionSubdivisionGroupsBody } from '../../../../../api/regions';
import { STORAGE_KEY_PREFIX } from './overlayStorage';
import type { SubdivisionGroup } from './types';

/** The groups the database holds, each member found among the region's division members by its row. */
export function groupsFromDb(stored: RegionSubdivisionGroups, divisionMembers: RegionMember[]): SubdivisionGroup[] {
  const byRow = new Map(divisionMembers.filter(m => m.memberRowId !== undefined).map(m => [m.memberRowId!, m]));
  return stored.groups.map(group => ({
    name: group.name,
    members: group.memberRowIds.map(id => byRow.get(id)).filter((m): m is RegionMember => m !== undefined),
    ...(group.existingRegionId !== null ? { existingRegionId: group.existingRegionId } : {}),
    ...(group.color !== null ? { color: group.color } : {}),
  }));
}

/** What the database keeps for the dialog's groups: their order, names, colours, child regions and member rows. */
export function groupsBodyOf(groups: SubdivisionGroup[]): RegionSubdivisionGroupsBody {
  return {
    groups: groups.map(group => ({
      name: group.name.trim() || 'Unnamed group',
      color: group.color ?? null,
      existingRegionId: group.existingRegionId ?? null,
      memberRowIds: group.members.flatMap(m => (m.memberRowId !== undefined ? [m.memberRowId] : [])),
    })),
  };
}

/** The division members no group holds. */
export function unassignedAmong(divisionMembers: RegionMember[], groups: SubdivisionGroup[]): RegionMember[] {
  const assigned = new Set(groups.flatMap(g => g.members.map(m => m.memberRowId)));
  return divisionMembers.filter(m => !assigned.has(m.memberRowId));
}

/** The browser's saved entry for a region, parsed; null where there is none or it cannot be read. */
function entryOf(regionId: number): Record<string, unknown> | null {
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_KEY_PREFIX}${regionId}`) ?? 'null') as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** The groups an earlier session saved in this browser for the region, if it saved any. */
export function legacyGroups(regionId: number): SubdivisionGroup[] | null {
  const groups = entryOf(regionId)?.subdivisionGroups;
  return Array.isArray(groups) && groups.length > 0 ? (groups as SubdivisionGroup[]) : null;
}

/**
 * The browser's copy of the groups and the members they left unassigned, as the
 * entry holds them, for a rewrite of the entry to carry forward untouched: only
 * `forgetLegacyGroups` removes them, once the database holds them.
 */
export function carriedGroups(regionId: number): { subdivisionGroups?: unknown; unassignedDivisions?: unknown } {
  const entry = entryOf(regionId);
  return {
    ...(entry && 'subdivisionGroups' in entry ? { subdivisionGroups: entry.subdivisionGroups } : {}),
    ...(entry && 'unassignedDivisions' in entry ? { unassignedDivisions: entry.unassignedDivisions } : {}),
  };
}

/** Forget the browser's copy of the groups and the members they left unassigned; the rest of the entry stays. */
export function forgetLegacyGroups(regionId: number): void {
  const entry = entryOf(regionId);
  if (!entry || !('subdivisionGroups' in entry || 'unassignedDivisions' in entry)) return;
  const rest = { ...entry };
  delete rest.subdivisionGroups;
  delete rest.unassignedDivisions;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${regionId}`, JSON.stringify(rest));
  } catch {
    // Storage refused: the database already holds the groups, which loses nothing.
  }
}
