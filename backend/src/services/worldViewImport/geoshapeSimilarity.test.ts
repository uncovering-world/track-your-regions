import { describe, it, expect, vi, beforeEach } from 'vitest';

const clientQuery = vi.fn();
const poolQuery = vi.fn();
vi.mock('../../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: async () => ({ query: clientQuery, release: () => {} }) },
}));

const { computeGeoSimilarityIfNeeded } = await import('./geoshapeCache.js');

/** One suggestion, a cached geoshape, and the scores `computeIoU` reads back. */
function oneSuggestion(scores: { iou: number; fwd: number; rev: number }, held = false) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('AS "divisionId"')) return { rows: [{ divisionId: 57583 }] };
    if (sql.includes('FROM wikidata_geoshapes WHERE wikidata_id')) return { rows: [{ not_available: false }] };
    if (sql.includes('WITH geoms AS')) return { rows: [{ iou: scores.iou, fwd_coverage: scores.fwd, rev_coverage: scores.rev }] };
    return { rows: [], rowCount: 0 };
  });
  clientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT source_external_id')) return { rows: [{ source_external_id: 'Q95025' }] };
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: scores.iou === 0 ? '0' : '1' }] };
    if (sql.includes('FROM region_members')) return { rows: [{ held }] };
    return { rows: [], rowCount: 0 };
  });
}

const accepted = () => clientQuery.mock.calls.some(([sql]) => String(sql).includes("SET match_status = 'auto_matched'"));

describe('computeGeoSimilarityIfNeeded on a region\'s only suggestion (#1629)', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    poolQuery.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('auto-accepts it when it is a perfect match, as it would beside rivals', async () => {
    // Seville (province) and GADM's Sevilla, measured at 0.996 on world view 30.
    oneSuggestion({ iou: 0.996, fwd: 0.998, rev: 0.998 });

    await computeGeoSimilarityIfNeeded(8195);

    expect(accepted()).toBe(true);
  });

  it('leaves it for a curator when it is not', async () => {
    // Cascavel region against all of Paraná: the region lies inside, the state is far larger.
    oneSuggestion({ iou: 0.223, fwd: 0.224, rev: 0.998 });

    await computeGeoSimilarityIfNeeded(8195);

    expect(accepted()).toBe(false);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes('SET geo_similarity'))).toBe(true);
  });

  it('keeps a region that holds divisions matched when its only, empty-handed suggestion is rejected', async () => {
    // A DB search on a matched country that finds a namesake on another continent.
    oneSuggestion({ iou: 0, fwd: 0, rev: 0 }, true);

    await computeGeoSimilarityIfNeeded(8195);

    const statusWrite = clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE region_import_state SET match_status = $2'));
    expect(statusWrite?.[1]).toEqual([8195, 'manual_matched']);
  });

  it('says no candidates for a region that holds none', async () => {
    oneSuggestion({ iou: 0, fwd: 0, rev: 0 }, false);

    await computeGeoSimilarityIfNeeded(8195);

    const statusWrite = clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE region_import_state SET match_status = $2'));
    expect(statusWrite?.[1]).toEqual([8195, 'no_candidates']);
  });
});
