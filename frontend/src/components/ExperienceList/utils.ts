/**
 * Shared constants and helpers for the ExperienceList components.
 */

import type { Experience, ExperienceLocation, VisitedStatus } from '../../api/experiences';

export const OUT_OF_REGION_INITIAL = 3;
export const ARTWORKS_INITIAL_LIMIT = 10;

export function resolveRowBgColor(isHovered: boolean, isSelected: boolean): string {
  if (isHovered) return 'action.hover';
  if (isSelected) return 'primary.50';
  return 'transparent';
}

export function resolveLocationColor(isLocationHovered: boolean, isVisited: boolean): string {
  if (isLocationHovered) return 'primary.main';
  if (isVisited) return 'text.secondary';
  return 'text.primary';
}

export function computeVisitedStatus(visitedLocations: number, totalLocations: number): VisitedStatus {
  if (visitedLocations === 0) return 'not_visited';
  if (visitedLocations >= totalLocations) return 'visited';
  return 'partial';
}

/**
 * The hovered location id, but only for the row that owns it.
 *
 * The list holds one hovered-location id for the whole region, and every row
 * reads it. Passed through unchanged it would differ on every row whenever any
 * location anywhere is hovered, which invalidates the memo on all of them at
 * once — the rows that do not own the location have nothing to draw with it
 * anyway, so they get null and stay put.
 */
export function ownedHoveredLocationId(
  locations: ExperienceLocation[] | undefined,
  hoveredLocationId: number | null,
): number | null {
  if (hoveredLocationId === null || !locations) return null;
  return locations.some(loc => loc.id === hoveredLocationId) ? hoveredLocationId : null;
}

/** "3 here no longer exist — show them", with the singular English wants. */
export function lostHiddenLabel(count: number): string {
  const verb = count === 1 ? 'exists' : 'exist';
  const them = count === 1 ? 'it' : 'them';
  return `${count} here no longer ${verb} — show ${them}`;
}

/**
 * One entry of the windowed list: a category heading, or one experience under it.
 *
 * The list reads as groups and renders as a sequence, because a virtualiser counts
 * rows and a group is not a row.
 */
export type FlatRow =
  | { kind: 'header'; group: ExperienceGroupLike }
  | { kind: 'experience'; exp: Experience };

/** Only what flattening needs, so the caller's fuller group type still fits. */
export interface ExperienceGroupLike {
  categoryName: string;
  experiences: Experience[];
}

/**
 * Groups and their open experiences as one sequence, headers included.
 *
 * A collapsed group contributes its header alone — which is what `unmountOnExit`
 * used to do, arrived at differently. The order is the groups' own: the reader's
 * sequence must not change because the rows are now windowed.
 */
export function flattenGroups(
  groups: ExperienceGroupLike[],
  expandedGroups: Set<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const group of groups) {
    rows.push({ kind: 'header', group });
    if (expandedGroups.has(group.categoryName)) {
      for (const exp of group.experiences) rows.push({ kind: 'experience', exp });
    }
  }
  return rows;
}

/**
 * Where each experience sits in the flat list.
 *
 * The two scroll effects need this because windowing means the row a map marker
 * points at usually has no element: `itemRefs` holds nothing for it, so the
 * virtualiser has to be asked for an index instead.
 */
export function rowIndexByExperienceId(rows: FlatRow[]): Map<number, number> {
  const m = new Map<number, number>();
  rows.forEach((row, i) => { if (row.kind === 'experience') m.set(row.exp.id, i); });
  return m;
}

/**
 * The experiences among a set of windowed row indices.
 *
 * What makes a New-badge impression honest once the rows are windowed: the server
 * keeps the *first* impression, so reporting a row the reader never scrolled to
 * spends their personal window on it unseen.
 */
export function experienceIdsAtIndices(rows: FlatRow[], indices: number[]): number[] {
  const ids: number[] = [];
  for (const i of indices) {
    const row = rows[i];
    if (row?.kind === 'experience') ids.push(row.exp.id);
  }
  return ids;
}

/**
 * The experiences the viewport actually intersects.
 *
 * Not the same set as the mounted rows: the virtualiser mounts `overscan` rows on
 * either side of the viewport deliberately, and those are below the fold. Counting
 * them as seen would be the smaller version of the mistake windowing exists to
 * fix — a reader who opens a region and never scrolls would spend a week's mark on
 * rows they never reached. `virtualizer.range` is that pre-overscan range.
 */
export function experienceIdsInVisibleRange(
  rows: FlatRow[],
  range: { startIndex: number; endIndex: number } | null,
): number[] {
  if (!range) return [];
  const indices: number[] = [];
  for (let i = range.startIndex; i <= range.endIndex; i++) indices.push(i);
  return experienceIdsAtIndices(rows, indices);
}
