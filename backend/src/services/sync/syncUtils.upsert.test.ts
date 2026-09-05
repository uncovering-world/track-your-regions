/**
 * Tests for the provenance-aware experience upsert.
 *
 * The upsert has to answer two questions in one round trip: what the row looked
 * like before, and what it looks like now. These tests pin the shape of that
 * answer and the promise that a dry run writes nothing.
 *
 * A mocked pool only pins the SQL's text; it never runs the query, so it cannot
 * prove the metadata merge actually behaves as claimed. That proof is at the
 * database level instead -- a live sync run, and the statement run against real
 * rows inside BEGIN...ROLLBACK -- documented in the commit that introduced the
 * per-key guard below, not in these regexes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './syncUtils.js';
import { METADATA_CLAIM_PREFIX, SYNC_OWNED_METADATA_KEYS } from './changeSet.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const PARAMS: ExperienceUpsertParams = {
  categoryId: 1,
  externalId: '156',
  name: 'Serengeti National Park',
  nameLocal: { en: 'Serengeti National Park' },
  description: null,
  shortDescription: 'Vast plains.',
  type: 'natural',
  tags: ['natural'],
  lon: 34.8333,
  lat: -2.3333,
  countryCodes: ['TZ'],
  countryNames: ['Tanzania'],
  imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Serengeti.jpg',
  metadata: { inDanger: false, dateInscribed: 1981 },
};

/**
 * Every `column = expression` the upsert's `ON CONFLICT DO UPDATE SET` list
 * assigns, by column.
 *
 * Read as assignments rather than matched as text, so a column is judged by
 * what the statement does to it: an assignment is found however it is written,
 * a comment that merely names a column is not one, and `RETURNING` and the
 * outer `SELECT` — which may legitimately name any of these columns, and which
 * later rules read the stored state through — are outside the slice entirely.
 */
/**
 * Everything the `ON CONFLICT DO UPDATE SET` list contains, as text.
 *
 * Its own helper because two rules read the same slice and only one of them can
 * afford to parse it: `assignmentsOf` recognises an assignment by how a line
 * starts, so a column assigned mid-line is invisible to it — see the two rules
 * about columns this statement must NOT assign.
 */
function setListOf(sql: unknown): string {
  const text = String(sql);
  const afterConflict = text.slice(text.indexOf('DO UPDATE SET'));
  return afterConflict.slice(0, afterConflict.indexOf('RETURNING'));
}

function assignmentsOf(sql: unknown): Map<string, string> {
  const setList = setListOf(sql);

  const assignments = new Map<string, string>();
  let column: string | null = null;
  let expression: string[] = [];
  const flush = () => {
    if (column) assignments.set(column, expression.join('\n').trim());
  };

  for (const line of setList.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue;
    const starts = /^([a-z_]+) = (.*)$/.exec(trimmed);
    if (starts) {
      flush();
      [, column] = starts;
      expression = [starts[2]];
    } else if (column) {
      expression.push(trimmed);
    }
  }
  flush();
  return assignments;
}

/** The row shape the CTE returns: new values, plus `old_*` for the prior row. */
function returnedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    inserted: false,
    curated_fields: [],
    // The upsert returns this so an unchanged row with nothing held costs no
    // further statement; a test that omitted it would exercise the wrong branch.
    pending_change_sync_log_id: null,
    // The statement's own answer to "did the gate hold this write?", which is
    // what decides whether a refused field is reported as written. Stated rather
    // than left undefined, so a fixture is never describing a run whose gate
    // nobody had decided.
    was_held: false,
    name: PARAMS.name,
    name_local: PARAMS.nameLocal,
    description: PARAMS.description,
    short_description: PARAMS.shortDescription,
    type: PARAMS.type,
    tags: PARAMS.tags,
    lon: PARAMS.lon,
    lat: PARAMS.lat,
    country_codes: PARAMS.countryCodes,
    country_names: PARAMS.countryNames,
    image_url: PARAMS.imageUrl,
    metadata: PARAMS.metadata,
    old_name: PARAMS.name,
    old_name_local: PARAMS.nameLocal,
    old_description: PARAMS.description,
    old_short_description: PARAMS.shortDescription,
    old_type: PARAMS.type,
    old_tags: PARAMS.tags,
    old_lon: PARAMS.lon,
    old_lat: PARAMS.lat,
    old_country_codes: PARAMS.countryCodes,
    old_country_names: PARAMS.countryNames,
    old_image_url: PARAMS.imageUrl,
    old_metadata: PARAMS.metadata,
    old_missing_since: null,
    ...overrides,
  };
}

