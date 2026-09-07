/**
 * Tests for the provenance-aware experience upsert.
 *
 * The upsert has to answer two questions: what the row looked like before,
 * and what it looks like now. Since #822 it answers them under a lock it takes
 * first, in one transaction per object, and writes the place's membership in
 * the run's kind beside the place. These tests pin the shape of that answer,
 * the order of the statements, and the promise that a dry run writes nothing.
 *
 * A mocked pool only pins the SQL's text; it never runs the query, so it cannot
 * prove the metadata merge actually behaves as claimed. That proof is at the
 * database level instead -- a live sync run, and the statement run against real
 * rows inside BEGIN...ROLLBACK -- documented in the commit that introduced the
 * per-key guard below, not in these regexes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(async () => undefined),
}));

import { pool, rollbackQuietly } from '../../db/index.js';
import { placeVisibleSql } from '../../db/membership.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';
import { METADATA_CLAIM_PREFIX, SYNC_OWNED_METADATA_KEYS } from './changeSet.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedRollback = rollbackQuietly as unknown as ReturnType<typeof vi.fn>;

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

/** The row the read after the lock returns: the place as it stood, and the hold decided on it. */
function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    curated_fields: [],
    missing_since: null,
    source_membership: 'present',
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
    // The read's own answer to "would the gate hold this write?", which is
    // what the statement is then told. Stated rather than left undefined, so a
    // fixture is never describing a run whose gate nobody had decided.
    was_held: false,
    ...overrides,
  };
}

/** The upsert's row: the place as written, and the membership's pointer. */
function writtenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    inserted: false,
    curated_fields: [],
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
    // Returned so an unchanged row with nothing held costs no further
    // statement; a test that omitted it would exercise the wrong branch.
    pending_change_sync_log_id: null,
    ...overrides,
  };
}

const client = { query: vi.fn(), release: vi.fn() };

/**
 * What the connection answers, by statement: the locked read with the stored
 * row (or none), the upsert with the written row, everything else with nothing.
 */
function given(stored: Record<string, unknown> | null, written: Record<string, unknown> = writtenRow()) {
  client.query.mockImplementation(async (sql: string) => {
    if (/INSERT INTO experiences/.test(sql)) return { rows: [written] };
    // The lock, in a statement of its own, answers with the id or nothing;
    // the read after it answers with the row (`db/locks.ts`).
    if (/FOR NO KEY UPDATE/.test(sql)) return { rows: stored ? [{ id: stored.id }] : [] };
    if (/AS was_held/.test(sql)) return { rows: stored ? [stored] : [] };
    return { rows: [] };
  });
}

/** Every statement the connection ran, in order. */
function sentSql(): string[] {
  return client.query.mock.calls.map(call => String(call[0]));
}

function callMatching(pattern: RegExp): [string, unknown[]] {
  const call = client.query.mock.calls.find(c => pattern.test(String(c[0])));
  if (!call) throw new Error(`no statement matching ${pattern}`);
  return [String(call[0]), call[1] as unknown[]];
}

const lockedRead = () => callMatching(/FOR NO KEY UPDATE/);
const snapshotRead = () => callMatching(/AS was_held/);
const upsert = () => callMatching(/INSERT INTO experiences/);

/**
 * Everything the experiences `ON CONFLICT DO UPDATE SET` list contains, as
 * text: from the first `DO UPDATE SET` to the `RETURNING` that ends it. Its
 * own helper because two rules read the same slice and only one of them can
 * afford to parse it: `assignmentsOf` recognises an assignment by how a line
 * starts, so a column assigned mid-line is invisible to it — see the rules
 * about columns this statement must NOT assign.
 */
function setListOf(sql: string): string {
  const afterConflict = sql.slice(sql.indexOf('DO UPDATE SET'));
  return afterConflict.slice(0, afterConflict.indexOf('RETURNING'));
}

/** The membership CTE's own `DO UPDATE SET` list, the second in the statement. */
function membershipSetListOf(sql: string): string {
  const first = sql.indexOf('DO UPDATE SET');
  const second = sql.indexOf('DO UPDATE SET', first + 1);
  const afterConflict = sql.slice(second);
  return afterConflict.slice(0, afterConflict.indexOf('RETURNING'));
}

