/**
 * Shared constants and helpers for the ExperienceList components.
 */

import type { ExperienceLocation, VisitedStatus } from '../../api/experiences';

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