/** Every statement the call sent, in order. */
function sentSql(): string[] {
  return mockedQuery.mock.calls.map(call => String(call[0]));
}

describe('upsertExperienceRecord', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('reports a created row when the insert did not conflict', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ inserted: true, old_name: null })] });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.experienceId).toBe(501);
    expect(result.changeSet.changeType).toBe('created');
    expect(result.nameSnapshot).toBe('Serengeti National Park');
  });

  it('reports unchanged when the stored row already matched', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.changedFields).toEqual([]);
  });

  it('reports the fields that differ from the stored row', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_short_description: 'An older summary.' })],
    });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('surfaces a curated field as a conflict, using the stored curated_fields', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ curated_fields: ['short_description'], old_short_description: 'Curator wording.' })],
    });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.curatedConflicts.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reads without writing in dry-run mode', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: [],
        name: 'Serengeti National Park',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: 'An older summary.',
        type: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('SELECT');
    expect(sql).not.toContain('INSERT');
    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reports created in dry-run mode when no row exists yet', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    expect(result.changeSet.changeType).toBe('created');
    expect(result.experienceId).toBe(0);
  });

  it('labels a dry run of a held row with the name the run would keep', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: [],
        was_held: true,
        name: 'The name a reader sees',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: PARAMS.shortDescription,
        type: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    // A preview exists to say what the run it stands in for would do. Under a
    // gated source that run would hold the stored name, so labelling the row
    // with the proposed one would mislabel it in the one direction that matters.
    expect(result.nameSnapshot).toBe('The name a reader sees');
    // The proposal is still reported: under a gate it is exactly what the
    // curator is being asked about, so a preview that said "nothing would
    // change" would hide the question. In the bucket that says it was refused,
    // though — a preview claiming the run would apply it is the same wrong
    // screen one step earlier (#519).
    expect(result.changeSet.changedFields).toEqual([]);
    expect(result.changeSet.heldFields.map(f => f.field)).toEqual(['name']);
  });

  it('asks the hold rule in a preview too, rather than assuming an answer', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await upsertExperienceRecord(PARAMS, { dryRun: true });

    // A mocked pool hands back whatever the fixture holds, whether the query
    // asked for it or not — so the test above would pass on a preview that
    // selected `FALSE AS was_held` and called nothing held, for ever. This is the
    // assertion that the preview actually asks, and asks the same rule the write
    // path is guarded by: the gate flag (fetched inline, since a preview has no
    // `gate` CTE) and the stored row not being `pending`.
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain(
      "((SELECT requires_curation FROM experience_categories WHERE id = $1)"
      + " AND experiences.curation_state <> 'pending') AS was_held",
    );
  });

  it('stamps provenance on the written row', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('last_seen_sync_log_id');
    expect(sql).toContain('first_seen_sync_log_id');
    expect(mockedQuery.mock.calls[0][1]).toContain(9);
  });

  it('clears a stale missing flag when the source produces the row again', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(String(mockedQuery.mock.calls[0][0])).toContain('missing_since = NULL');
  });

  it('labels the change with the stored name, not a rejected proposal', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({
        curated_fields: ['name'],
        name: 'Curator wording for Serengeti',
        old_name: 'Curator wording for Serengeti',
      })],
    });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    // The source proposed PARAMS.name and was refused; labelling the row with
    // the refused name would name an experience the curator has never seen
    expect(result.nameSnapshot).toBe('Curator wording for Serengeti');
  });

  it('previews a rename with the name the real run would store', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: [],
        missing_since: null,
        name: 'Serengeti National Park (old name)',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: PARAMS.shortDescription,
        type: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    // The live path reads the post-update name out of RETURNING; a preview that
    // reported the old one would stop standing in for the run it previews
    expect(result.nameSnapshot).toBe(PARAMS.name);
  });

  it('previews a curated name as the curator wrote it', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: ['name'],
        missing_since: null,
        name: 'Curator wording',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: PARAMS.shortDescription,
        type: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    expect(result.nameSnapshot).toBe('Curator wording');
  });

  it('reports that a row had been missing, so the run can call it a return', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_missing_since: '2026-07-01T00:00:00Z' })],
    });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(true);
  });

  it('reports no return for a row that was never missing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(false);
  });

  it('lets a preview see the return it is previewing', async () => {
    // A dry run answers from its own SELECT, so a column it reads but never
    // asks for comes back undefined — and here that column decides the one
    // case this behaviour exists for
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 5, curated_fields: [], missing_since: null, source_membership: 'former', name: PARAMS.name }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    expect(String(mockedQuery.mock.calls[0][0])).toContain('source_membership');
    expect(result.returnedFromMissing).toBe(true);
  });

  it('reports a return for a row a curator had already called former', async () => {
    // The verdict is what cleared `missing_since`, so the flag alone would
    // miss the one event that contradicts it — and nothing else would say so
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_missing_since: null, old_source_membership: 'former' })],
    });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(true);
  });

  it('puts a former row back to present, since the source now lists it', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_missing_since: null, old_source_membership: 'former' })],
    });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(true);
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain("source_membership = 'present'");
    // Existence is deliberately untouched: a listing says nothing about
    // whether the thing still stands. Asserting the absence of one particular
    // assignment would pass on any other — reject the column outright.
    // Split rather than matched: `\s*` beside `\n` is a backtracking hazard
    // the linter rejects, and the assignment list is one clause per line anyway
    expect(sql.split('\n').some(line => /^\s*existence =/.test(line))).toBe(false);
  });
});