/**
 * Every `column = expression` the experiences set list assigns, by column.
 *
 * Read as assignments rather than matched as text, so a column is judged by
 * what the statement does to it: an assignment is found however it is written,
 * a comment that merely names a column is not one, and `RETURNING` and the
 * outer `SELECT` — which may legitimately name any of these columns — are
 * outside the slice entirely.
 */
function assignmentsOf(sql: string): Map<string, string> {
  const assignments = new Map<string, string>();
  let column: string | null = null;
  let expression: string[] = [];
  const flush = () => {
    if (column) assignments.set(column, expression.join('\n').trim());
  };

  for (const line of setListOf(sql).split('\n')) {
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

/** The membership CTE, from its INSERT to its RETURNING. */
function membershipCteOf(sql: string): string {
  const start = sql.indexOf('INSERT INTO experience_kind_memberships');
  return sql.slice(start, sql.indexOf('RETURNING', start));
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
  mockedRollback.mockReset();
  client.query.mockReset();
  client.release.mockReset();
  mockedConnect.mockResolvedValue(client);
  given(storedRow());
});

describe('upsertExperienceRecord', () => {
  it('reports a created row when the insert did not conflict', async () => {
    given(null, writtenRow({ inserted: true }));

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.experienceId).toBe(501);
    expect(result.changeSet.changeType).toBe('created');
    expect(result.nameSnapshot).toBe('Serengeti National Park');
  });

  it('reports unchanged when the stored row already matched', async () => {
    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.changedFields).toEqual([]);
  });

  it('tidies every name before the diff and the write, so a run reports no rename it only tidied', async () => {
    // What a label service passes through (#835): the stored row is tidy —
    // migration 047 made it so — and the source goes on offering the runs.
    const tidy = { en: 'St. John on Patmos', ar: 'يوحنا في بطمس' };
    given(
      storedRow({ name: 'St. John on Patmos', name_local: tidy, metadata: { ...PARAMS.metadata, creators: ['Ivan Shishkin'] } }),
      writtenRow({ name: 'St. John on Patmos' }),
    );

    const result = await upsertExperienceRecord({
      ...PARAMS,
      name: ' St. John  on Patmos ',
      nameLocal: { en: 'St. John  on Patmos', ar: 'يوحنا\u00a0في بطمس' },
      metadata: { ...PARAMS.metadata, creators: ['Ivan  Shishkin'] },
    });

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.nameSnapshot).toBe('St. John on Patmos');
    const [, params] = upsert();
    expect(params).toContain('St. John on Patmos');
    expect(params).toContain(JSON.stringify(tidy));
    const bound = params.filter((p): p is string => typeof p === 'string');
    expect(bound.some(p => p.includes('"Ivan Shishkin"'))).toBe(true);
    expect(bound.filter(p => /\s\s|\u00a0/.test(p))).toEqual([]);
  });

  it('reports the fields that differ from the stored row', async () => {
    given(storedRow({ short_description: 'An older summary.' }));

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('surfaces a curated field as a conflict, using the stored curated_fields', async () => {
    given(
      storedRow({ curated_fields: ['short_description'], short_description: 'Curator wording.' }),
      writtenRow({ curated_fields: ['short_description'], short_description: 'Curator wording.' }),
    );

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.curatedConflicts.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('stamps provenance on the written row', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    const [sql, params] = upsert();
    expect(sql).toContain('last_seen_sync_log_id');
    expect(sql).toContain('first_seen_sync_log_id');
    expect(params).toContain(9);
  });

  it('clears a stale missing flag when the source produces the row again', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(upsert()[0]).toContain('missing_since = NULL');
  });

  it('labels the change with the stored name, not a rejected proposal', async () => {
    given(
      storedRow({ curated_fields: ['name'], name: 'Curator wording for Serengeti' }),
      writtenRow({ curated_fields: ['name'], name: 'Curator wording for Serengeti' }),
    );

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    // The source proposed PARAMS.name and was refused; labelling the row with
    // the refused name would name an experience the curator has never seen
    expect(result.nameSnapshot).toBe('Curator wording for Serengeti');
  });

  it('reports that a row had been missing, so the run can call it a return', async () => {
    given(storedRow({ missing_since: '2026-07-01T00:00:00Z' }));

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(true);
  });

  it('reports no return for a row that was never missing', async () => {
    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(false);
  });

  it('reports no return for a row it has just created', async () => {
    given(null, writtenRow({ inserted: true }));

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(false);
  });

  it('reports a return for a row a curator had already called former', async () => {
    // The verdict is what cleared `missing_since`, so the flag alone would
    // miss the one event that contradicts it — and nothing else would say so
    given(storedRow({ missing_since: null, source_membership: 'former' }));

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(true);
  });

  it('puts a former row back to present, since the source now lists it', async () => {
    given(storedRow({ source_membership: 'former' }));

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(true);
    const [sql] = upsert();
    expect(sql).toContain("source_membership = 'present'");
    // Existence is deliberately untouched: a listing says nothing about
    // whether the thing still stands. Asserting the absence of one particular
    // assignment would pass on any other — reject the column outright.
    // Split rather than matched: `\s*` beside `\n` is a backtracking hazard
    // the linter rejects, and the assignment list is one clause per line anyway
    expect(sql.split('\n').some(line => /^\s*existence =/.test(line))).toBe(false);
  });
});

