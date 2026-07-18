import { describe, it, expect } from 'vitest';
import { pickBestMatch, decideLanding } from './unitMatching.js';

describe('pickBestMatch', () => {
  it('picks the country with max share above the floor', () => {
    expect(pickBestMatch([{ slug: 'fr', share: 0.97 }, { slug: 'es', share: 0.02 }])).toBe('fr');
  });
  it('returns null when nothing clears ROOT_MATCH_MIN_SHARE (0.5)', () => {
    expect(pickBestMatch([{ slug: 'fr', share: 0.3 }, { slug: 'es', share: 0.3 }])).toBeNull();
  });
});

describe('decideLanding', () => {
  it('takes the whole root when the dispute covers it (Kosovo case)', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.98 }, [], 0.99);
    expect(d).toEqual({ divisionIds: [7], approximate: false });
  });
  it('descends to child units when the root share is low (Crimea case)', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.04 }, [
      { id: 71, share: 0.99 }, { id: 72, share: 0.97 }, { id: 73, share: 0.01 },
    ], 0.98);
    expect(d).toEqual({ divisionIds: [71, 72], approximate: false });
  });
  it('flags approximate when selected units cover the NE polygon poorly', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.1 }, [{ id: 71, share: 0.6 }], 0.7);
    expect(d.approximate).toBe(true);
  });
  it('flags approximate when nothing clears the child threshold', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.1 }, [{ id: 71, share: 0.2 }], 0.2);
    expect(d).toEqual({ divisionIds: [71], approximate: true }); // best-effort: top unit kept
  });
});