describe('metadata is guarded per claimed key, not per column', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('keeps a key the curator claimed and takes the rest from the source', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [sql] = mockedQuery.mock.calls[0];
    const text = String(sql);
    // The whole-column guard stays for a claim on `metadata` itself...
    expect(text).toMatch(/curated_fields \? 'metadata'/);
    // ...and a per-key claim re-applies just those keys over the source object.
    expect(text).toMatch(/jsonb_array_elements_text\(experiences\.curated_fields\)/);
    expect(text).toMatch(/LIKE 'metadata\.%'/);
    // The prefix's length has to match how many characters get stripped:
    // `substring(key FROM n)` keeps the (n-1)th character onward, so a prefix
    // of length p needs n = p + 1. Deriving n from METADATA_CLAIM_PREFIX
    // instead of writing the number 10 is what stops the two from silently
    // drifting apart -- none of the regexes around this one would have
    // noticed an off-by-one here: it would make every claimed key resolve to
    // the wrong bare name (e.g. 'ebsite' instead of 'website'), the `WHERE
    // experiences.metadata ? claimed.k` guard below would never find it in
    // stored metadata, and no per-key claim would ever be re-applied again.
    expect(text).toContain(`substring(key FROM ${METADATA_CLAIM_PREFIX.length + 1})`);
    expect(text).toMatch(/jsonb_object_agg/);
    // EXCLUDED.metadata must be the LEFT operand of `||` -- the source object is
    // the base and the claimed keys are overlaid on top of it, which is what lets
    // the claim win over the source's value for that one key. The four assertions
    // above still match if the operands are swapped; only this one catches it.
    // The source's metadata is the base — with the credit taken off it where
    // the incoming picture is null, see 'a credit beside no picture' — and the
    // claimed keys are re-applied over it.
    expect(text).toMatch(/ELSE COALESCE\(EXCLUDED\.metadata, '\{\}'::jsonb\) END\) \|\| COALESCE\(\(\s*SELECT jsonb_object_agg/);
    // This guard is load-bearing, not decoration: without it, `experiences.metadata
    // -> claimed.k` is SQL NULL for a key the curator claimed but that never actually
    // landed in stored metadata, jsonb_object_agg accepts a NULL *value* (only a NULL
    // *key* throws), and the `||` merge above would overlay `"k": null` on top of
    // whatever real value the source just sent -- clobbering it. Do not delete this
    // assertion as noise; it is what stops that regression from going unnoticed.
    expect(text).toMatch(/WHERE experiences\.metadata \? claimed\.k/);
  });
});

