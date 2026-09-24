import { describe, expect, it } from 'vitest';
import { FoundSuggestion, Geoshape, MatchSuggestion } from '../../api/responses/worldViewImport.js';
import { foundSuggestionOf, geoshapeOf, matchSuggestionOf } from './wvImportAnswerRows.js';

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

describe('a suggestion a matcher just wrote', () => {
  it('keeps the sibling holding the division', () => {
    const suggestion = foundSuggestionOf({
      divisionId: 234504, name: 'Baja California Sur', path: 'México > Baja California Sur', score: 500,
      conflict: { type: 'split', donorRegionId: 2140, donorRegionName: 'Mexico', donorDivisionId: 234491, donorDivisionName: 'México' },
    });
    expect(FoundSuggestion.parse(suggestion)).toEqual({
      divisionId: 234504, name: 'Baja California Sur', path: 'México > Baja California Sur', score: 500,
      conflict: { type: 'split', donorRegionId: 2140, donorRegionName: 'Mexico', donorDivisionId: 234491, donorDivisionName: 'México' },
    });
  });

  it('sends no conflict key when nobody holds the division', () => {
    const suggestion = foundSuggestionOf({ divisionId: 234504, name: 'Baja California Sur', path: 'México > Baja California Sur', score: 500 });
    expect('conflict' in FoundSuggestion.parse(suggestion)).toBe(false);
  });
});

// Albania (Q222): the shape is illustrative, a triangle inside the country.
const albania = { type: 'Polygon', coordinates: [[[19.8, 41.3], [20.0, 41.3], [19.9, 41.5], [19.8, 41.3]]] };

describe('a geoshape from Wikimedia', () => {
  it('tags each polygon with the item and drops Wikimedia\'s own feature keys', () => {
    const shape = geoshapeOf('Q222', [{ type: 'Feature', id: 'Q222', properties: { stroke: '#555' }, geometry: albania }]);
    expect(Geoshape.parse(shape)).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { id: 'Q222' }, geometry: albania }],
    });
  });

  it('drops a geometry that is not an area', () => {
    const border = { type: 'LineString', coordinates: [[19.8, 41.3], [20.0, 41.3]] };
    const shape = geoshapeOf('Q222', [{ geometry: border }, { geometry: albania }, null]);
    expect(Geoshape.parse(shape).features.map(f => f.geometry.type)).toEqual(['Polygon']);
  });

  it('answers an item Wikimedia holds no shape for with no features', () => {
    expect(Geoshape.parse(geoshapeOf('Q14201440', []))).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
