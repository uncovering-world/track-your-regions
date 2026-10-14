import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import type { DumpFile } from './catalog.js';
import { beat, BuildAlreadyRunning, closeBuild, closeOrphanedBuilds, liveBuildOf, openBuild, recentBuilds } from './ledger.js';

/**
 * The dump build ledger against PostgreSQL (ADR-0101 decision 3): a build's
 * row is opened and closed with what was read, the panel sees the newest
 * three of each dump, and a build a restart stopped is closed as failed while
 * a closed one keeps its outcome. The rows carry a marker in their file name
 * and are deleted after.
 */

const MARKER = 'ledger-fixture';

afterAll(async () => {
  await pool.query('DELETE FROM dump_builds WHERE file_name LIKE $1', [`${MARKER}%`]);
});

const file = (n: number, over: Partial<DumpFile> = {}): DumpFile => ({
  key: 'wikidata-lexemes', fileName: `${MARKER}-${n}.json.gz`, url: `https://dumps.wikimedia.org/${MARKER}-${n}.json.gz`,
  date: '2026-10-07', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 1000, compression: 'gzip', ...over,
});

const row = async (id: number) => (await pool.query('SELECT * FROM dump_builds WHERE id = $1', [id])).rows[0];

describe('the dump build ledger', () => {
  it('opens a build as running with what the host published, and closes it with what was read', async () => {
    const id = await openBuild(file(1), 'stream', null, 'server:fixture');
    expect(await row(id)).toMatchObject({
      dump: 'wikidata-lexemes', status: 'running', mode: 'stream', expected_bytes: '1000',
      checksum_kind: 'sha1', checksum_expected: 'a'.repeat(40), finished_at: null,
    });
    await closeBuild(id, { status: 'success', bytes: 1000, lines: 42, checksumActual: 'a'.repeat(40), error: null });
    const closed = await row(id);
    expect(closed).toMatchObject({ status: 'success', bytes: '1000', lines: '42', checksum_actual: 'a'.repeat(40) });
    expect(closed.finished_at).not.toBeNull();
  });

  it('shows the panel the newest three builds of a dump, newest first', async () => {
    const ids: number[] = [];
    for (const n of [10, 11, 12, 13]) {
      const id = await openBuild(file(n, { key: 'enwiki-langlinks' }), 'local', null, 'server:fixture');
      await closeBuild(id, { status: 'failed', bytes: 0, lines: 0, checksumActual: null, error: 'fixture' });
      ids.push(id);
    }
    const shown = (await recentBuilds()).filter(build => build.dump === 'enwiki-langlinks').map(build => build.id);
    expect(shown).toEqual([ids[3], ids[2], ids[1]]);
  });

  it('closes a build that stopped beating as failed, and leaves a closed one and a beating one as they were', async () => {
    const stopped = await openBuild(file(20), 'stream', null, 'server:fixture');
    await pool.query("UPDATE dump_builds SET heartbeat_at = NOW() - interval '6 minutes' WHERE id = $1", [stopped]);
    const done = await openBuild(file(21, { key: 'wikidata-entities' }), 'stream', null, 'server:fixture');
    await closeBuild(done, { status: 'cancelled', bytes: 5, lines: 1, checksumActual: null, error: 'Cancelled.' });
    const alive = await openBuild(file(22, { key: 'enwiki-langlinks' }), 'stream', null, 'script:fixture');
    expect(await closeOrphanedBuilds()).toBeGreaterThanOrEqual(1);
    expect(await row(stopped)).toMatchObject({ status: 'failed', error: 'The build stopped: its process ended or restarted.' });
    expect(await row(done)).toMatchObject({ status: 'cancelled', error: 'Cancelled.' });
    expect(await row(alive)).toMatchObject({ status: 'running' });
    await closeBuild(alive, { status: 'cancelled', bytes: 0, lines: 0, checksumActual: null, error: 'fixture' });
  });

  it('names the build of a dump another process runs while it beats, and none once it stops beating (#1463)', async () => {
    const id = await openBuild(file(40, { key: 'pageviews-user' }), 'local', null, 'server:fixture');
    expect((await liveBuildOf('pageviews-user'))?.id).toBe(id);
    await pool.query("UPDATE dump_builds SET heartbeat_at = NOW() - interval '6 minutes' WHERE id = $1", [id]);
    expect(await liveBuildOf('pageviews-user')).toBeNull();
    await beat(id);
    expect((await liveBuildOf('pageviews-user'))?.id).toBe(id);
    await closeBuild(id, { status: 'success', bytes: 0, lines: 0, checksumActual: null, error: null });
    expect(await liveBuildOf('pageviews-user')).toBeNull();
  });

  it('closes the stopped builds of one dump only when asked for that dump', async () => {
    const other = await openBuild(file(50, { key: 'enwiki-page' }), 'stream', null, 'server:fixture');
    const mine = await openBuild(file(51, { key: 'enwiki-page-props' }), 'stream', null, 'server:fixture');
    await pool.query("UPDATE dump_builds SET heartbeat_at = NULL WHERE id = ANY($1)", [[other, mine]]);
    await closeOrphanedBuilds({ dump: 'enwiki-page-props' });
    expect(await row(mine)).toMatchObject({ status: 'failed' });
    expect(await row(other)).toMatchObject({ status: 'running' });
    await closeOrphanedBuilds();
  });

  it('closes at once the running rows its own runner left, and leaves another runner\'s beating one (#1463)', async () => {
    const mine = await openBuild(file(60, { key: 'enwiki-page' }), 'local', null, 'server:fixture-host');
    const theirs = await openBuild(file(61, { key: 'enwiki-categorylinks' }), 'local', null, 'script:fixture');
    await closeOrphanedBuilds({ runner: 'server:fixture-host' });
    expect(await row(mine)).toMatchObject({ status: 'failed' });
    expect(await row(theirs)).toMatchObject({ status: 'running' });
    await closeBuild(theirs, { status: 'cancelled', bytes: 0, lines: 0, checksumActual: null, error: 'fixture' });
  });

  it('refuses a second running build of a dump, whatever process opens it', async () => {
    const first = await openBuild(file(70, { key: 'enwiki-page' }), 'local', null, 'script:fixture');
    await expect(openBuild(file(71, { key: 'enwiki-page' }), 'local', null, 'server:fixture')).rejects.toBeInstanceOf(BuildAlreadyRunning);
    await closeBuild(first, { status: 'success', bytes: 0, lines: 0, checksumActual: null, error: null });
    const next = await openBuild(file(72, { key: 'enwiki-page' }), 'local', null, 'server:fixture');
    await closeBuild(next, { status: 'success', bytes: 0, lines: 0, checksumActual: null, error: null });
  });

  it('refuses a status or a mode the ledger does not know', async () => {
    const id = await openBuild(file(30), 'stream', null, 'server:fixture');
    await expect(pool.query("UPDATE dump_builds SET status = 'half' WHERE id = $1", [id])).rejects.toThrow(/check constraint/);
    await expect(pool.query("UPDATE dump_builds SET mode = 'copy' WHERE id = $1", [id])).rejects.toThrow(/check constraint/);
  });
});
