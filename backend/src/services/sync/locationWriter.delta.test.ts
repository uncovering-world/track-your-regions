/**
 * Tests for what a write reports — the delta the changeset records, named rather
 * than counted — and for what a gated source may not write over a point a reader
 * can already see.
 *
 * Like the rest of the writer's tests, these hold the statement rather than a
 * result — `locationWriter.test.ts` says why a mocked client can do no more.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import {
  mockedQuery, mockedConnect, writeExperienceLocations, A, B, fakeClient,
  RESURRECT, KEEP, MARK, INSERT, HOLD, only,
} from './locationWriter.fixtures.js';

/**
 * What the run did to the object's set of points, named rather than counted, so
 * the changeset can record it and a curator can be shown it (ADR-0026).
 *
 * Names and references, never ids: the record has to stay legible after the row
 * it names has been renamed, which is the same reason the changeset keeps
 * `name_snapshot` per object.
 */
describe('writeExperienceLocations — the delta it reports', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('reports nothing when the stored rows already say exactly this', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '2', ids: [7, 8] }] });

    const result = await writeExperienceLocations(1, [A, B]);

    expect(result.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
  });

  it('reports what it rewrote about a point it kept, and stays quiet about typesetting', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client } = fakeClient([
      // The resurrection arm first and empty: it opens `SET ordinal = i.ordinal`
      // too, so a bare KEEP pattern answers for both and the ids arrive twice —
      // reported as unchanged and as needing assignment at once, which is the
      // state the arms' own ordering exists to prevent.
      [RESURRECT, { rows: [] }],
      [KEEP, {
        rows: [
          // A point a curator corrected, with the source still offering its own
          // coordinate 2.0 km away. This is the *only* way a kept row can be far
          // from what the source offers: `samePointSql` bounds the pairing at ten
          // metres, and `claimedPointSql` is what keeps a corrected row in it at
          // any distance. An unclaimed move that big is a withdrawal and an
          // arrival under ADR-0027's identity rule, and is reported as those —
          // a fixture without the claim would assert a row this writer cannot
          // produce, which is coverage for a path that does not exist.
          {
            id: 7, metres: 2000, external_ref: '1465-001',
            old_name: 'Coteaux', old_lon: 4.0, old_lat: 49.0,
            old_curated_fields: ['location'],
            new_name: 'Coteaux', new_lon: 4.0, new_lat: 49.018,
          },
          // And the other real rename of that fortnight: a hyphen became an en dash.
          {
            id: 8, metres: 0, external_ref: '1808',
            old_name: 'Boma-Badingilo', old_lon: 31.5, old_lat: 6.1, old_curated_fields: [],
            new_name: 'Boma–Badingilo', new_lon: 31.5, new_lat: 6.1,
          },
        ],
      }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A, B]);

    // One entry, not two: a queue that asks a curator to rule on typesetting is a
    // queue people learn to skim.
    expect(result.delta.changed).toHaveLength(1);
    expect(result.delta.changed[0].item).toEqual({ name: 'Coteaux', ref: '1465-001' });
    expect(result.delta.changed[0].fields[0]).toMatchObject({
      field: 'location', significance: 'major', curatedConflict: true,
    });
  });

  it('still reports a change the curator\'s claim refused', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient([
      // Empty, and first, for the reason above: `RESURRECT` and `KEEP` open with
      // the same `SET ordinal = i.ordinal`.
      [RESURRECT, { rows: [] }],
      [KEEP, {
        rows: [{
          id: 7, metres: 0, external_ref: 'r1',
          old_name: 'A', old_lon: 4.0, old_lat: 49.0, old_curated_fields: ['location'],
          new_name: 'A', new_lon: 4.0, new_lat: 49.018,
        }],
      }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // The guard kept the curator's coordinate, and that is exactly what has to be
    // reported: a source arguing with a decision is the thing a curator needs to
    // see, and a run that swallowed it would leave them believing it had stopped.
    expect(result.delta.changed[0].fields[0]).toMatchObject({
      field: 'location', curatedConflict: true,
    });
  });

  it('does not re-place a corrected point the run left exactly where it was', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client } = fakeClient([
      // The resurrection arm first and empty: it opens `SET ordinal = i.ordinal`
      // too, so a bare KEEP pattern answers for both and the ids arrive twice.
      [RESURRECT, { rows: [] }],
      [KEEP, {
        rows: [
          // Claimed: the arm kept `el.location`, so nothing moved. `metres` is the
          // pairing distance to the point the source is still offering.
          {
            id: 7, metres: 2000, external_ref: 'r1',
            old_name: 'A', old_lon: 4.0, old_lat: 49.0, old_curated_fields: ['location'],
            new_name: 'A', new_lon: 4.0, new_lat: 49.018,
          },
          // Unclaimed and genuinely rewritten within the tolerance: this one is
          // placed again, because a region boundary is a line and no distance near
          // one is small enough to be safe.
          {
            id: 8, metres: 4, external_ref: 'r2',
            old_name: 'B', old_lon: 31.5, old_lat: 6.1, old_curated_fields: [],
            new_name: 'B', new_lon: 31.50004, new_lat: 6.1,
          },
        ],
      }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A, B]);

    // Otherwise every run deletes and reinserts this experience's `auto` region
    // rows for as long as the correction stands — nothing lost, since a manual
    // assignment is never touched, but exactly the churn the fast path exists to
    // remove, and it grows with how much curation has happened.
    expect(result.needsAssignment).toEqual([8]);
    expect(result.unchanged).toEqual([7]);
  });

  it('keeps a corrected point paired however far the source has moved on', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The claim would otherwise hold for exactly the corrections too small to need
    // it: a curator moves a pin off the wrong building — the motivating case is
    // 2.0 km — and the row falls out of a pairing bounded at ten metres, so the
    // source's point is inserted as a new row and the corrected one is marked
    // withdrawn. Paired by reference alone, it reaches the arm that protects it.
    const pairing = String(statements.find(s => s.includes('CREATE TEMP TABLE paired_rows')));
    expect(pairing).toContain("el.curated_fields ? 'location'");
    // Null-safe on purpose, and the fragment's docblock argues it: made strict,
    // this excludes the one row it most needs to cover, since `samePointSql`
    // falls back to exact coordinate equality when there is no reference — so a
    // corrected referenceless point would match nothing and be withdrawn. One
    // catalogue row has no reference (site 868), and it is its only point, so its
    // anchor moved with the correction too.
    expect(pairing).toContain('el.external_ref IS NOT DISTINCT FROM i.external_ref');
  });

  it('names both the point it added and the point it withdrew', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '1', ids: [7, 8] }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'auto', name: 'B', external_ref: 'r2' }] }],
      [MARK, { rows: [{ id: 7, name: 'A', external_ref: 'r1' }], rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [B]);

    expect(result.delta.added).toEqual([{ name: 'B', ref: 'r2' }]);
    expect(result.delta.withdrawn).toEqual([{ name: 'A', ref: 'r1' }]);
  });

  it('reports a point the source offers again as returned, not as added', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client } = fakeClient([
      [RESURRECT, { rows: [{ id: 7, name: 'A', external_ref: 'r1' }] }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // The same row, the same id, the same visit record on it. Reported as an
    // arrival it would read as a component the object never had.
    expect(result.delta.returned).toEqual([{ name: 'A', ref: 'r1' }]);
    expect(result.delta.added).toEqual([]);
  });

  it('reads a moved point as one withdrawal and one arrival', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const moved = { name: 'A', externalRef: 'r1', lon: 10.5, lat: 20.5 };
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'auto', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rows: [{ id: 7, name: 'A', external_ref: 'r1' }], rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [moved]);

    // Identity is the point together with the source's reference (ADR-0022, narrowed
    // by ADR-0027), so a point that really moved — the fixture walks it 76 km, from
    // (10, 20) to (10.5, 20.5) — is a row leaving and another arriving, and the
    // delta says exactly that rather than inventing a "moved" the writer never
    // performed. A coordinate merely rewritten more precisely is the other case now,
    // and never reaches here: within ten metres the row is kept and updated.
    expect(result.delta.added).toEqual([{ name: 'A', ref: 'r1' }]);
    expect(result.delta.withdrawn).toEqual([{ name: 'A', ref: 'r1' }]);
  });

  it('does not report a held withdrawal, because the run did not perform one', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'pending', name: 'B', external_ref: 'r2' }] }],
      [HOLD, { rowCount: 1 }],
      [MARK, { rows: [], rowCount: 0 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [B]);

    // The held point is still on the map and still `missing_since IS NULL`: the
    // run wrote nothing about its departure, and a delta claiming otherwise
    // would tell a curator a point had gone while a reader can still see it.
    expect(result.delta.withdrawn).toEqual([]);
    expect(result.delta.added).toEqual([{ name: 'B', ref: 'r2' }]);
  });

  it('carries a nameless point by its reference alone', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'auto', name: null, external_ref: 'r9' }] }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [
      { name: null, externalRef: 'r9', lon: 1, lat: 2 },
    ]);

    // Both halves are nullable in the table, and most UNESCO components carry a
    // reference and no name of their own. Dropping such an entry would make the
    // delta silently disagree with what the writer did.
    expect(result.delta.added).toEqual([{ name: null, ref: 'r9' }]);
  });
});

