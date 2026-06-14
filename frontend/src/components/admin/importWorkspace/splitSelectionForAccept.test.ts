/**
 * Tests for splitSelectionForAccept — the pure split helper used by the
 * batch "Accept selected" action to separate clean from conflicted suggestions.
 */
import { describe, it, expect } from 'vitest';
import { splitSelectionForAccept } from './splitSelectionForAccept';

describe('splitSelectionForAccept', () => {
  it('all-clean: all go into cleanIds, none in conflictedSugs', () => {
    const sugs = [
      { divisionId: 1 },
      { divisionId: 2 },
      { divisionId: 3 },
    ];
    const { cleanIds, conflictedSugs } = splitSelectionForAccept(sugs);
    expect(cleanIds).toEqual([1, 2, 3]);
    expect(conflictedSugs).toHaveLength(0);
  });

  it('all-conflict: cleanIds empty, all go into conflictedSugs', () => {
    const conflict = { type: 'direct' as const, donorRegionId: 10, donorDivisionId: 20, donorRegionName: 'R', donorDivisionName: 'D' };
    const sugs = [
      { divisionId: 4, conflict },
      { divisionId: 5, conflict },
    ];
    const { cleanIds, conflictedSugs } = splitSelectionForAccept(sugs);
    expect(cleanIds).toHaveLength(0);
    expect(conflictedSugs.map(s => s.divisionId)).toEqual([4, 5]);
  });

  it('mixed: clean divisions go into cleanIds, conflicted into conflictedSugs', () => {
    const conflict = { type: 'split' as const, donorRegionId: 99, donorDivisionId: 88, donorRegionName: 'Donor', donorDivisionName: 'Div' };
    const sugs = [
      { divisionId: 10 },
      { divisionId: 11, conflict },
      { divisionId: 12 },
      { divisionId: 13, conflict },
    ];
    const { cleanIds, conflictedSugs } = splitSelectionForAccept(sugs);
    expect(cleanIds).toEqual([10, 12]);
    expect(conflictedSugs.map(s => s.divisionId)).toEqual([11, 13]);
  });
});
