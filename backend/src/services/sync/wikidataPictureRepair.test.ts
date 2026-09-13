/**
 * Smoke test for the factory itself.
 *
 * The moved bodies are exercised through the museum service today
 * (`museumSyncService.floor.test.ts` and the panel's own fixImages route
 * test) — nothing about what a repair does changed in the move. What is new
 * is the factory boundary, and the one thing worth pinning here is that each
 * instance still guards the same `runningSyncs` entry the panel polls: two
 * sources sharing this file must not be able to start over one another's run,
 * and a source's own repair must still refuse a second start of itself.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db: {},
}));
vi.mock('./pictureRepair.js', () => ({ writeFoundPicture: vi.fn() }));
vi.mock('./museum/queries.js', () => ({ fetchEntityDetails: vi.fn(), isQid: vi.fn() }));
vi.mock('./imageCredit.js', () => ({ fetchCommonsCredits: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('./wikidataUtils.js', () => ({
  delay: vi.fn(),
  WaitBudget: class WaitBudget {},
  SPARQL_DELAY_MS: 0,
  SPARQL_WAIT_BUDGET_MS: 0,
  waitMessage: vi.fn(),
  WIKIDATA_USER_AGENT: 'test',
  wikidataDoor: vi.fn(() => vi.fn()),
}));

import { pool } from '../../db/index.js';
import { runningSyncs } from './types.js';
import { makeWikidataPictureRepair } from './wikidataPictureRepair.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const SOURCE = 99;
const WORSHIP_SOURCE = 100;
const MUSEUM_NOUN = { singular: 'museum', plural: 'museums' };
const WORSHIP_NOUN = { singular: 'place', plural: 'places' };

beforeEach(() => {
  runningSyncs.delete(SOURCE);
  runningSyncs.delete(WORSHIP_SOURCE);
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('makeWikidataPictureRepair', () => {
  it('refuses to start while a run for that source is in runningSyncs', async () => {
    runningSyncs.set(SOURCE, {
      cancel: false, kind: 'sync', status: 'processing', statusMessage: '', progress: 0,
      total: 0, created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0,
      held: 0, filtered: 0, errors: 0, currentItem: '', logId: null, dryRun: false,
    });
    const fixImages = makeWikidataPictureRepair(SOURCE, '[Test Sync]', MUSEUM_NOUN);

    await expect(fixImages(null)).rejects.toThrow('[Test Sync] sync already in progress');
  });

  it('starts once a previous run has reached a terminal status, and clears its own entry after the window', async () => {
    runningSyncs.set(SOURCE, {
      cancel: false, kind: 'repair', status: 'complete', statusMessage: '', progress: 0,
      total: 0, created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0,
      held: 0, filtered: 0, errors: 0, currentItem: '', logId: null, dryRun: false,
    });
    const fixImages = makeWikidataPictureRepair(SOURCE, '[Test Sync]', MUSEUM_NOUN);
    vi.useFakeTimers();

    try {
      // No rows to fix, so this returns right after the guard rather than
      // reaching Wikidata or Commons.
      await fixImages(null);
      expect(runningSyncs.get(SOURCE)?.status).toBe('complete');

      // The `finally` block's cleanup is a timer, not immediate: the entry
      // outlives the call so a poller reading it right after still sees the
      // finished run, and only goes once the window the module gives it passes.
      vi.advanceTimersByTime(30000);
      expect(runningSyncs.has(SOURCE)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the given noun in its status line rather than "museums" for a source like worship', async () => {
    const fixImages = makeWikidataPictureRepair(WORSHIP_SOURCE, '[Worship Sync]', WORSHIP_NOUN);

    // No rows to fix, so this returns right after the empty-result branch,
    // which is where the noun the factory was built with shows up.
    await fixImages(null);

    expect(runningSyncs.get(WORSHIP_SOURCE)?.statusMessage).toBe('All places already have images');
  });
});
