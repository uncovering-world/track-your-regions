import { describe, it, expect } from 'vitest';
import {
  detectSpatialAnomalies,
  type DivisionAssignment,
  type AdjacencyEdge,
} from './spatialAnomalyDetector.js';

describe('detectSpatialAnomalies', () => {
  it('returns empty array when all regions are fully connected', () => {
    // Region A has 3 divisions that form a connected chain: 1-2-3
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Region A' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 2, divB: 3 },
    ];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toEqual([]);
  });

  it('detects a single exclave surrounded by another region', () => {
    // Region A: divisions 1, 2, 3 (connected chain)
    // Region B: divisions 4, 5 (connected), division 6 (isolated exclave, adjacent to region A's div 1)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Region A' },
      { divisionId: 4, memberRowId: 20, regionId: 200, regionName: 'Region B' },
      { divisionId: 5, memberRowId: 21, regionId: 200, regionName: 'Region B' },
      { divisionId: 6, memberRowId: 22, regionId: 200, regionName: 'Region B', divisionName: 'Exclave' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 2, divB: 3 },
      { divA: 4, divB: 5 },
      // Division 6 is NOT adjacent to 4 or 5, but IS adjacent to division 1 (Region A)
      { divA: 1, divB: 6 },
    ];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedTargetRegionId).toBe(100);
    expect(result[0].suggestedTargetRegionName).toBe('Region A');
    expect(result[0].divisions).toHaveLength(1);
    expect(result[0].divisions[0].divisionId).toBe(6);
    expect(result[0].divisions[0].name).toBe('Exclave');
    expect(result[0].divisions[0].sourceRegionId).toBe(200);
    expect(result[0].divisions[0].sourceRegionName).toBe('Region B');
    expect(result[0].divisions[0].memberRowId).toBe(22);
    expect(result[0].fragmentSize).toBe(1);
    expect(result[0].totalRegionSize).toBe(3);
    expect(result[0].score).toBeCloseTo(1 / 3);
  });

  it('detects a disconnected fragment with multiple divisions', () => {
    // Region A: divisions 1, 2 (connected) + divisions 3, 4 (connected fragment)
    // Region B: division 5 (adjacent to 3 and 4)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Region A', divisionName: 'Frag1' },
      { divisionId: 4, memberRowId: 13, regionId: 100, regionName: 'Region A', divisionName: 'Frag2' },
      { divisionId: 5, memberRowId: 20, regionId: 200, regionName: 'Region B' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 3, divB: 4 },
      // Fragment adjacent to Region B
      { divA: 3, divB: 5 },
      { divA: 4, divB: 5 },
    ];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedTargetRegionId).toBe(200);
    expect(result[0].suggestedTargetRegionName).toBe('Region B');
    expect(result[0].divisions.map((d) => d.divisionId).sort()).toEqual([3, 4]);
    expect(result[0].fragmentSize).toBe(2);
    expect(result[0].totalRegionSize).toBe(4);
    expect(result[0].score).toBeCloseTo(2 / 4);
  });

  it('returns empty array when there are no adjacency edges and no cross-region neighbors', () => {
    // Two regions, each with 2 divisions, but zero edges
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: 20, regionId: 200, regionName: 'Region B' },
      { divisionId: 4, memberRowId: 21, regionId: 200, regionName: 'Region B' },
    ];
    const edges: AdjacencyEdge[] = [];

    const result = detectSpatialAnomalies(assignments, edges);
    // Each region has 2 divisions forming 2 singleton components.
    // The smaller component has no cross-region neighbors (no edges at all), so it's skipped.
    expect(result).toEqual([]);
  });

  it('returns empty array for single-division regions', () => {
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 20, regionId: 200, regionName: 'Region B' },
    ];
    const edges: AdjacencyEdge[] = [{ divA: 1, divB: 2 }];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toEqual([]);
  });

  it('skips island fragments with no cross-region neighbors', () => {
    // Region A: divisions 1, 2 (connected) + division 3 (isolated island, no edges at all)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Region A' },
    ];
    const edges: AdjacencyEdge[] = [{ divA: 1, divB: 2 }];

    const result = detectSpatialAnomalies(assignments, edges);
    // Division 3 is a fragment but has no cross-region neighbors, so it's skipped
    expect(result).toEqual([]);
  });

  it('handles null memberRowId for suggested assignments', () => {
    // Same as exclave test but with null memberRowId (suggested, not committed)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: null, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: null, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: null, regionId: 100, regionName: 'Region A' },
      { divisionId: 4, memberRowId: null, regionId: 200, regionName: 'Region B' },
      { divisionId: 5, memberRowId: null, regionId: 200, regionName: 'Region B' },
      { divisionId: 6, memberRowId: null, regionId: 200, regionName: 'Region B', divisionName: 'Exclave' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 2, divB: 3 },
      { divA: 4, divB: 5 },
      { divA: 1, divB: 6 },
    ];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].divisions[0].memberRowId).toBeNull();
    expect(result[0].suggestedTargetRegionId).toBe(100);
  });

  it('returns multiple anomalies sorted by score ascending', () => {
    // Region A: 10 divisions (1-10), fully connected chain
    // Region B: 4 divisions (11, 12 connected + 13 isolated exclave near A + 14 isolated exclave near A)
    // Region C: 3 divisions (15, 16 connected + 17 isolated exclave near A)
    //
    // Region B exclave (13): fragment=1, total=4, score=0.25
    // Region B exclave (14): fragment=1, total=4, score=0.25
    // Region C exclave (17): fragment=1, total=3, score=0.333
    //
    // Sorted: B exclaves (0.25) first, then C exclave (0.333)
    const assignments: DivisionAssignment[] = [
      // Region A: 10 divisions
      ...Array.from({ length: 10 }, (_, i) => ({
        divisionId: i + 1,
        memberRowId: i + 1,
        regionId: 100,
        regionName: 'Region A',
      })),
      // Region B: 4 divisions
      { divisionId: 11, memberRowId: 30, regionId: 200, regionName: 'Region B' },
      { divisionId: 12, memberRowId: 31, regionId: 200, regionName: 'Region B' },
      { divisionId: 13, memberRowId: 32, regionId: 200, regionName: 'Region B' },
      { divisionId: 14, memberRowId: 33, regionId: 200, regionName: 'Region B' },
      // Region C: 3 divisions
      { divisionId: 15, memberRowId: 40, regionId: 300, regionName: 'Region C' },
      { divisionId: 16, memberRowId: 41, regionId: 300, regionName: 'Region C' },
      { divisionId: 17, memberRowId: 42, regionId: 300, regionName: 'Region C' },
    ];
    const edges: AdjacencyEdge[] = [
      // Region A chain
      ...Array.from({ length: 9 }, (_, i) => ({ divA: i + 1, divB: i + 2 })),
      // Region B main body
      { divA: 11, divB: 12 },
      // Region B exclaves adjacent to Region A
      { divA: 1, divB: 13 },
      { divA: 2, divB: 14 },
      // Region C main body
      { divA: 15, divB: 16 },
      // Region C exclave adjacent to Region A
      { divA: 3, divB: 17 },
    ];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result.length).toBe(3);
    // All should target Region A
    expect(result.every((a) => a.suggestedTargetRegionId === 100)).toBe(true);
    // Scores should be ascending
    for (let i = 1; i < result.length; i++) {
      expect(result[i].score).toBeGreaterThanOrEqual(result[i - 1].score);
    }
    // First two have score 0.25, last has score ~0.333
    expect(result[0].score).toBeCloseTo(0.25);
    expect(result[1].score).toBeCloseTo(0.25);
    expect(result[2].score).toBeCloseTo(1 / 3);
  });

  it('selects the dominant neighbor (region with most contacts)', () => {
    // Region A: divisions 1, 2, 3 (connected chain)
    // Region B: divisions 4, 5 (connected)
    // Region C: divisions 6, 7 (connected)
    // Division 8 belongs to Region A but is isolated, adjacent to B (div 4, 5) and C (div 6)
    // B has 2 contacts, C has 1 contact -> B wins
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Region A' },
      { divisionId: 8, memberRowId: 13, regionId: 100, regionName: 'Region A' },
      { divisionId: 4, memberRowId: 20, regionId: 200, regionName: 'Region B' },
      { divisionId: 5, memberRowId: 21, regionId: 200, regionName: 'Region B' },
      { divisionId: 6, memberRowId: 30, regionId: 300, regionName: 'Region C' },
      { divisionId: 7, memberRowId: 31, regionId: 300, regionName: 'Region C' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 2, divB: 3 },
      { divA: 4, divB: 5 },
      { divA: 6, divB: 7 },
      // Division 8 adjacent to B's divisions (2 contacts)
      { divA: 4, divB: 8 },
      { divA: 5, divB: 8 },
      // Division 8 adjacent to C's division (1 contact)
      { divA: 6, divB: 8 },
    ];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedTargetRegionId).toBe(200); // Region B wins with 2 contacts
    expect(result[0].suggestedTargetRegionName).toBe('Region B');
  });

  it('breaks ties by lowest region ID', () => {
    // Region A: divisions 1, 2 (connected) + division 3 (isolated)
    // Region B (id=200): division 4, adjacent to 3
    // Region C (id=150): division 5, adjacent to 3
    // Both B and C have 1 contact each -> C wins (lower ID: 150 < 200)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region A' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Region A' },
      { divisionId: 4, memberRowId: 20, regionId: 200, regionName: 'Region B' },
      { divisionId: 5, memberRowId: 30, regionId: 150, regionName: 'Region C' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 3, divB: 4 },
      { divA: 3, divB: 5 },
    ];

    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedTargetRegionId).toBe(150); // Lowest ID wins on tie
    expect(result[0].suggestedTargetRegionName).toBe('Region C');
  });
});
