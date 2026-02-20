import type { RegionMember } from '../../../../../types';

export interface SubdivisionGroup {
  name: string;
  members: RegionMember[];
  /** When set, this group maps to an existing child region (skip create, move members there) */
  existingRegionId?: number;
  /** Custom color picked via eyedropper from reference image */
  color?: string;
}

export type MapTool = 'assign' | 'split' | 'cut' | 'moveToParent';

export const GROUP_COLORS = [
  '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
  '#ffff33', '#a65628', '#f781bf', '#999999', '#66c2a5',
];

/** Returns the group's custom color or falls back to the palette */
export function getGroupColor(group: SubdivisionGroup, idx: number): string {
  return group.color ?? GROUP_COLORS[idx % GROUP_COLORS.length];
}
