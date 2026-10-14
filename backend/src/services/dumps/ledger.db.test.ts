import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import type { DumpFile } from './catalog.js';
import {
  activeBuildOf, beat, BuildAlreadyRunning, claimNextBuild, closeBuild, closeOrphanedBuilds, enqueueBuild,
  recentBuilds, recordFile, requestCancel,
} from './ledger.js';

/**
 * The dump build ledger against PostgreSQL (ADR-0101 decision 3, ADR-0106):
 * a build is queued, taken by one worker, followed through its heartbeat and
 * progress, stopped through its row, and closed with its outcome; at most one
 * build of a dump is queued or running; a build whose process stopped is
 * closed as failed. The cases use every dump but the entities one, whose rows
 * the subset build's spec holds, and clear them before and after each case.
 */

const clear = () => pool.query("DELETE FROM dump_builds WHERE dump <> 'wikidata-entities'");
beforeEach(clear);
afterAll(clear);

const file = (n: number, over: Partial<DumpFile> = {}): DumpFile => ({
  key: 'wikidata-lexemes', fileName: `wikidata-2026100${n}-lexemes.json.gz`, url: `https://dumps.wikimedia.org/fixture-${n}.json.gz`,
  date: '2026-10-07', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 1000, compression: 'gzip', ...over,
});

const row = async (id: number) => (await pool.query('SELECT * FROM dump_builds WHERE id = $1', [id])).rows[0];
const progress = { phase: 'reading' as const, message: 'Reading...', downloaded: 10, read: 5, lines: 2 };

/** A build queued and taken by `runner`, as the worker takes one. */
async function running(dump: string, runner = 'worker:fixture'): Promise<number> {
  await enqueueBuild(dump, 'local', { kind: 'verify' }, null);
  const claimed = await claimNextBuild(runner);
  return claimed!.id;
}

describe('the dump build ledger (ADR-0106)', () => {
  it('queues a build with what was asked for, and refuses a second one of the same dump', async () => {
    const id = await enqueueBuild('wikidata-lexemes', 'local', { kind: 'verify', only: 'wikidata-20261005-lexemes.json.gz' }, null);
    expect(await row(id)).toMatchObject({ status: 'queued', file_name: null, request: { kind: 'verify', only: 'wikidata-20261005-lexemes.json.gz' } });
    await expect(enqueueBuild('wikidata-lexemes', 'local', { kind: 'verify' }, null)).rejects.toBeInstanceOf(BuildAlreadyRunning);
    expect((await activeBuildOf('wikidata-lexemes'))?.id).toBe(id);
  });

  it('lets one worker take the oldest queued build, and no other take it again', async () => {
    const first = await enqueueBuild('enwiki-page', 'local', { kind: 'verify' }, null);
    const second = await enqueueBuild('enwiki-langlinks', 'local', { kind: 'verify' }, null);
    expect(await claimNextBuild('worker:a')).toMatchObject({ id: first, dump: 'enwiki-page', request: { kind: 'verify' } });
    expect(await claimNextBuild('worker:b')).toMatchObject({ id: second });
    expect(await claimNextBuild('worker:a')).toBeNull();
    expect(await row(first)).toMatchObject({ status: 'running', runner: 'worker:a' });
  });

  it('records the file, the progress and the heartbeat, and closes the build with what was read', async () => {
    const id = await running('wikidata-lexemes');
    await recordFile(id, file(1));
    expect(await beat(id, progress)).toEqual({ cancelRequested: false });
    expect(await row(id)).toMatchObject({ file_name: 'wikidata-20261001-lexemes.json.gz', checksum_expected: 'a'.repeat(40), progress });
    await closeBuild(id, { status: 'success', bytes: 1000, lines: 42, checksumActual: 'a'.repeat(40), error: null });
    expect(await row(id)).toMatchObject({ status: 'success', bytes: '1000', lines: '42' });
    expect(await activeBuildOf('wikidata-lexemes')).toBeNull();
  });

  it('closes a queued build at once on a cancel, and tells a running one at its next heartbeat', async () => {
    const queued = await enqueueBuild('enwiki-page', 'local', { kind: 'verify' }, null);
    expect(await requestCancel('enwiki-page')).toBe(true);
    expect(await row(queued)).toMatchObject({ status: 'cancelled' });
    const id = await running('enwiki-page');
    expect(await requestCancel('enwiki-page')).toBe(true);
    expect(await beat(id, progress)).toEqual({ cancelRequested: true });
    expect(await requestCancel('pageviews-user')).toBe(false);
  });

  it('closes a build that stopped beating, or that the starting runner left, and nothing else', async () => {
    const stale = await running('enwiki-page', 'worker:gone');
    await pool.query("UPDATE dump_builds SET heartbeat_at = NOW() - interval '6 minutes' WHERE id = $1", [stale]);
    const mine = await running('enwiki-langlinks', 'worker:me');
    const theirs = await running('enwiki-categorylinks', 'script:fixture');
    const queued = await enqueueBuild('enwiki-page-props', 'local', { kind: 'verify' }, null);
    expect(await closeOrphanedBuilds({ runner: 'worker:me' })).toBe(2);
    expect(await row(stale)).toMatchObject({ status: 'failed', error: 'The build stopped: its process ended or restarted.' });
    expect(await row(mine)).toMatchObject({ status: 'failed' });
    expect(await row(theirs)).toMatchObject({ status: 'running' });
    expect(await row(queued)).toMatchObject({ status: 'queued' });
  });

  it('shows the panel the newest three builds of a dump, newest first', async () => {
    const ids: number[] = [];
    for (let n = 0; n < 4; n += 1) {
      const id = await running('enwiki-langlinks');
      await closeBuild(id, { status: 'failed', bytes: 0, lines: 0, checksumActual: null, error: 'fixture' });
      ids.push(id);
    }
    const shown = (await recentBuilds()).filter(build => build.dump === 'enwiki-langlinks').map(build => build.id);
    expect(shown).toEqual([ids[3], ids[2], ids[1]]);
  });

  it('refuses a status or a mode the ledger does not know', async () => {
    const id = await enqueueBuild('wikidata-lexemes', 'stream', { kind: 'verify' }, null);
    await expect(pool.query("UPDATE dump_builds SET status = 'half' WHERE id = $1", [id])).rejects.toThrow(/check constraint/);
    await expect(pool.query("UPDATE dump_builds SET mode = 'copy' WHERE id = $1", [id])).rejects.toThrow(/check constraint/);
  });
});