describe('a dry run', () => {
  it('reads without writing', async () => {
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
    // No connection is even taken: a preview holds no lock and opens no
    // transaction, because it writes nothing to protect.
    expect(mockedConnect).not.toHaveBeenCalled();
    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reports created when no row exists yet', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    expect(result.changeSet.changeType).toBe('created');
    expect(result.experienceId).toBe(0);
  });

  it('labels a held row with the name the run would keep', async () => {
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

  it('asks the hold rule of the memberships, rather than assuming an answer', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await upsertExperienceRecord(PARAMS, { dryRun: true });

    // A mocked pool hands back whatever the fixture holds, whether the query
    // asked for it or not — so the test above would pass on a preview that
    // selected `FALSE AS was_held` and called nothing held, for ever. This is the
    // assertion that the preview actually asks, and asks the same rule the write
    // path is guarded by: the gate flag, and a reader being able to see the
    // place — some membership of it passed — which is the membership's since
    // #822.
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain(
      '((SELECT requires_curation FROM experience_categories WHERE id = $1)'
      + ` AND ${placeVisibleSql('experiences')}) AS was_held`,
    );
    expect(sql).not.toMatch(/experiences\.curation_state/);
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
});

describe('one transaction per object, the row locked first', () => {
  it('opens with BEGIN, locks the row in a statement of its own, reads it in the next, and ends with COMMIT', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const sql = sentSql();
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    // The lock every curator write takes on the same row (`OBJECT_LOCK`), so
    // a publish and a run serialise instead of racing — and in a statement
    // that reads nothing else. A statement's snapshot is taken before it waits
    // for the lock, and only the locked row is re-read once it is granted, so
    // the memberships read in the locking statement would still be the ones
    // from before a publish that committed during the wait (`db/locks.ts`).
    const [locked, params] = lockedRead();
    expect(locked).toBe('SELECT id FROM experiences WHERE category_id = $1 AND external_id = $2 FOR NO KEY UPDATE');
    expect(params).toEqual([PARAMS.categoryId, PARAMS.externalId]);
    // The read after it, on the same row, with no lock of its own.
    const [snapshot, snapshotParams] = snapshotRead();
    expect(snapshot).not.toContain('FOR NO KEY UPDATE');
    expect(snapshot).toContain('WHERE e.category_id = $1 AND e.external_id = $2');
    expect(snapshotParams).toEqual([PARAMS.categoryId, PARAMS.externalId]);
    expect(sql.indexOf(locked)).toBeLessThan(sql.indexOf(snapshot));
    expect(sql.indexOf(snapshot)).toBeLessThan(sql.findIndex(s => /INSERT INTO experiences/.test(s)));
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('reads nothing for a place the run has not created yet', async () => {
    given(null);

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Nothing to lock is nothing to read: the insert writes every column, and
    // a snapshot statement here would be one spent on every arrival.
    expect(sentSql().some(s => /AS was_held/.test(s))).toBe(false);
  });

  it('decides the hold in the read after the lock, with the guards\' own rule', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [snapshot] = snapshotRead();
    // The same rule the preview asks: the gate, and a reader being able to see
    // the place — some membership passed. Read under the lock and after it, so
    // the answer is about the memberships as they stand when the statement
    // then writes.
    expect(snapshot).toContain(
      '((SELECT requires_curation FROM experience_categories WHERE id = $1)'
      + ` AND ${placeVisibleSql('e')}) AS was_held`,
    );
  });

  it('rolls back and rethrows when a statement fails, and returns the client marked', async () => {
    const failure = new Error('deadlock detected');
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO experiences/.test(sql)) throw failure;
      if (/FOR NO KEY UPDATE/.test(sql)) return { rows: [{ id: 501 }] };
      if (/AS was_held/.test(sql)) return { rows: [storedRow()] };
      return { rows: [] };
    });
    mockedRollback.mockResolvedValueOnce(failure);

    await expect(upsertExperienceRecord(PARAMS, { syncLogId: 42 })).rejects.toBe(failure);

    expect(mockedRollback).toHaveBeenCalledWith(client);
    expect(sentSql()).not.toContain('COMMIT');
    // What rollbackQuietly hands back is what release is told: a client whose
    // ROLLBACK also failed must be destroyed, not pooled.
    expect(client.release).toHaveBeenCalledWith(failure);
  });
});

