import { describe, expect, it } from 'vitest';
import { MatchSuggestion } from '../../api/responses/worldViewImport.js';
import { matchSuggestionOf } from './wvImportAnswerRows.js';

// Baja California Sur (GADM 234504), offered to a region while a sibling
// region holds México (GADM 234491), its parent: a `split` conflict, the one
// the transfer dialog exists for (ADR-0012). A `direct` conflict is a sibling
// holding Baja California Sur itself. The region ids are illustrative.
const offered = { divisionId: 234504, name: 'Baja California Sur', path: 'México > Baja California Sur', score: 0.92, geoSimilarity: 0.88 };

describe('a suggestion from the tree read', () => {
  it('keeps the sibling holding the division', () => {
    const suggestion = matchSuggestionOf({
      ...offered,
      conflict: { type: 'split', donorRegionId: 2140, donorRegionName: 'Mexico', donorDivisionId: 234491, donorDivisionName: 'México' },
    });
    expect(MatchSuggestion.parse(suggestion).conflict).toEqual({
      type: 'split', donorRegionId: 2140, donorRegionName: 'Mexico', donorDivisionId: 234491, donorDivisionName: 'México',
    });
  });

  it('reads a conflict whose donor was deleted as no conflict, not as region 0', () => {
    // The donor columns are ON DELETE SET NULL.
    const suggestion = matchSuggestionOf({
      ...offered,
      conflict: { type: 'direct', donorRegionId: null, donorRegionName: null, donorDivisionId: 234504, donorDivisionName: 'Baja California Sur' },
    });
    expect(MatchSuggestion.parse(suggestion).conflict).toBeNull();
  });

  it('keeps a missing path and score as null', () => {
    const suggestion = matchSuggestionOf({ divisionId: 234504, name: 'Baja California Sur', path: null, score: null, geoSimilarity: null, conflict: null });
    expect(MatchSuggestion.parse(suggestion)).toMatchObject({ path: null, score: null, conflict: null });
  });
});
