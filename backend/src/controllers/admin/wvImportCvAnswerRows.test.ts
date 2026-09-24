import { describe, expect, it } from 'vitest';
import { ClusterRegionSuggestions } from '../../api/responses/wvImportCvMatch.js';
import { clusterRegionMatchesOf } from './wvImportCvAnswerRows.js';

// Albania's two Wikivoyage regions, as the import holds them.
const childRegions = [
  { id: 1223, name: 'Northeastern Albania' },
  { id: 1224, name: 'Southeastern Albania' },
];
const asked = new Set([0, 1, 2]);

function parses(matches: ReturnType<typeof clusterRegionMatchesOf>) {
  const stats = { model: 'o4-mini', promptTokens: 1, completionTokens: 1, cost: 0, durationMs: 1 };
  return ClusterRegionSuggestions.parse({ matches, stats }).matches;
}

describe('a model\'s reading of the colour clusters', () => {
  it('matches a region name case-insensitively and answers with the region\'s own name', () => {
    const content = JSON.stringify({ matches: [{ clusterId: 0, regionName: 'northeastern albania', confidence: 'high' }] });
    expect(parses(clusterRegionMatchesOf(content, asked, childRegions))).toEqual([
      { clusterId: 0, regionId: 1223, regionName: 'Northeastern Albania' },
    ]);
  });

  it('reads the list bare or under `result` too', () => {
    const entry = { clusterId: 1, regionName: 'Southeastern Albania' };
    const expected = [{ clusterId: 1, regionId: 1224, regionName: 'Southeastern Albania' }];
    expect(clusterRegionMatchesOf(JSON.stringify([entry]), asked, childRegions)).toEqual(expected);
    expect(clusterRegionMatchesOf(JSON.stringify({ result: [entry] }), asked, childRegions)).toEqual(expected);
  });

  it('answers a name that is no child region, or none, with no region', () => {
    const content = JSON.stringify({ matches: [{ clusterId: 0, regionName: 'Albanian Riviera' }, { clusterId: 1, regionName: null }] });
    expect(parses(clusterRegionMatchesOf(content, asked, childRegions))).toEqual([
      { clusterId: 0, regionId: null, regionName: null },
      { clusterId: 1, regionId: null, regionName: null },
    ]);
  });

  it('gives a region to the first cluster that names it and to no other', () => {
    const content = JSON.stringify({ matches: [
      { clusterId: 0, regionName: 'Northeastern Albania' },
      { clusterId: 1, regionName: 'Northeastern Albania' },
    ] });
    expect(clusterRegionMatchesOf(content, asked, childRegions)).toEqual([
      { clusterId: 0, regionId: 1223, regionName: 'Northeastern Albania' },
      { clusterId: 1, regionId: null, regionName: null },
    ]);
  });

  it('leaves out a cluster nobody asked about, a second answer to one, and an id that is not a number', () => {
    const content = JSON.stringify({ matches: [
      { clusterId: 7, regionName: 'Northeastern Albania' },
      { clusterId: '2', regionName: 'Southeastern Albania' },
      { clusterId: 0, regionName: 'Southeastern Albania' },
      { clusterId: 0, regionName: 'Northeastern Albania' },
      'Northeastern Albania',
    ] });
    expect(clusterRegionMatchesOf(content, asked, childRegions)).toEqual([
      { clusterId: 0, regionId: 1224, regionName: 'Southeastern Albania' },
    ]);
  });

  it('reads an answer that is not JSON as no matches', () => {
    expect(clusterRegionMatchesOf('Cluster 0 is Northeastern Albania.', asked, childRegions)).toEqual([]);
  });
});
