import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../db/index.js';
import { sweepStanding } from './standingSweep.js';

const query = vi.mocked(pool.query);

describe('the standing sweep (#1719)', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('asks the schema to re-derive the places whose opening day has come', async () => {
    query.mockResolvedValueOnce({ rows: [] } as never);
    await sweepStanding();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SELECT refresh_standing_due()');
  });

  it('logs a failure and never throws, so the next hour tries again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    query.mockRejectedValueOnce(new Error('connection lost'));
    await expect(sweepStanding()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Standing sweep failed:', expect.any(Error));
    error.mockRestore();
  });
});
