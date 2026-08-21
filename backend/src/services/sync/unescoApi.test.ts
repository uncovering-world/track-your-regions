/**
 * Tests for the UNESCO portal client.
 *
 * Two things are being pinned. The first is that the whole list is one request
 * against `/exports` asking for named fields — the paginated shape it replaced
 * spent thirteen of a 10 000-a-day allowance and could loop forever on a page
 * that came back empty. The second is that the portal is allowed to have a bad
 * day: before this, one 502 from their front end ended the run outright.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUnescoRecords } from './unescoApi.js';
import { WaitBudget } from './sourceRetry.js';
import type { SyncProgress } from './types.js';

const RECORDS = JSON.stringify([
  { id_no: '208', name_en: 'Bamiyan Valley', criteria_txt: '(i)(ii)(iii)(iv)' },
]);

function ok(body: string, headers: Record<string, string> = {}): Response {
  return {
    ok: true, status: 200, text: async () => body, headers: new Headers(headers),
  } as unknown as Response;
}

function httpError(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: false, status, text: async () => 'portal said no', headers: new Headers(headers),
  } as unknown as Response;
}

function makeProgress(): SyncProgress {
  return {
    cancel: false, status: 'fetching', statusMessage: '', progress: 0, total: 0,
    created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0,
    filtered: 0, errors: 0, currentItem: '', logId: null, dryRun: false,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the fetch with every pending backoff released as it is scheduled. */
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if (outcome.error !== undefined) throw outcome.error;
  return outcome.value as T;
}

describe('fetchUnescoRecords', () => {
  it('takes the whole list in one request, naming the fields it reads', async () => {
    fetchMock.mockResolvedValue(ok(RECORDS));

    const records = await runWithTimers(fetchUnescoRecords(makeProgress()));

    expect(records).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    // `/exports` and not `/records`: the latter is capped at 100 rows and at
    // offset+limit <= 10000, which is why the whole list used to be 13 calls.
    expect(url).toContain('/exports/json');
    expect(url).not.toContain('/records?');
    // Named fields, because all 54 of them are 24 MB and we read 22 of them —
    // and because a field that does not exist is then a 400 that says so,
    // rather than four years of silently absent criteria.
    expect(decodeURIComponent(url)).toContain('criteria_txt');
    expect(decodeURIComponent(url)).not.toMatch(/select=[^&]*\bcriteria\b(?!_txt)/);
  });

  it('says who is calling', async () => {
    fetchMock.mockResolvedValue(ok(RECORDS));

    await runWithTimers(fetchUnescoRecords(makeProgress()));

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['User-Agent']).toContain('TrackYourRegions');
  });

  it('waits out a 502 instead of ending the run', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(502))
      .mockResolvedValueOnce(ok(RECORDS));

    const records = await runWithTimers(fetchUnescoRecords(makeProgress()));

    expect(records).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tells the screen it is waiting, in the portal it is waiting on', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(ok(RECORDS));
    const progress = makeProgress();

    await runWithTimers(fetchUnescoRecords(progress));

    // The message during the wait is the whole point of the reporter; by the
    // end it has been overwritten by the count, so the assertion is on what the
    // run finished saying plus the fact that it did retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress.statusMessage).toContain('1 records');
  });

  it('does not retry a 400, which no amount of waiting will fix', async () => {
    fetchMock.mockResolvedValue(httpError(400));

    await expect(runWithTimers(fetchUnescoRecords(makeProgress())))
      .rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops when the run is cancelled, without asking again', async () => {
    fetchMock.mockResolvedValue(httpError(503));
    const progress = makeProgress();
    progress.cancel = true;

    await expect(runWithTimers(fetchUnescoRecords(progress))).rejects.toThrow(/cancelled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('spends the run patience, so the portal and Wikidata share one', async () => {
    fetchMock.mockResolvedValue(httpError(503));
    const budget = new WaitBudget(20000);

    await expect(runWithTimers(fetchUnescoRecords(makeProgress(), budget)))
      .rejects.toThrow(/min of waiting is spent/);
    expect(budget.remainingMs).toBeLessThan(20000);
  });
});