describe('the keys a run computes about its own pass go past both guards', () => {
  beforeEach(() => mockedQuery.mockReset());

  /**
   * The behaviour these regexes stand in for was measured against the live
   * database, each inside BEGIN...ROLLBACK on the real Louvre row (#571):
   *
   * - held row (`auto` under a gated category): `totalArtworkSitelinks` went
   *   2363 → 2365 while `website` and `wikipediaUrl` kept their stored values,
   *   so the counter crossed the gate and the content did not;
   * - a UNESCO row, whose source sends neither key: metadata gained no key at
   *   all, null-valued or otherwise;
   * - a pending row claiming `metadata.website` **and**
   *   `metadata.totalArtworkSitelinks`: the website stayed the curator's, the
   *   sum was written to 2365 anyway.
   *
   * A mocked pool proves none of that. What it can hold is the shape those runs
   * went through.
   */
  it('binds the key list rather than spelling it into the statement', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [sql, params] = mockedQuery.mock.calls[0];
    // One constant, in changeSet.ts, read by the diff and by this statement. A
    // list built into the SQL text here could drift from the one the diff
    // ignores, and the pair that disagreed would either ask about a value it had
    // just written or freeze a value nothing reports.
    expect(params[params.length - 1]).toEqual([...SYNC_OWNED_METADATA_KEYS]);
    // $16, which is what both metadata arms read it as.
    expect(params).toHaveLength(16);
    expect(String(sql)).not.toContain("'artworkCount'");
  });

  it('merges the run-owned slice over the arm that refuses everything else', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const arm = assignmentsOf(mockedQuery.mock.calls[0][0]).get('metadata');
    // The arm a claim on the whole column or a hold takes. Without the merge it
    // is `THEN experiences.metadata` and the counter never moves again — which
    // is the state the Louvre was found in, its stored sum four runs stale while
    // the queue asked about the difference every time.
    expect(arm).toMatch(/THEN COALESCE\(experiences\.metadata, '\{\}'::jsonb\) \|\|\s*COALESCE\(\(\s*SELECT jsonb_object_agg\(owned\.k/);
    // Read off EXCLUDED, not off the stored row: the point is the value this run
    // computed. And guarded by presence, or a source that sends neither key —
    // every UNESCO and landmark row — would have `"artworkCount": null` merged
    // in, since jsonb_object_agg refuses a null key and accepts a null value.
    expect(arm).toContain('EXCLUDED.metadata -> owned.k');
    expect(arm).toContain('WHERE EXCLUDED.metadata ? owned.k');
  });

  it('keeps them out of the claimed-key re-application, as the diff does', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const arm = assignmentsOf(mockedQuery.mock.calls[0][0]).get('metadata');
    // `claimedMetadataKeys` drops the same keys on the diff's side. Left in
    // here, a claim on a counter would put the stored value back over the
    // source's while the diff reported nothing either way — a number no run
    // could correct and no screen could show. Unreachable through
    // `editExperience`, which offers three keys and none of them is a counter;
    // pinned because the two sides have to agree by construction.
    expect(arm).toContain('AND claimed.k <> ALL($16::text[])');
  });
});

describe('the curation gate stamps a new row', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('reads the gate from the category rather than being told', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [sql] = mockedQuery.mock.calls[0];
    const text = String(sql);
    // A parameter would be a second source of truth that can disagree with the
    // column between the check and the write.
    expect(text).toMatch(/FROM experience_categories WHERE id = \$1/);
  });

  it('inserts pending with no published_at when the source is gated', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const text = String(mockedQuery.mock.calls[0][0]);
    expect(text).toMatch(/curation_state/);
    expect(text).toMatch(/published_at/);
    // The two move together: a pending row has no publication moment, and an
    // auto row's publication moment is now. Anchored on the gate, so neither
    // can be written without the other having been decided.
    expect(text).toMatch(/CASE WHEN \(SELECT requires_curation FROM gate\) THEN 'pending' ELSE 'auto' END/);
    expect(text).toMatch(/CASE WHEN \(SELECT requires_curation FROM gate\) THEN NULL ELSE NOW\(\) END/);
  });

  it('never restarts published_at on a row that already has one', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Not a run's column to change on a row that already exists: re-stamping it
    // would move every touched row's "New" chip.
    //
    // On the text, not on parsed assignments. `assignmentsOf` finds an assignment
    // by how a line starts, so `updated_at = NOW(), published_at = NOW()` written
    // on one line would satisfy a check on its keys while doing the thing this
    // rule forbids.
    expect(setListOf(mockedQuery.mock.calls[0][0])).not.toMatch(/\bpublished_at\s*=/);
  });

  it('never assigns curation_state on conflict, which is what makes was_held true', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Two rules in one assertion, and the second is not about hygiene.
    //
    // Publishing is a curator's act, so a run may not move this column. And
    // `RETURNING ${HOLD} AS was_held` — the answer the whole report is built on
    // (#519) — evaluates against the row as it stands *after* the write. It equals
    // the value the CASE arms were guarded by only because this statement leaves
    // the column alone. Assign it here and `was_held` starts describing the row
    // after the write instead: on a held row it flips to false, every held field
    // is reported as applied, the pointer is set with no card able to reach it,
    // and #519 is back with its own guard still green.
    //
    // So: if you have a legitimate reason to assign `curation_state` here, this
    // assertion is not the thing to edit — `was_held` has to stop reading the
    // post-write tuple first (capture the pre-value in the `before` CTE and
    // reconcile it with the lock, or the report will disagree with the write).
    //
    // On the text, because the assignment can be written mid-line: appending
    // `curation_state = 'pending'` to the `updated_at = NOW()` line left all 994
    // backend tests green against a check on parsed assignment keys, while
    // flipping `was_held` to false against a real database.
    expect(setListOf(mockedQuery.mock.calls[0][0])).not.toMatch(/\bcuration_state\s*=/);
  });
});

