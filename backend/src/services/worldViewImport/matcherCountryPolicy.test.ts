import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPoolQuery, mockClientQuery, mockPoolConnect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  return {
    mockPoolQuery: vi.fn(),
    mockClientQuery: clientQuery,
    mockPoolConnect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  };
});

vi.mock('../../db/index.js', () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

import { matchCountryLevel } from './matcherCountryPolicy.js';
import { createInitialProgress } from './types.js';

const DIVISIONS = [
  { id: 1, name: 'Europe', name_normalized: 'europe', parent_id: null },
  { id: 2, name: 'France', name_normalized: 'france', parent_id: 1 },
];

const REGIONS = [
  { id: 100, name: 'Europe', parent_region_id: null },
  { id: 101, name: 'France', parent_region_id: 100 },
];

function stubQueries() {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockPoolConnect.mockClear();
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes('administrative_divisions')) return Promise.resolve({ rows: DIVISIONS });
    if (sql.includes('FROM regions')) return Promise.resolve({ rows: REGIONS });
    return Promise.resolve({ rows: [] });
  });
}

describe('matchCountryLevel cancellation', () => {
  beforeEach(stubQueries);

  it('discards pending results instead of committing a partial match set', async () => {
    // The per-node cancel check inside the walk is what *creates* a partial
    // `updates` array, so committing it leaves some regions auto_matched and the
    // rest no_candidates — while runImport takes its cancelled branch and never
    // advances import_runs past 'matching', which the review UI reads as an
    // import still in flight. A partial commit is worse than a whole one.
    const progress = createInitialProgress();
    progress.cancel = true;

    await matchCountryLevel(1, progress);

    expect(mockPoolConnect).not.toHaveBeenCalled();
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(progress.status).toBe('cancelled');
  });

  it('writes inside a transaction when not cancelled', async () => {
    await matchCountryLevel(1, createInitialProgress());

    expect(mockPoolConnect).toHaveBeenCalled();
    expect(mockClientQuery.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(mockClientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
});
