/**
 * Tests for the changeset endpoint.
 *
 * The filters are the point: a run with 1200 rows of noise and 12 rows of
 * meaning is only useful if the 12 can be asked for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getSyncLogChanges } from './syncController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

function makeReq(query: Record<string, string> = {}) {
  return { params: { logId: '9' }, query } as never;
}

const CHANGE_ROW = {
  id: 1,
  experience_id: 501,
  external_id: '156',
  name_snapshot: 'Serengeti National Park',
  change_type: 'updated',
  changed_fields: [{ field: 'metadata.inDanger', old: false, new: true, significance: 'major', curatedConflict: false }],
  significance: 'major',
  error: null,
};

describe('sync log queries', () => {
  it('flags runs that predate change provenance', async () => {
    // After slice 1 any run that changed something also wrote a changeset, so
    // its absence beside a non-zero count is what marks the older meaning of
    // total_updated — which ADR-0020 requires the card to state.
    const { getSyncLogs } = await import('./syncController.js');
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await getSyncLogs({ query: {} } as never, makeRes() as never);

    expect(String(mockedQuery.mock.calls[0][0])).toContain('AS has_changeset');
  });
});

describe('getSyncLogChanges', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('returns the changes for a run with a total', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [CHANGE_ROW] });
    const res = makeRes();

    await getSyncLogChanges(makeReq(), res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      changes: [CHANGE_ROW],
      total: 1,
    }));
  });

  it('filters by change type', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ type: 'missing' }), makeRes() as never);

    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toContain('change_type = ');
    expect(params).toContain('missing');
  });

  it('filters to significant changes only', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ significance: 'major' }), makeRes() as never);

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('major');
  });

  it('never interpolates the filters into the SQL text', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ type: 'missing', significance: 'major' }), makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).not.toContain('missing');
    expect(sql).not.toContain('major');
  });

  it('treats significantOnly=false as off, not as any-non-empty-string', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ significantOnly: 'false' }), makeRes() as never);

    expect(String(mockedQuery.mock.calls[0][0])).not.toContain("change_type <> 'updated'");
  });

  it('keeps created, missing and failed rows under the significant filter', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ significantOnly: 'true' }), makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    // Filtering on significance alone would hide every row that has none
    expect(sql).toContain("change_type <> 'updated'");
  });

  it('keeps a row whose contents moved beside a minor edit, and hands it back', async () => {
    const contentsRow = {
      id: 7, experience_id: 96, external_id: '1239', name_snapshot: 'Berlin Modernism Housing Estates',
      change_type: 'updated', significance: 'minor',
      changed_fields: [{ field: 'nameLocal', old: 'a', new: 'b', significance: 'minor' }],
      contents: { locations: { added: [{ name: 'Waldsiedlung Zehlendorf', ref: '1239-006' }], withdrawn: [], returned: [] } },
      error: null,
    };
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [contentsRow] });
    const res = makeRes();

    await getSyncLogChanges(makeReq({ significantOnly: 'true' }), res as never);

    // `significance` weighs field changes only, so a run that rewrote one minor field
    // *and* added a component lands as `updated`/`minor` — dropped by the other two
    // terms, and that row is the only record anywhere that the component arrived.
    //
    // Both queries, because they are two statements built from one `where`: asserting
    // the count alone leaves a rows query that could lose the term, and the response
    // would then be a total with nothing under it. And the row is asserted as
    // *returned*, since the `contents` projection is what carries the news — dropping
    // it from the SELECT would keep this filter working and still say nothing.
    expect(String(mockedQuery.mock.calls[0][0])).toContain('contents IS NOT NULL');
    const rowsSql = String(mockedQuery.mock.calls[1][0]);
    expect(rowsSql).toContain('contents IS NOT NULL');
    // The *projection*, sliced off before the WHERE: a `toContain('contents')` over the
    // whole statement is satisfied by the filter term this test also asserts, so
    // dropping `contents` from the SELECT would leave it green — and the mock hands the
    // row back whatever the query asked for, which is the other half of that trap.
    expect(rowsSql.slice(0, rowsSql.indexOf('FROM experience_sync_changes')))
      .toContain('contents');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      total: 1,
      changes: [expect.objectContaining({
        change_type: 'updated',
        contents: contentsRow.contents,
      })],
    }));
  });

  it('keeps a held row under the significant filter, whatever its significance', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ significantOnly: 'true' }), makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    // A held row is a proposal waiting on a curator (#519), and most of them are
    // minor field edits — a reworded description the gate kept out. It survives
    // this filter only because the filter is a denylist naming one type, so the
    // guard is that nothing else is excluded: `AND change_type <> 'held'` would
    // read as a harmless tightening and empty the default view of every waiting
    // decision. #516 is already on file because this same clause hides a row
    // class, which is what makes it the likeliest place to regress in silence.
    expect(sql.match(/change_type <>/g)).toHaveLength(1);
    expect(sql).not.toMatch(/change_type NOT IN/);
    // And the filter must stay a denylist rather than becoming a list of the
    // types worth showing, which would omit whichever type is added next.
    expect(sql).not.toMatch(/change_type IN \(/);
  });

  it('ranks major changes first, then everything that is not a routine edit', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq(), makeRes() as never);

    // A plain DESC would put NULL-significance rows first; DESC NULLS LAST would
    // bury created and missing rows behind every minor field edit. Neither is
    // the order someone opening a run is looking for.
    const sql = String(mockedQuery.mock.calls[1][0]);
    expect(sql).toContain("WHEN significance = 'major' THEN 0");
    expect(sql).toContain("WHEN change_type <> 'updated' THEN 1");
  });

  it('scopes every query to the requested run', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq(), makeRes() as never);

    for (const call of mockedQuery.mock.calls) {
      expect(String(call[0])).toContain('sync_log_id = $1');
      expect((call[1] as unknown[])[0]).toBe(9);
    }
  });
});