describe('a gated run holds a visible row content, not a pending one', () => {
  beforeEach(() => mockedQuery.mockReset());

  // Declared once, and reused verbatim as the `held` constant in syncUtils.ts,
  // so the test and the SQL cannot drift apart in wording while both look right.
  const HOLD = "((SELECT requires_curation FROM gate) AND experiences.curation_state <> 'pending')";

  it('guards every content column with the hold condition as well as the claim', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const assigned = assignmentsOf(mockedQuery.mock.calls[0][0]);
    // Named individually rather than counted: a count goes stale the moment a
    // twelfth content column is added, and the failure would read as a passing
    // test with one column unguarded. Each column's own expression is examined,
    // so a lost hold on `description` cannot pass by matching the text of
    // `short_description`'s arm.
    // `tags` is not in this list, and its absence is the point of the test
    // below this one: derived labels nobody reads are written past the gate.
    for (const column of [
      'name', 'name_local', 'description', 'short_description', 'type',
      'location', 'country_codes', 'country_names', 'image_url', 'metadata',
    ]) {
      const arm = assigned.get(column);
      expect(arm, `${column} is not assigned`).toBeDefined();
      expect(arm, `${column} has no CASE arm`).toMatch(/^CASE/);
      expect(arm, `${column} is not held`).toContain(HOLD);
    }
  });

  it('writes tags past the gate and keeps them behind a claim', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const arm = assignmentsOf(mockedQuery.mock.calls[0][0]).get('tags');
    // Derived from facts the row stores by name and returned by no reader-facing
    // read, so the gate has nothing to protect: held, they filed 3785 rows that
    // restated the row beside them (#570). The claim stays, because a curator
    // can set tags through the edit endpoint and a person's write is not a
    // measurement. Both halves examined, since an arm that dropped the claim
    // with the hold would also pass a test that only checked the hold was gone.
    expect(arm).toBeDefined();
    expect(arm).not.toContain(HOLD);
    expect(arm).toContain("experiences.curated_fields ? 'tags'");
    expect(arm).toMatch(/THEN experiences\.tags ELSE EXCLUDED\.tags END/);
  });

  it('answers the hold once, in RETURNING, with the guards\' own expression', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const text = String(mockedQuery.mock.calls[0][0]);
    const returning = text.slice(text.indexOf('RETURNING'), text.indexOf('SELECT ins.*'));
    // Character-identical to what guards the ten held content columns, so the
    // report cannot disagree with the write about whether the write happened.
    expect(returning).toContain(`${HOLD} AS was_held`);
    // And read from the row this statement locked, not from the `before` CTE's
    // snapshot: a publish landing between the two reads made the statement hold
    // a write the report called applied. Measured against a real database — the
    // CTE said 'pending' while the guards said 'verified' for the same run.
    expect(text).not.toContain('old_curation_state');
    const beforeCte = text.slice(text.indexOf('WITH before AS'), text.indexOf('), gate AS'));
    expect(beforeCte).not.toContain('curation_state');
  });

  it('files a gated run\'s refused write as held, not as applied', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({
        was_held: true,
        old_short_description: 'The summary a reader sees.',
      })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The CASE arms kept the stored value, so reporting the field as changed
    // would tell the curator's screen that the proposal is what is now live.
    expect(result.changeSet.changedFields).toEqual([]);
    expect(result.changeSet.heldFields.map(f => f.field)).toEqual(['shortDescription']);
    expect(result.changeSet.changeType).toBe('unchanged');
  });

  it('reports what the statement answered, not a rule of its own', async () => {
    // A pending row under a gated source: the statement refreshes it in place
    // (nobody can see it), and says so with `was_held = false`. The diff must
    // follow that answer — a held field here would put a card in the queue about
    // a change already applied to the very row it is about. The rule itself is
    // SQL, pinned as text above and walked through live.
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ was_held: false, old_short_description: 'Whatever landed first.' })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(result.changeSet.heldFields).toEqual([]);
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('points a held row at the run whose proposal the gate kept out', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({
        was_held: true,
        old_short_description: 'The summary a reader sees.',
      })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The pointer follows every refused proposal, and a gate-held field is the
    // one this card exists for. Keyed on written fields alone it would now clear
    // — "nothing is held" about the row whose content this run just held — and
    // the queue's `held` card would be unreachable for ever (#518, #519).
    const pointer = sentSql().find(sql => /SET pending_change_sync_log_id/.test(sql));
    expect(pointer).toBeDefined();
    expect(pointer).not.toMatch(/= NULL/);
    expect(mockedQuery.mock.calls.at(-1)?.[1]).toEqual([501, 42]);
  });

  it('reads the stored state, not the value it is about to write', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const text = String(mockedQuery.mock.calls[0][0]);
    // `experiences.curation_state` inside ON CONFLICT is the pre-update value.
    // EXCLUDED is the incoming row, whose curation_state is what task 3's own
    // CASE just computed ('pending' for a gated source) -- guarding on that
    // would make `requires_curation AND EXCLUDED.curation_state <> 'pending'`
    // collapse to `true AND false`, and the hold would never fire for anyone.
    expect(text).toMatch(/experiences\.curation_state <> 'pending'/);
    expect(text).not.toMatch(/EXCLUDED\.curation_state/);
  });

  it('lets the upsert clear the held pointer but never set it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Whether a proposal exists is a question about whether anything differs,
    // and this statement's guards fire either way. So a held row keeps the
    // pointer it has, a row that is no longer held loses it, and nothing here
    // writes a run id.
    const assigned = assignmentsOf(mockedQuery.mock.calls[0][0]);
    const pointer = assigned.get('pending_change_sync_log_id');
    expect(pointer).toContain(HOLD);
    expect(pointer).toContain('THEN experiences.pending_change_sync_log_id');
    expect(pointer).toContain('ELSE NULL');
    expect(pointer).not.toContain('$15');
  });

  it('points a held row at the run that proposed something, and no other run', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ old_name: 'An older name' })] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The mirror image of the decay: a changed row either loses its pass
    // (trusted source) or records where the held proposal came from (gated).
    const pointer = sentSql().find(sql => /SET pending_change_sync_log_id/.test(sql));
    expect(pointer).toBeDefined();
    expect(pointer).toMatch(/curation_state <> 'pending'/);
    // The gate is read through the row rather than bound as a second parameter:
    // the statement is shared with the content writers (heldProposalPointer.ts),
    // which have an experience id and no category id.
    expect(pointer).toMatch(
      /EXISTS \(\s*SELECT 1 FROM experience_categories c\s*WHERE c\.id = e\.category_id AND c\.requires_curation\s*\)/,
    );
    expect(mockedQuery.mock.calls.at(-1)?.[1]).toEqual([501, 42]);
  });

  it('records no held proposal for a pass that proposed nothing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // A gated run that reaches 1200 unchanged rows must not tell a curator that
    // 1200 decisions are waiting — and must not spend a statement per row
    // saying so either, which is why a row with no pointer is left alone.
    // `SET pending_…` matches only the follow-up statements: inside the upsert
    // the column is assigned within its `DO UPDATE SET` list, not after a `SET`.
    expect(sentSql().some(sql => /SET pending_change_sync_log_id/.test(sql))).toBe(false);
  });

  it('clears a held pointer when the source has come back to what is stored', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ pending_change_sync_log_id: 41 })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Run 41 proposed a change; the source then reverted it. Nothing is held any
    // more, so the pointer must not go on naming a proposal that no longer
    // exists — the column means "NULL when nothing is held".
    const cleared = sentSql().find(sql => /SET pending_change_sync_log_id = NULL/.test(sql));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/curation_state <> 'pending'/);
    expect(cleared).toMatch(/EXISTS \(/);
    expect(mockedQuery.mock.calls.at(-1)?.[1]).toEqual([501, PARAMS.categoryId]);
  });

  it('points a held row at the run whose proposal a claim refused', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({
        curated_fields: ['short_description'],
        old_short_description: 'Curator wording.',
        pending_change_sync_log_id: 41,
      })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The source proposed a value and a claim refused it, so `changedFields` is
    // empty and `curatedConflicts` carries the proposal. A pointer keyed on
    // written fields alone would clear here — telling the curator that nothing
    // waits on them about the very row whose proposal is still standing.
    const pointer = sentSql().find(sql => /SET pending_change_sync_log_id/.test(sql));
    expect(pointer).toBeDefined();
    expect(pointer).not.toMatch(/= NULL/);
    expect(mockedQuery.mock.calls.at(-1)?.[1]).toEqual([501, 42]);
  });

  it('leaves the pointer alone when the run cannot name itself', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_name: 'An older name', pending_change_sync_log_id: 41 })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS);

    // The id is what a curator's screen resolves to see the proposal, so a run
    // with none has nothing to offer the column. Writing NULL would not say
    // "unknown run", it would say "nothing is held" about a row this run held.
    expect(sentSql().some(sql => /SET pending_change_sync_log_id/.test(sql))).toBe(false);
  });

  it('leaves the provenance columns outside every guard', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const assigned = assignmentsOf(mockedQuery.mock.calls[0][0]);
    // A gated run still records that the source listed the object,
    // or missing detection starts flagging everything the gate holds and one
    // gated source manufactures a category-wide false alarm.
    // Every one of the five named individually: naming three of them and
    // calling it "the provenance columns" would pass while a guard sat on
    // either of the other two.
    for (const column of [
      'last_seen_sync_log_id', 'last_seen_at', 'missing_since', 'source_membership', 'updated_at',
    ]) {
      const assignment = assigned.get(column);
      expect(assignment, `${column} is not assigned at all`).toBeDefined();
      expect(assignment, `${column} is guarded`).not.toMatch(/^CASE/);
    }
    // What those assignments have to say, not merely that they are unguarded.
    expect(assigned.get('last_seen_at')).toBe('NOW(),');
    expect(assigned.get('missing_since')).toBe('NULL,');
    expect(assigned.get('source_membership')).toBe("'present',");
  });
});

