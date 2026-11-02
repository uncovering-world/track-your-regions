/**
 * When the editions refresh changes nothing and when it fails (#2209): only a
 * subset that is not there, or holds no sitelinks yet, is "nothing to copy";
 * any other failure of the question reaches the run's log.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { pool } from '../../db/index.js';
import { refreshWikipediaEditions } from './wikipediaEditions.js';

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const connect = pool.connect as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe('refreshWikipediaEditions', () => {
  it('changes nothing where the subset is not there', async () => {
    query.mockResolvedValueOnce({ rows: [{ present: false }] });
    expect(await refreshWikipediaEditions()).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('changes nothing where the subset holds no sitelinks yet', async () => {
    query.mockResolvedValueOnce({ rows: [{ present: true }] }).mockResolvedValueOnce({ rows: [{ built: false }] });
    expect(await refreshWikipediaEditions()).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('lets any other failure of the question reach the run, not read it as an empty subset', async () => {
    query.mockResolvedValueOnce({ rows: [{ present: true }] })
      .mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));
    await expect(refreshWikipediaEditions()).rejects.toThrow('statement timeout');
    expect(connect).not.toHaveBeenCalled();
  });

  it('reads what the catalogue links only once it holds the lock', async () => {
    const asked: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        asked.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        return { rows: sql.includes('count(DISTINCT item)') ? [{ items: 0, editions: 0 }] : [] };
      }),
      release: vi.fn(),
    };
    query.mockResolvedValueOnce({ rows: [{ present: true }] }).mockResolvedValueOnce({ rows: [{ built: true }] });
    connect.mockResolvedValue(client);
    await refreshWikipediaEditions();
    expect(asked).toEqual(['BEGIN', 'LOCK TABLE', 'SELECT metadata->>\'wikipediaUrl\'', 'DELETE FROM', 'WITH items', 'COMMIT']);
  });
});
