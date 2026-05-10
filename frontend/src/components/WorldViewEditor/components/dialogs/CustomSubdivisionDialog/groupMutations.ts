/**
 * Pure helpers for the immutable group/member updates used by both
 * useDivisionOperations and ListViewTab. Lifted out of inline arrow
 * chains so the call sites don't trip the no-nested-functions rule.
 */

import type { RegionMember } from '../../../../../types';
import { getMemberKey } from '../../../types';
import type { SubdivisionGroup } from './types';

export function withoutMember(group: SubdivisionGroup, memberKey: string): SubdivisionGroup {
  return { ...group, members: group.members.filter(m => getMemberKey(m) !== memberKey) };
}

export function removeMemberAtIndex(
  groups: SubdivisionGroup[],
  groupIdx: number,
  memberKey: string,
): SubdivisionGroup[] {
  return groups.map((g, i) => i === groupIdx ? withoutMember(g, memberKey) : g);
}

export function addMemberAtIndex(
  groups: SubdivisionGroup[],
  groupIdx: number,
  member: RegionMember,
): SubdivisionGroup[] {
  return groups.map((g, i) => i === groupIdx ? { ...g, members: [...g.members, member] } : g);
}