/**
 * A gated source may not overwrite what a reader can already see, and since
 * ADR-0037 that covers a field of a point as it has always covered a field of
 * the object: a visible component's name keeps its stored value, the diff says
 * the gate held it, and the object is pointed at the run so the curator's card
 * can find the proposal. Measured before this existed: 73 part-field changes
 * had been written live under gated sources, two of them renames of a place
 * (#717).
 */
describe('a visible point under a gated source', () => {
  /** The keeping arm's row for Château de Montésgur, whose name the source corrected. */
  const MONTSEGUR = {
    id: 7, metres: 0,
    old_name: 'Château de Montésgur', old_lon: 1.83, old_lat: 42.88, old_curated_fields: [],
    new_name: 'Château de Montségur', new_lon: 1.83, new_lat: 42.88,
    external_ref: '1755-004',
  };
  const held = (row: typeof MONTSEGUR, wasHeld: boolean) => ({ ...row, was_held: wasHeld });
  const POINTER = /SET pending_change_sync_log_id/;

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
  });

  it('keeps the stored name where the row is visible and the source is gated', async () => {
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    const kept = String(statements.find(s => KEEP.test(s) && !RESURRECT.test(s)));
    // The same guard the object's upsert puts on its columns: the claim, or the
    // gate over a row a reader can see — read through the experience, as the
    // insert arm reads the gate, so the two cannot disagree.
    expect(kept).toMatch(/name = CASE WHEN el\.curated_fields \? 'name'\s+OR \(\(SELECT c\.requires_curation[\s\S]*el\.curation_state <> 'pending'\)\s+THEN el\.name ELSE i\.name END/);
    // The guard's own expression answers for the report, on the row the
    // statement locked — the arrangement that keeps the write and the record
    // from disagreeing about one run (experienceUpsert.ts, #519).
    expect(kept).toMatch(/RETURNING[\s\S]*AS was_held/);
    // The coordinate is not behind the hold: a kept row is within ten metres of
    // the source's point, the same place written more precisely (ADR-0027).
    expect(kept).toMatch(/location = CASE WHEN el\.curated_fields \? 'location' THEN el\.location\s+ELSE ST_SetSRID/);
  });

  it('reports the rename as held, and points the object at the run inside the transaction', async () => {
    const { client, statements } = fakeClient([[KEEP, { rows: [held(MONTSEGUR, true)] }]]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    expect(result.delta.changed).toEqual([{
      item: { name: 'Château de Montésgur', ref: '1755-004' },
      fields: [expect.objectContaining({ field: 'name', held: true, curatedConflict: false })],
    }]);
    const pointer = only(statements, POINTER);
    expect(pointer).toMatch(/curation_state <> 'pending'/);
    expect(statements.indexOf(pointer)).toBeLessThan(statements.indexOf('COMMIT'));
    expect(client.query).toHaveBeenCalledWith(pointer, [1, 42]);
  });

  it('points at nothing when the rename was written', async () => {
    const { client, statements } = fakeClient([[KEEP, { rows: [held(MONTSEGUR, false)] }]]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    expect(result.delta.changed[0].fields[0]).toMatchObject({ field: 'name', held: false });
    expect(statements.filter(s => POINTER.test(s))).toEqual([]);
  });

  it('points at nothing for a run that cannot name itself', async () => {
    const { client, statements } = fakeClient([[KEEP, { rows: [held(MONTSEGUR, true)] }]]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A], { syncLogId: null });

    // The proposal is still recorded as held; only the pointer is withheld,
    // because NULL there means "nothing is held" and would be a lie.
    expect(statements.filter(s => POINTER.test(s))).toEqual([]);
  });
});
