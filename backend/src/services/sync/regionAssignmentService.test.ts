/**
 * Which points region assignment is allowed to place.
 *
 * A point the source withdrew keeps its row now, and the row still carries a
 * coordinate that falls inside a region. Placed anyway, it would hold its
 * experience in a list the reader can no longer see it in — the withdrawn
 * point voting on where the object is.
 *
 * The manual assignments already on such a row are a different matter and are
 * left alone: this function only ever clears and rebuilds `auto` rows, so a
 * curator's claim outlives everything here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { assignExperiencesToRegions, assignRegionsForExperiences } from './regionAssignmentService.js';

const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function fakeClient() {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { client, statements };
}

describe('assignRegionsForExperiences', () => {
  beforeEach(() => {
    mockedConnect.mockReset();
  });

  it('places the points still on offer, and not the ones a run withdrew', async () => {
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await assignRegionsForExperiences([42], 1);

    const containment = statements.find(s => /ST_Contains/.test(s));
    expect(containment).toBeDefined();
    expect(containment).toMatch(/el\.missing_since IS NULL/);
  });

  it('still clears the auto rows of a withdrawn point, so it stops voting', async () => {
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await assignRegionsForExperiences([42], 1);

    // The clear is deliberately unfiltered: a point withdrawn *since* the last
    // placement has auto rows from when it was offered, and leaving them would
    // keep the experience in that region for ever.
    const clear = statements.find(s => /DELETE FROM experience_location_regions/.test(s));
    expect(clear).toBeDefined();
    expect(clear).not.toMatch(/missing_since/);
  });
});

describe('assignExperiencesToRegions', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('places the points still on offer on the full-rebuild path too', async () => {
    // The other entry point places what one run moved; this one rebuilds a
    // whole world view, and an admin reaches for it exactly when the
    // assignments are already wrong. A withdrawn point voting there would put
    // its experience back into a region no reader can see it in.
    await assignExperiencesToRegions(4242);

    const sent = mockedQuery.mock.calls.map(call => String(call[0]));
    const containment = sent.find(s => /ST_Contains/.test(s));
    expect(containment).toBeDefined();
    expect(containment).toMatch(/el\.missing_since IS NULL/);
  });
});
