import type { WorldView, RegionMember } from '../../types';

// Display mode for hull visualization
export type DisplayMode = 'real' | 'hull';

// Subregion tree node for hierarchical selection
export interface SubregionNode {
  id: number;
  name: string;
  hasSubregions: boolean;
  selected: boolean;
  expanded: boolean;
  children: SubregionNode[];
  loaded: boolean;
}

export interface WorldViewEditorProps {
  open: boolean;
  onClose: () => void;
  worldView: WorldView;
}

// Helper to get unique key for a region member
// Uses memberRowId if available (for split divisions), otherwise uses id
export function getMemberKey(member: RegionMember): string {
  return member.memberRowId ? `row-${member.memberRowId}` : `div-${member.id}`;
}