describe('metadata is guarded per claimed key, not per column', () => {
  it('keeps a key the curator claimed and takes the rest from the source', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [text] = upsert();
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
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [sql, params] = upsert();
    // One constant, in changeSet.ts, read by the diff and by this statement. A
    // list built into the SQL text here could drift from the one the diff
    // ignores, and the pair that disagreed would either ask about a value it had
    // just written or freeze a value nothing reports.
    expect(params[15]).toEqual([...SYNC_OWNED_METADATA_KEYS]);
    // $16, which is what both metadata arms read it as; then the hold and the
    // membership's work, which are this statement's own.
    expect(params).toHaveLength(18);
    expect(sql).not.toContain("'artworkCount'");
  });

  it('merges the run-owned slice over the arm that refuses everything else', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const arm = assignmentsOf(upsert()[0]).get('metadata');
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
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const arm = assignmentsOf(upsert()[0]).get('metadata');
    // `claimedMetadataKeys` drops the same keys on the diff's side. Left in
    // here, a claim on a counter would put the stored value back over the
    // source's while the diff reported nothing either way — a number no run
    // could correct and no screen could show. Unreachable through
    // `editExperience`, which offers three keys and none of them is a counter;
    // pinned because the two sides have to agree by construction.
    expect(arm).toContain('AND claimed.k <> ALL($16::text[])');
  });
});

