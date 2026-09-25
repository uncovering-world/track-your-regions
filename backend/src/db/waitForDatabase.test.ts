/**
 * The backend rides out a database that is still starting (#775) and gives up
 * at once on one that is not going to answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForDatabase } from './waitForDatabase.js';

function failure(code: string): Error {
  return Object.assign(new Error(`failed with ${code}`), { code });
}

describe('waitForDatabase', () => {
  const sleep = vi.fn(async () => {});
  beforeEach(() => {
    sleep.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('retries a refusal and a starting-up answer, then returns once the database answers', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(failure('ECONNREFUSED'))
      .mockRejectedValueOnce(failure('57P03'))
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    await waitForDatabase({ query } as never, { sleep });

    expect(query).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws at once on an error waiting will not fix', async () => {
    const query = vi.fn().mockRejectedValueOnce(failure('28P01')); // invalid_password

    await expect(waitForDatabase({ query } as never, { sleep })).rejects.toThrow('failed with 28P01');
    expect(query).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after its last attempt with the last error', async () => {
    const query = vi.fn().mockRejectedValue(failure('ECONNREFUSED'));

    await expect(waitForDatabase({ query } as never, { attempts: 3, sleep })).rejects.toThrow('failed with ECONNREFUSED');
    expect(query).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
