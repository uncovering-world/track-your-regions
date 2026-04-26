/**
 * Shared constants and helpers for the ExperienceList components.
 */

import type { VisitedStatus } from '../../api/experiences';

export const NEW_BADGE_DAYS = 7;
export const OUT_OF_REGION_INITIAL = 3;
export const ARTWORKS_INITIAL_LIMIT = 10;

export function isNewExperience(createdAt?: string): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - NEW_BADGE_DAYS);
  return created > cutoff;
}

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