describe('a trusted source decays a curator pass', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('decays only when the change set says something changed', async () => {
    // The diff computeChangeSet runs is old_* (the stored "before") vs PARAMS
    // (what the source proposes now), exactly like every other test in this
    // file -- overriding the bare, post-write `name` column here would leave
    // the diff empty and this case would never fire.
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ old_name: 'An older name' })] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const decay = sentSql().find(sql => /curation_state = 'auto'/.test(sql));
    expect(decay).toBeDefined();
    expect(decay).toMatch(/WHERE id = \$1[\s\S]*curation_state = 'verified'/);
  });

  it('leaves a pass alone when the source is gated, since nothing was written', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ was_held: true, old_name: 'An older name' })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Under a gated source the hold refused the change, so what a reader sees is
    // still exactly what the curator passed. The decay is keyed to fields
    // actually written, and a held field is not one — so no statement is sent at
    // all, rather than one the SQL then declines to apply.
    expect(result.changeSet.heldFields.map(f => f.field)).toEqual(['name']);
    expect(sentSql().some(sql => /curation_state = 'auto'/.test(sql))).toBe(false);
  });

  it('keeps the gate guard inside the decay statement as well', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ old_name: 'An older name' })] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The belt to the braces above: the condition rides in the statement rather
    // than being decided only here, for the same reason the hold does — a
    // parameter is a second source of truth that can disagree with the column,
    // and this is the statement that retires a curator's pass.
    const decayCall = mockedQuery.mock.calls.find(call =>
      /SET curation_state = 'auto'/.test(String(call[0])),
    );
    expect(decayCall?.[0]).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM experience_categories\s*WHERE id = \$2 AND requires_curation\s*\)/,
    );
    expect(decayCall?.[1]).toEqual([501, PARAMS.categoryId]);
  });

  it('sends no decay statement for a provenance-only pass', async () => {
    // returnedRow() with no overrides is byte-identical to PARAMS, so the
    // change set is empty — the guards fired but nothing differs.
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(sentSql().some(sql => /curation_state = 'auto'/.test(sql))).toBe(false);
  });

  it('sends no decay statement when the only divergence is one the curator claimed', async () => {
    // A claimed field the source disagrees with is a conflict, not a change:
    // the stored value did not move, so the pass still covers what is live.
    // `changedFields` and `curatedConflicts` are separate lists, which is what
    // makes this hold — pinned here so a future merge of the two cannot pass.
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ curated_fields: ['short_description'], old_short_description: 'Curator wording.' })],
    });
    mockedQuery.mockResolvedValue({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(result.changeSet.curatedConflicts.map(f => f.field)).toEqual(['shortDescription']);
    expect(sentSql().some(sql => /curation_state = 'auto'/.test(sql))).toBe(false);
  });
});

