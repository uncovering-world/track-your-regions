/**
 * `annotateClosedSyncLog` marks a run that has already closed and mirrors the
 * mark onto its source, and the two rows are one statement of fact: both
 * admin surfaces read them, and a log marked with the source untouched would
 * have them disagree. These pin that the two updates share one transaction on
 * one client, that a dry run's source is left alone, and that a failure rolls
 * back and hands the rollback's verdict to `release`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(async () => undefined),
}));

import { pool, rollbackQuietly } from '../../db/index.js';
import { annotateClosedSyncLog } from './syncUtils.js';

const mockedPoolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedRollback = rollbackQuietly as unknown as ReturnType<typeof vi.fn>;

const DETAILS = [{ step: 'region assignment', error: 'timed out' }];

function makeClient(isDryRun: boolean) {
  const client = { query: vi.fn(), release: vi.fn() };
  client.query.mockImplementation(async (sql: string) =>
    /RETURNING is_dry_run/.test(sql) ? { rows: [{ is_dry_run: isDryRun }] } : { rows: [] });
  mockedConnect.mockResolvedValue(client);
  return client;
}

const statements = (client: { query: ReturnType<typeof vi.fn> }) =>
  client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/).slice(0, 3).join(' '));

beforeEach(() => {
  mockedPoolQuery.mockReset();
  mockedConnect.mockReset();
  mockedRollback.mockReset().mockResolvedValue(undefined);
});

describe('annotateClosedSyncLog', () => {
  it('marks the log and mirrors the status onto the source in one transaction on one client', async () => {
    const client = makeClient(false);

    await annotateClosedSyncLog(4, 91, 'failed', DETAILS);

    expect(statements(client)).toEqual([
      'BEGIN',
      'UPDATE experience_sync_logs SET',
      'UPDATE experience_sources SET',
      'COMMIT',
    ]);
    expect(mockedPoolQuery).not.toHaveBeenCalled();

    const [logSql, logParams] = client.query.mock.calls[1] as [string, unknown[]];
    expect(logSql).toMatch(/SET status = \$2, error_details = \$3\s+WHERE id = \$1\s+RETURNING is_dry_run/);
    expect(logParams).toEqual([91, 'failed', JSON.stringify(DETAILS)]);

    const [sourceSql, sourceParams] = client.query.mock.calls[2] as [string, unknown[]];
    expect(sourceSql).toMatch(/SET last_sync_status = \$2, last_sync_error = \$3\s+WHERE id = \$1/);
    expect(sourceParams).toEqual([4, 'failed', 'See sync log for details']);

    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('clears the source error for a status that is not a failure', async () => {
    const client = makeClient(false);

    await annotateClosedSyncLog(4, 91, 'partial', DETAILS);

    const [, sourceParams] = client.query.mock.calls[2] as [string, unknown[]];
    expect(sourceParams).toEqual([4, 'partial', null]);
  });

  it('leaves the source alone after a dry run, which synced nothing', async () => {
    const client = makeClient(true);

    await annotateClosedSyncLog(4, 91, 'failed', DETAILS);

    expect(statements(client)).toEqual(['BEGIN', 'UPDATE experience_sync_logs SET', 'COMMIT']);
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('rolls back on a failing statement and hands the rollback verdict to release', async () => {
    const client = makeClient(false);
    const failure = new Error('deadlock detected');
    client.query.mockImplementation(async (sql: string) => {
      if (/UPDATE experience_sources/.test(sql)) throw failure;
      return /RETURNING is_dry_run/.test(sql) ? { rows: [{ is_dry_run: false }] } : { rows: [] };
    });
    const rollbackFailure = new Error('connection gone');
    mockedRollback.mockResolvedValueOnce(rollbackFailure);

    await expect(annotateClosedSyncLog(4, 91, 'failed', DETAILS)).rejects.toBe(failure);

    expect(statements(client)).not.toContain('COMMIT');
    expect(mockedRollback).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
  });
});
