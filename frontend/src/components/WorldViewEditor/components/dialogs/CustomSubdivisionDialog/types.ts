import type { RegionMember } from '../../../../../types';

export interface SubdivisionGroup {
  name: string;
  members: RegionMember[];
}

export type MapTool = 'assign' | 'split' | 'cut';

export const GROUP_COLORS = [
  '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
  '#ffff33', '#a65628', '#f781bf', '#999999', '#66c2a5',
];