/**
 * A run writes `image_url` through no request schema at all, which is how 1260
 * rows came to carry a picture the World Heritage Centre's terms do not let this
 * product show — stored because the source called the field an image and nothing
 * asked (ADR-0043, #557). The rule lives with the writer rather than in each
 * collector, because three sources write pictures.
 */
describe('a picture a run may not store', () => {
  const UNSHOWABLE = 'https://whc.unesco.org/document/141884';

  // Without this the assertions below read `mock.calls[0]` of whatever the
  // previous describe left behind, and pass while saying nothing.
  beforeEach(() => mockedQuery.mockReset());

  it('is not written, whatever the source called the field', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ image_url: null, old_image_url: null })] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord({ ...PARAMS, imageUrl: UNSHOWABLE }, { syncLogId: 42 });

    // `$13`, the picture: named by position rather than by "no parameter holds
    // it", since a null anywhere in the list would satisfy that.
    const parameters = mockedQuery.mock.calls[0][1] as unknown[];
    expect(parameters).not.toContain(UNSHOWABLE);
    expect(parameters[12]).toBeNull();
  });

  it('leaves the credit to creditToWrite, which is where the claim is visible', async () => {
    // A credit arriving beside a refused picture is, for a claimed picture, the
    // curator's own photographer resent on purpose; stripped here, the change
    // set would report its removal on every run. creditToWrite already sends
    // none for an unclaimed refused picture, and the statement re-applies a
    // claimed picture's stored credit whatever the params say.
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ image_url: null, old_image_url: null })] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord({
      ...PARAMS,
      imageUrl: UNSHOWABLE,
      metadata: { ...PARAMS.metadata, imageCredit: { author: 'Thomas Wolf' } },
    }, { syncLogId: 42 });

    const metadata = (mockedQuery.mock.calls[0][1] as unknown[]).find(
      (v): v is string => typeof v === 'string' && v.startsWith('{') && v.includes('inDanger'),
    );
    expect(JSON.parse(String(metadata))).toHaveProperty('imageCredit');
  });

  it('is refused in a dry run too, so a preview says what the run would do', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ image_url: null, old_image_url: null })] });

    const result = await upsertExperienceRecord(
      { ...PARAMS, imageUrl: UNSHOWABLE }, { dryRun: true },
    );

    expect(result.changeSet.changedFields.map(f => f.field)).not.toContain('imageUrl');
  });

  it('is refused as a path on our own origin too, which only a person may write', async () => {
    // A curator's edit may name `/images/…` for a file we host; a run's picture
    // is a Commons file by construction, so a run offering such a path is held
    // to the narrower rule and refused.
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ image_url: null, old_image_url: null })] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord({ ...PARAMS, imageUrl: '/images/experiences/unesco/156.jpg' }, { syncLogId: 42 });

    expect((mockedQuery.mock.calls[0][1] as unknown[])[12]).toBeNull();
  });

  it('leaves a picture the product may show alone', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(mockedQuery.mock.calls[0][1] as unknown[]).toContain(PARAMS.imageUrl);
  });
});

