import { describe, it, expect, vi } from 'vitest';
vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
import type { Pool } from 'pg';
import { upsertSuggestion } from './suggestionUpsert.js';

function mockClient() { return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool; }

describe('upsertSuggestion', () => {
  it('upserts with ON CONFLICT on the active partial index, keeping the best score', async () => {
    const c = mockClient();
    await upsertSuggestion(c, { regionId: 1, divisionId: 2, name: 'X', path: 'a>X', score: 700 });
    const [sql, params] = (c.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(region_id, division_id\) WHERE rejected = false/);
    expect(sql).toMatch(/score = GREATEST\(region_match_suggestions\.score, EXCLUDED\.score\)/);
    expect(sql).not.toMatch(/NOT EXISTS/); // default skipIfMember=false
    expect(params.slice(0, 5)).toEqual([1, 2, 'X', 'a>X', 700]);
  });

  it('skips divisions already assigned when skipIfMember=true (INSERT … SELECT … WHERE NOT EXISTS)', async () => {
    const c = mockClient();
    await upsertSuggestion(c, { regionId: 1, divisionId: 2, name: 'X', path: 'p', score: 996, geoSimilarity: 0.99, skipIfMember: true });
    const [sql] = (c.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM region_members rm WHERE rm\.region_id = \$1 AND rm\.division_id = \$2/);
    expect(sql).toMatch(/ON CONFLICT \(region_id, division_id\) WHERE rejected = false/);
  });

  it('carries conflict/donor + rejected fields when provided', async () => {
    const c = mockClient();
    await upsertSuggestion(c, { regionId: 1, divisionId: 2, name: 'X', path: 'p', score: 5, rejected: true, conflictType: 'split', donorRegionId: 9, donorDivisionId: 8, donorRegionName: 'D', donorDivisionName: 'd' });
    const [, params] = (c.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params).toContain('split'); expect(params).toContain(true);
  });
});
