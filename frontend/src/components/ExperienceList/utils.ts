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

/**
 * "3 in this region no longer exist — show them", with the singular English wants.
 *
 * "In this region", not "here": the count is the region's, from the same read
 * that fetched the rows, while the list beside it answers about the map's view
 * (#553). Said as "here" it promised rows the view then filtered out — a reader
 * zoomed into Prague clicking it for three lost objects in Rome saw nothing
 * appear. The way to them is the other notice, which now counts them too.
 */
export function lostHiddenLabel(count: number): string {
  const verb = count === 1 ? 'exists' : 'exist';
  const them = count === 1 ? 'it' : 'them';
  return `${count} in this region no longer ${verb} — show ${them}`;
}

/**
 * "12 more in this region — show them all", the way back from a filtered list (#553).
 *
 * The count is what the view is hiding, not what it holds: a reader who has
 * panned away from every object sees an empty list, and without a number saying
 * the region still has 47 of them that reads as "this region is empty" — which
 * contradicts the whole-region promise the product makes.
 */
export function outsideViewLabel(count: number): string {
  // Not `plural()`: "more" is invariant, and the helper would render "12 mores".
  // The singular is the only form an eye checks, which is how that got through.
  return `${count} more in this region — show ${count === 1 ? 'it' : 'them all'}`;
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
 * Every movement of the list needs it — they live in `useListScrollAnchor` —
 * because windowing means the row a map marker points at usually has no element:
 * `itemRefs` holds nothing for it, so the virtualiser has to be asked for an
 * index instead. Three of the four read it through a ref rather than as a
 * dependency; the re-aim after a click is the one that depends on it, and gates
 * itself on that click's flight so a group toggled does not reach it.
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
