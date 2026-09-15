/**
 * `GET /:id/finds` (#894): the finds dug up at a site and the museums that
 * show them. What these pin is the shape that makes every row a link a reader
 * can follow — the museum and its link gated as a reader's list gates them,
 * the museum's regions sent the way the search read sends them, one row per
 * building — and the join itself: the find's `foundAt` against the site's own
 * id, on a site and nothing else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getSiteFinds } from './experienceFindsController.js';
import {
  experienceOfferedToReaderSql, hideLostSql, offeredLinkSql, publishedContentSql,
} from './experienceLifecycle.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

async function findsSql(): Promise<string> {
  await getSiteFinds({ params: { id: '14730' } } as never, makeRes() as never);
  return String(mockedQuery.mock.calls[0][0]);
}

describe('getSiteFinds', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('joins a find to the site by the discovery place the museum door stored, on a site only', async () => {
    const sql = await findsSql();

    // Exact match on the Wikidata id: Mycenae's finds are filed under Mycenae.
    expect(sql).toMatch(/JOIN treasures t ON t\.metadata->'foundAt'->>'qid' = e\.external_id/);
    // The type only the Archaeology kind has — a QID a find names is a place
    // somebody dug in, and a museum row with the same id is not the spot.
    expect(sql).toMatch(/AND e\.type = 'site'/);
    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([14730]);
  });

  it('lists a find only through a museum a reader may be sent to, and a link a reader may see', async () => {
    const sql = await findsSql();

    // The link the source still places and a curator has passed; never widened,
    // since a link is a claim a reader acts on.
    expect(sql).toContain(offeredLinkSql('et'));
    expect(sql).toContain(publishedContentSql('et'));
    expect(sql).not.toMatch(/::boolean OR/);
    // The museum admitted, passed and still standing; the work passed.
    expect(sql).toContain(experienceOfferedToReaderSql('m'));
    expect(sql).toContain(hideLostSql('m'));
    // Anchored on the AND, since `publishedContentSql('t')` is a substring of
    // the link's `('et')` and would match with the work's predicate gone.
    expect(sql).toMatch(new RegExp(`AND ${publishedContentSql('t')}`));
    // And the site itself offered to a reader: a site nobody may see answers
    // the same empty list as an id that names nothing.
    expect(sql).toContain(experienceOfferedToReaderSql('e'));
    expect(sql).toContain(hideLostSql('e'));
    // A find no visible museum holds is not a find anybody can go and see.
    expect(sql).toMatch(/WHERE json_array_length\(f\.shown_at\) > 0/);
  });

  it('names each museum once, the row of the site\'s own kind first', async () => {
    const sql = await findsSql();

    // A museum in two kinds is two rows (#755): the Naples museum holds the
    // Farnese Hercules as an art museum and as an archaeology museum, and a
    // find must not say "shown at Naples and Naples".
    expect(sql).toMatch(/SELECT DISTINCT ON \(m\.external_id\) m\.id, m\.name, vk\.id AS kind_id/);
    expect(sql).toMatch(/ORDER BY m\.external_id, \(m\.source_id = e\.source_id\) DESC, m\.id/);
  });

  it('sends each museum the regions that name it to a reader, the way the search read does', async () => {
    const sql = await findsSql();

    // The same list ADR-0042 built the search's links from: published world
    // views, a region a reader's point put the object in, no rejected pair,
    // smallest first — so "shown at the Louvre" opens where the Louvre is.
    expect(sql).toMatch(/'regions', COALESCE\(\(\s*SELECT json_agg/);
    expect(sql).toMatch(/WHERE er\.experience_id = v\.id/);
    expect(sql).toMatch(/AND wv\.is_public = true/);
    expect(sql).toMatch(/ORDER BY r\.geom_area_km2 ASC NULLS LAST, r\.id/);
    expect(sql).toMatch(/SELECT 1 FROM experience_rejections rej/);
  });

  it('answers the finds with the credit each picture owes, best known first', async () => {
    const find = {
      id: 8802, external_id: 'Q1546519', name: 'Mask of Agamemnon', treasure_type: 'death mask',
      year: -1550, image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/MaskOfAgamemnon.jpg',
      is_iconic: true, sitelinks_count: 41,
      image_credit: { author: 'Xuan Che', license: 'CC BY 2.0', licenseUrl: null, detailsUrl: null },
      shown_at: [{ id: 14551, name: 'National Archaeological Museum of Athens', kind_id: 5,
        regions: [{ id: 6918, name: 'Attica', world_view_id: 5, world_view_name: 'Administrative' }] }],
    };
    mockedQuery.mockResolvedValueOnce({ rows: [find] });
    const res = makeRes();

    await getSiteFinds({ params: { id: '14730' } } as never, res as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain("t.metadata->'imageCredit' AS image_credit");
    expect(sql).toMatch(/ORDER BY f\.sitelinks_count DESC, f\.id/);
    expect(res.json).toHaveBeenCalledWith({ experienceId: 14730, finds: [find], total: 1 });
  });
});
