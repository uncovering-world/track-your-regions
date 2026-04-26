import { describe, it, expect } from 'vitest';
import { classifyEntity, computeMaxSubDepth } from '../aiClassifier.js';

describe('computeMaxSubDepth', () => {
  it('returns 0 for tiny countries (≤5K km²)', () => {
    expect(computeMaxSubDepth(2)).toBe(0);       // Monaco
    expect(computeMaxSubDepth(316)).toBe(0);     // Malta
    expect(computeMaxSubDepth(5000)).toBe(0);    // boundary
  });

  it('returns 1 for default countries (5K-300K km²)', () => {
    expect(computeMaxSubDepth(5001)).toBe(1);
    expect(computeMaxSubDepth(30707)).toBe(1);   // Belgium
    expect(computeMaxSubDepth(92212)).toBe(1);   // Portugal
    expect(computeMaxSubDepth(300000)).toBe(1);  // boundary
  });

  it('returns 2 for large countries (300K-1M km²)', () => {
    expect(computeMaxSubDepth(300001)).toBe(2);
    expect(computeMaxSubDepth(357824)).toBe(2);  // Germany
    expect(computeMaxSubDepth(640000)).toBe(2);  // France
    expect(computeMaxSubDepth(1000000)).toBe(2); // boundary
  });

  it('returns 3 for huge countries (>1M km²)', () => {
    expect(computeMaxSubDepth(1000001)).toBe(3);
    expect(computeMaxSubDepth(9800000)).toBe(3); // USA
    expect(computeMaxSubDepth(17000000)).toBe(3); // Russia
  });
});

describe('classifyEntity', () => {
  it('returns cached result without AI call', async () => {
    const mockOpenAI = {} as never;
    const cache = new Map<string, { type: string; area_km2: number | null }>();
    cache.set('France|Europe', { type: 'country', area_km2: 640000 });

    const result = await classifyEntity(mockOpenAI, 'France', 'Europe', cache);
    expect(result).toEqual({ type: 'country', area_km2: 640000, confidence: 'cached' });
  });

  it('returns null when AI is not available', async () => {
    const result = await classifyEntity(null, 'France', 'Europe', new Map());
    expect(result).toBeNull();
  });
});