describe('a credit beside no picture', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('is taken off by the statement when the incoming picture is null', async () => {
    // creditToWrite sends no credit for a picture the run may not write, and
    // the writer nulls the url; this arm is the column holding that line for a
    // collector that did not go through creditToWrite — no photographer is
    // named beside a frame the run just emptied. The claimed-picture arm puts
    // the curator's own credit back, since that picture stays.
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ image_url: null, old_image_url: null })] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const metadata = /metadata = CASE[\s\S]*?END,/.exec(sentSql()[0])?.[0] ?? '';
    expect(metadata).toMatch(/EXCLUDED\.image_url IS NULL[\s\S]*?- 'imageCredit'/);
  });
});

describe('the credit under a picture a curator owns', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('is re-applied by the statement, whatever the run sent about it', async () => {
    // creditToWrite resends the stored credit for a claimed picture, from a
    // claim set read before the collection — so a curator claiming the picture
    // while the run collects is a claim that snapshot cannot see, and the run
    // would reach the column with the source's credit for a photograph the row
    // keeps. The statement holds the line itself: a claimed picture keeps its
    // stored credit, whatever the params say.
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });
    mockedQuery.mockResolvedValue({ rows: [] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const sql = sentSql()[0];
    const metadata = /metadata = CASE[\s\S]*?END,/.exec(sql)?.[0] ?? '';
    expect(metadata).toMatch(/curated_fields \? 'image_url'[\s\S]*metadata \? 'imageCredit'[\s\S]*jsonb_build_object\('imageCredit'/);
  });
});
