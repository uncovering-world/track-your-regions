import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { REVIEW_REGION_RESULTS, searchReviewRegions } from './reviewRegionSearchController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/**
 * The review feed's region search (#1920): every public world view at once,
 * each match with its path and world view, at most ten. Berlin is a region in
 * both public world views on the development catalogue, so the two tell apart
 * by the world view beside the path.
 */
const berlin = (id: number, worldView: string) => ({
  id, name: 'Berlin', parent_region_id: 1, description: null, color: null, uses_hull: false,
  focus_bbox: null, anchor_point: null, has_subregions: true, path: `Europe > Germany > Berlin`,
  relevance_score: 1500, world_view_id: id === 6901 ? 5 : 2, world_view: worldView,
});

beforeEach(() => mockedQuery.mockReset());

describe('the regions a curator may narrow the feed to', () => {
  it('searches every public world view, with no world view bound, and names each match with its path and world view', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [berlin(6901, 'Administrative'), berlin(1431, 'Wikivoyage Regions')] });
    const found = await searchReviewRegions({ query: { query: 'berl' } });

    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain('JOIN world_views w ON w.id = r.world_view_id');
    expect(sql).toContain('WHERE w.is_public AND');
    expect(sql).not.toContain('r.world_view_id = $2');
    // The query text, then the one term: nothing else is bound.
    expect(params).toEqual(['berl', '%berl%']);
    expect(found).toEqual([
      { id: 6901, name: 'Berlin', path: 'Europe > Germany > Berlin', worldViewId: 5, worldView: 'Administrative' },
      { id: 1431, name: 'Berlin', path: 'Europe > Germany > Berlin', worldViewId: 2, worldView: 'Wikivoyage Regions' },
    ]);
  });

  it('lists at most ten, best first, and asks nothing of two blanks', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...berlin(100 + i, 'Administrative'), relevance_score: i }));
    mockedQuery.mockResolvedValueOnce({ rows: many });
    const found = await searchReviewRegions({ query: { query: 'be' } });
    expect(found).toHaveLength(REVIEW_REGION_RESULTS);
    expect(found[0].id).toBe(113);

    mockedQuery.mockReset();
    expect(await searchReviewRegions({ query: { query: '  ' } })).toEqual([]);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
