import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { recomputeRegionGeometry } from './geometryCompute.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('recomputeRegionGeometry', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('reports what it wrote', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ points: 4200 }] });

    const result = await recomputeRegionGeometry(7);

    expect(result).toMatchObject({ computed: true, points: 4200 });
    // One statement, and the ancestors above it are the trigger's business
    // now: the UPDATE below is a write to regions.geom, so
    // trg_regions_geom_invalidates_parent fires from inside it (#680).
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('answers computed:false when the merge wrote nothing', async () => {
    // No members and no computed children, or a hand-drawn boundary the UPDATE's
    // own guard excluded: nothing moved, so nothing above it is stale either.
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await recomputeRegionGeometry(7);

    expect(result).toMatchObject({ computed: false });
  });
});