describe('the membership the run writes beside the place', () => {
  it('is written in the same statement, for the kind the source fills', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const cte = membershipCteOf(upsert()[0]);
    // The kind is read off the source, never passed in: a parameter would be a
    // second source of truth that could disagree with the column.
    expect(cte).toContain('INSERT INTO experience_kind_memberships');
    expect(cte).toContain('(SELECT kind_id FROM experience_categories WHERE id = $1)');
    expect(cte).toContain('ON CONFLICT (experience_id, kind_id) DO UPDATE SET');
    expect(cte).toContain('FROM ins');
  });

  it('carries the work that qualified a museum, and nothing for a source with no such work', async () => {
    await upsertExperienceRecord(
      { ...PARAMS, admittedFor: { qid: 'Q12418', label: 'Mona Lisa' } }, { syncLogId: 42 },
    );
    expect(upsert()[1][17]).toBe(JSON.stringify({ qid: 'Q12418', label: 'Mona Lisa' }));
    expect(membershipCteOf(upsert()[0])).toContain('$18::jsonb');
    // The run's own bookkeeping, taken every run — never a question for a
    // curator (#571), so never in metadata and never in the diff.
    expect(membershipSetListOf(upsert()[0])).toMatch(/admitted_for = EXCLUDED\.admitted_for/);

    client.query.mockClear();
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });
    expect(upsert()[1][17]).toBeNull();
  });

  it('reads the gate from the source rather than being told', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // A parameter would be a second source of truth that can disagree with the
    // column between the check and the write.
    expect(upsert()[0]).toMatch(/gate AS \(\s*SELECT requires_curation FROM experience_categories WHERE id = \$1/);
  });

  it('arrives pending with no published_at when the source is gated', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const cte = membershipCteOf(upsert()[0]);
    // The two move together: a pending membership has no publication moment,
    // and an auto one's publication moment is now. Anchored on the gate, so
    // neither can be written without the other having been decided.
    expect(cte).toMatch(/CASE WHEN \(SELECT requires_curation FROM gate\) THEN 'pending' ELSE 'auto' END/);
    expect(cte).toMatch(/CASE WHEN \(SELECT requires_curation FROM gate\) THEN NULL ELSE NOW\(\) END/);
    // And on the membership alone: the place no longer carries a state.
    const placeInsert = upsert()[0].slice(0, upsert()[0].indexOf('ON CONFLICT (category_id'));
    expect(placeInsert).not.toContain('curation_state');
    expect(placeInsert).not.toContain('published_at');
  });

  it('never moves the state, the badge, the verdict or published_at on conflict', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Publishing is a curator's act, the badge is the admission step's, the
    // verdict is the rule's: a run refreshing a place it already knows changes
    // none of them. Re-stamping `published_at` would move every touched row's
    // "New" chip. On the text, because an assignment can be written mid-line;
    // as substrings rather than a built regex, which the linter reads as a
    // hazard, and a guard about the schema has no business being the exception.
    const setList = membershipSetListOf(upsert()[0]);
    for (const column of ['curation_state', 'published_at', 'admission', 'is_iconic', 'kind_id', 'source_id']) {
      expect(setList, `${column} is assigned on conflict`).not.toContain(`${column} =`);
      expect(setList, `${column} is assigned on conflict`).not.toContain(`${column}=`);
    }
  });
});

