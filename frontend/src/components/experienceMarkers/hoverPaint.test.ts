import { describe, it, expect, vi } from 'vitest';
import { claimHoverPaint, paintClusterRingForExperience } from '../ExperienceMarkers';

/**
 * The cluster scan is asynchronous and every other path that takes the hover
 * ring is not: leaving the list clears it, hovering a location or an unclustered
 * marker paints directly. Each claims a token first, and a scan that no longer
 * holds the current one must stay silent — otherwise an answer for a row the
 * pointer left lands on top of whatever is hovered now, and stays there.
 */
function fakeMap(leaves: unknown[], resolve: { now: () => void }) {
  const source = {
    getClusterLeaves: () => new Promise(res => { resolve.now = () => res(leaves); }),
  };
  return {
    getSource: () => source,
    getLayer: () => ({}),
    queryRenderedFeatures: () => [{
      properties: { cluster_id: 1, point_count: 5 },
      geometry: { type: 'Point', coordinates: [10, 50] },
    }],
  } as never;
}

describe('hover ring ownership', () => {
  it('paints when it still holds the claim', async () => {
    const late = { now: () => {} };
    const map = fakeMap([{ properties: { experienceId: 7 } }], late);
    const setHoverData = vi.fn();

    const sequence = claimHoverPaint();
    paintClusterRingForExperience(map, 7, [1, 2], setHoverData, sequence);
    late.now();
    await new Promise(r => setTimeout(r, 0));

    expect(setHoverData).toHaveBeenCalled();
  });

  it('stays silent when a later hover has claimed the ring', async () => {
    // The everyday gesture: hover a row in a clustered region, then move the
    // pointer off the list before the scan answers.
    const late = { now: () => {} };
    const map = fakeMap([{ properties: { experienceId: 7 } }], late);
    const setHoverData = vi.fn();

    const sequence = claimHoverPaint();
    paintClusterRingForExperience(map, 7, [1, 2], setHoverData, sequence);

    claimHoverPaint();   // leaving the list, hovering a marker, clearing — any of them
    late.now();
    await new Promise(r => setTimeout(r, 0));

    expect(setHoverData).not.toHaveBeenCalled();
  });

  it('hands out a fresh claim each time', () => {
    expect(claimHoverPaint()).not.toBe(claimHoverPaint());
  });
});