describe('a gated run holds a visible place\'s content, not an unread one\'s', () => {
  // Declared once, and reused verbatim as the `HELD` constant in
  // experienceUpsert.ts, so the test and the SQL cannot drift apart in wording
  // while both look right: the answer the locked read gave, bound as $17 and
  // read off its own CTE.
  const HOLD = '(SELECT held FROM hold)';

  it('guards every content column with the hold condition as well as the claim', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const assigned = assignmentsOf(upsert()[0]);
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
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const arm = assignmentsOf(upsert()[0]).get('tags');
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

  it('tells the statement the answer the locked read gave, once', async () => {
    given(storedRow({ was_held: true }));

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [sql, params] = upsert();
    // One value, bound once, read by every guard and by the membership's
    // pointer arm: the report and the write cannot disagree about whether the
    // write happened, because both were told the same thing (#519).
    expect(sql).toMatch(/hold AS \(\s*SELECT \$17::boolean AS held\s*\)/);
    expect(params[16]).toBe(true);
    // And nothing in the statement asks the row's state on its own: the place
    // carries none, and a subselect over the memberships here would read the
    // statement's snapshot rather than the locked row.
    expect(sql).not.toMatch(/experiences\.curation_state/);
    expect(sql).not.toMatch(/EXCLUDED\.curation_state/);
  });

  it('holds nothing for a place it has just created', async () => {
    given(null, writtenRow({ inserted: true }));

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(upsert()[1][16]).toBe(false);
  });

  it('files a gated run\'s refused write as held, not as applied', async () => {
    given(
      storedRow({ was_held: true, short_description: 'The summary a reader sees.' }),
      writtenRow({ short_description: 'The summary a reader sees.' }),
    );

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The CASE arms kept the stored value, so reporting the field as changed
    // would tell the curator's screen that the proposal is what is now live.
    expect(result.changeSet.changedFields).toEqual([]);
    expect(result.changeSet.heldFields.map(f => f.field)).toEqual(['shortDescription']);
    expect(result.changeSet.changeType).toBe('unchanged');
  });

  it('reports what the read answered, not a rule of its own', async () => {
    // An unread place under a gated source: the statement refreshes it in place
    // (nobody can see it), and the read says so with `was_held = false`. The
    // diff must follow that answer — a held field here would put a card in the
    // queue about a change already applied to the very row it is about.
    given(storedRow({ was_held: false, short_description: 'Whatever landed first.' }));

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(result.changeSet.heldFields).toEqual([]);
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('points a held membership at the run whose proposal the gate kept out', async () => {
    given(
      storedRow({ was_held: true, short_description: 'The summary a reader sees.' }),
      writtenRow({ short_description: 'The summary a reader sees.' }),
    );

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The pointer follows every refused proposal, and a gate-held field is the
    // one this card exists for. Keyed on written fields alone it would now clear
    // — "nothing is held" about the row whose content this run just held — and
    // the queue's `held` card would be unreachable for ever (#518, #519).
    const [pointer, params] = callMatching(/SET pending_change_sync_log_id = \$2/);
    expect(pointer).toContain('UPDATE experience_kind_memberships');
    expect(pointer).toMatch(/curation_state <> 'pending'/);
    expect(params).toEqual([501, 42]);
    // On the same connection, inside the transaction — not on the pool.
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('lets the upsert clear the membership\'s pointer but never set it', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Whether a proposal exists is a question about whether anything differs,
    // and this statement's guards fire either way. So a held membership keeps
    // the pointer it has, one that is no longer held loses it, and nothing here
    // writes a run id.
    const setList = membershipSetListOf(upsert()[0]);
    expect(setList).toContain(`pending_change_sync_log_id = CASE WHEN ${HOLD}`);
    expect(setList).toContain('THEN experience_kind_memberships.pending_change_sync_log_id');
    expect(setList).toContain('ELSE NULL');
    expect(setList).not.toContain('$15');
    // And the place's own set list no longer names the pointer at all.
    expect(setListOf(upsert()[0])).not.toContain('pending_change_sync_log_id');
  });

  it('points a held membership at the run that proposed something, and no other run', async () => {
    given(storedRow({ name: 'An older name' }));

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The mirror image of the decay: a changed row either loses its pass
    // (trusted source) or records where the held proposal came from (gated).
    const [pointer, params] = callMatching(/SET pending_change_sync_log_id = \$2/);
    expect(pointer).toMatch(/curation_state <> 'pending'/);
    // The gate is read through the membership's source, and the membership is
    // the run's own source's, read off its log: the statement is shared with
    // the content writers (heldProposalPointer.ts), which have an experience id
    // and no category id.
    expect(pointer).toMatch(/m\.source_id = run\.category_id/);
    expect(pointer).toMatch(/c\.id = m\.source_id AND c\.requires_curation/);
    expect(params).toEqual([501, 42]);
  });

  it('records no held proposal for a pass that proposed nothing', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // A gated run that reaches 1200 unchanged rows must not tell a curator that
    // 1200 decisions are waiting — and must not spend a statement per row
    // saying so either, which is why a membership with no pointer is left alone.
    // `SET pending_…` matches only the follow-up statements: inside the upsert
    // the column is assigned within its `DO UPDATE SET` list, not after a `SET`.
    expect(sentSql().some(sql => /SET pending_change_sync_log_id/.test(sql))).toBe(false);
  });

  it('clears a held pointer when the source has come back to what is stored', async () => {
    // Held, because that is the only stored row the membership CTE returns a
    // pointer for: where the read said not held, the CTE itself clears the
    // pointer before RETURNING, and this follow-up is for the visible place
    // whose identical content proposes nothing.
    given(storedRow({ was_held: true }), writtenRow({ pending_change_sync_log_id: 41 }));

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Run 41 proposed a change; the source then reverted it. Nothing is held any
    // more, so the pointer must not go on naming a proposal that no longer
    // exists — the column means "NULL when nothing is held". On this source's
    // membership, under the gate, and never an unread one.
    const [cleared, params] = callMatching(/SET pending_change_sync_log_id = NULL/);
    expect(cleared).toContain('UPDATE experience_kind_memberships');
    expect(cleared).toMatch(/m\.source_id = \$2/);
    expect(cleared).toMatch(/curation_state <> 'pending'/);
    expect(cleared).toMatch(/EXISTS \(/);
    expect(params).toEqual([501, PARAMS.categoryId]);
  });

  it('points a held membership at the run whose proposal a claim refused', async () => {
    given(
      storedRow({ curated_fields: ['short_description'], short_description: 'Curator wording.' }),
      writtenRow({ curated_fields: ['short_description'], short_description: 'Curator wording.', pending_change_sync_log_id: 41 }),
    );

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The source proposed a value and a claim refused it, so `changedFields` is
    // empty and `curatedConflicts` carries the proposal. A pointer keyed on
    // written fields alone would clear here — telling the curator that nothing
    // waits on them about the very row whose proposal is still standing.
    const [pointer, params] = callMatching(/SET pending_change_sync_log_id = \$2/);
    expect(pointer).not.toMatch(/= NULL/);
    expect(params).toEqual([501, 42]);
  });

  it('leaves the pointer alone when the run cannot name itself', async () => {
    given(storedRow({ name: 'An older name' }), writtenRow({ pending_change_sync_log_id: 41 }));

    await upsertExperienceRecord(PARAMS);

    // The id is what a curator's screen resolves to see the proposal, so a run
    // with none has nothing to offer the column. Writing NULL would not say
    // "unknown run", it would say "nothing is held" about a row this run held.
    expect(sentSql().some(sql => /SET pending_change_sync_log_id/.test(sql))).toBe(false);
  });

  it('leaves the provenance columns outside every guard', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const assigned = assignmentsOf(upsert()[0]);
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
  it('decays only when the change set says something changed', async () => {
    // The diff computeChangeSet runs is the locked read (the stored "before")
    // vs PARAMS (what the source proposes now), exactly like every other test
    // in this file.
    given(storedRow({ name: 'An older name' }));

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const [decay] = callMatching(/curation_state = 'auto'/);
    // The pass is the membership's since #822, and the one this source brought.
    expect(decay).toContain('UPDATE experience_kind_memberships');
    expect(decay).toMatch(/m\.experience_id = \$1 AND m\.source_id = \$2[\s\S]*m\.curation_state = 'verified'/);
  });

  it('leaves a pass alone when the source is gated, since nothing was written', async () => {
    given(storedRow({ was_held: true, name: 'An older name' }));

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // Under a gated source the hold refused the change, so what a reader sees is
    // still exactly what the curator passed. The decay is keyed to fields
    // actually written, and a held field is not one — so no statement is sent at
    // all, rather than one the SQL then declines to apply.
    expect(result.changeSet.heldFields.map(f => f.field)).toEqual(['name']);
    expect(sentSql().some(sql => /curation_state = 'auto'/.test(sql))).toBe(false);
  });

  it('keeps the gate guard inside the decay statement as well', async () => {
    given(storedRow({ name: 'An older name' }));

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    // The belt to the braces above: the condition rides in the statement rather
    // than being decided only here, for the same reason the hold does — a
    // parameter is a second source of truth that can disagree with the column,
    // and this is the statement that retires a curator's pass.
    const [decay, params] = callMatching(/SET curation_state = 'auto'/);
    expect(decay).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM experience_categories\s*WHERE id = \$2 AND requires_curation\s*\)/,
    );
    expect(params).toEqual([501, PARAMS.categoryId]);
  });

  it('sends no decay statement for a provenance-only pass', async () => {
    // storedRow() with no overrides is byte-identical to PARAMS, so the
    // change set is empty — the guards fired but nothing differs.
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(sentSql().some(sql => /curation_state = 'auto'/.test(sql))).toBe(false);
  });

  it('sends no decay statement when the only divergence is one the curator claimed', async () => {
    // A claimed field the source disagrees with is a conflict, not a change:
    // the stored value did not move, so the pass still covers what is live.
    // `changedFields` and `curatedConflicts` are separate lists, which is what
    // makes this hold — pinned here so a future merge of the two cannot pass.
    given(
      storedRow({ curated_fields: ['short_description'], short_description: 'Curator wording.' }),
      writtenRow({ curated_fields: ['short_description'], short_description: 'Curator wording.' }),
    );

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

  it('is not written, whatever the source called the field', async () => {
    given(storedRow({ image_url: null }), writtenRow({ image_url: null }));

    await upsertExperienceRecord({ ...PARAMS, imageUrl: UNSHOWABLE }, { syncLogId: 42 });

    // `$13`, the picture: named by position rather than by "no parameter holds
    // it", since a null anywhere in the list would satisfy that.
    const [, parameters] = upsert();
    expect(parameters).not.toContain(UNSHOWABLE);
    expect(parameters[12]).toBeNull();
  });

  it('leaves the credit to creditToWrite, which is where the claim is visible', async () => {
    // A credit arriving beside a refused picture is, for a claimed picture, the
    // curator's own photographer resent on purpose; stripped here, the change
    // set would report its removal on every run. creditToWrite already sends
    // none for an unclaimed refused picture, and the statement re-applies a
    // claimed picture's stored credit whatever the params say.
    given(storedRow({ image_url: null }), writtenRow({ image_url: null }));

    await upsertExperienceRecord({
      ...PARAMS,
      imageUrl: UNSHOWABLE,
      metadata: { ...PARAMS.metadata, imageCredit: { author: 'Thomas Wolf' } },
    }, { syncLogId: 42 });

    const metadata = upsert()[1].find(
      (v): v is string => typeof v === 'string' && v.startsWith('{') && v.includes('inDanger'),
    );
    expect(JSON.parse(String(metadata))).toHaveProperty('imageCredit');
  });

  it('is refused in a dry run too, so a preview says what the run would do', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [storedRow({ image_url: null })] });

    const result = await upsertExperienceRecord(
      { ...PARAMS, imageUrl: UNSHOWABLE }, { dryRun: true },
    );

    expect(result.changeSet.changedFields.map(f => f.field)).not.toContain('imageUrl');
  });

  it('is refused as a path on our own origin too, which only a person may write', async () => {
    // A curator's edit may name `/images/…` for a file we host; a run's picture
    // is a Commons file by construction, so a run offering such a path is held
    // to the narrower rule and refused.
    given(storedRow({ image_url: null }), writtenRow({ image_url: null }));

    await upsertExperienceRecord({ ...PARAMS, imageUrl: '/images/experiences/unesco/156.jpg' }, { syncLogId: 42 });

    expect(upsert()[1][12]).toBeNull();
  });

  it('leaves a picture the product may show alone', async () => {
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    expect(upsert()[1]).toContain(PARAMS.imageUrl);
  });
});

describe('a credit beside no picture', () => {
  it('is taken off by the statement when the incoming picture is null', async () => {
    // creditToWrite sends no credit for a picture the run may not write, and
    // the writer nulls the url; this arm is the column holding that line for a
    // collector that did not go through creditToWrite — no photographer is
    // named beside a frame the run just emptied. The claimed-picture arm puts
    // the curator's own credit back, since that picture stays.
    given(storedRow({ image_url: null }), writtenRow({ image_url: null }));

    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const metadata = /metadata = CASE[\s\S]*?END,/.exec(upsert()[0])?.[0] ?? '';
    expect(metadata).toMatch(/EXCLUDED\.image_url IS NULL[\s\S]*?- 'imageCredit'/);
  });
});

describe('the credit under a picture a curator owns', () => {
  it('is re-applied by the statement, whatever the run sent about it', async () => {
    // creditToWrite resends the stored credit for a claimed picture, from a
    // claim set read before the collection — so a curator claiming the picture
    // while the run collects is a claim that snapshot cannot see, and the run
    // would reach the column with the source's credit for a photograph the row
    // keeps. The statement holds the line itself: a claimed picture keeps its
    // stored credit, whatever the params say.
    await upsertExperienceRecord(PARAMS, { syncLogId: 42 });

    const metadata = /metadata = CASE[\s\S]*?END,/.exec(upsert()[0])?.[0] ?? '';
    expect(metadata).toMatch(/curated_fields \? 'image_url'[\s\S]*metadata \? 'imageCredit'[\s\S]*jsonb_build_object\('imageCredit'/);
  });
});
