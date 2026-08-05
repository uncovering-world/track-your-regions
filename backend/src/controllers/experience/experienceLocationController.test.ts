/**
 * What a reader is shown once a point can be missing without being deleted.
 *
 * The rule these pin down is the same asymmetry `lost` already has one level
 * up: a point the source stopped offering leaves every list, marker batch and
 * count — exactly as it used to when the row was deleted — but a visit to it
 * survives, because a person who stood there stood there.
 *
 * Asserted on the SQL each handler sends, which is where the predicate either
 * is or is not. The behaviour behind it was checked against the live database;
 * a mocked query cannot tell a correct predicate from a wrong one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  getExperienceLocations,
  getRegionExperienceLocations,
  getExperienceVisitedStatus,
  markAllLocationsVisited,
  unmarkAllLocationsVisited,
  unmarkLocationVisited,
} from './experienceLocationController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/** Every statement the handler sent, in order. */
function sentSql(): string[] {
  return mockedQuery.mock.calls.map(call => String(call[0]));
}

/** The one statement that reads the location table. */
function locationRead(): string {
  const reads = sentSql().filter(sql => /FROM experience_locations/i.test(sql));
  expect(reads).toHaveLength(1);
  return reads[0];
}

describe('reads that show a point', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ id: 1, name: 'Site' }], rowCount: 1 });
  });

  it('leaves a withdrawn point out of an experience own list', async () => {
    await getExperienceLocations({ params: { id: '42' }, query: {} } as never, makeRes() as never);

    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });

  it('leaves a withdrawn point out of the markers a region asks for', async () => {
    await getRegionExperienceLocations(
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    // The marker batch feeds the map. A pin at a point the source withdrew is
    // an invitation to go somewhere that is no longer being offered.
    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });

  it('leaves it out whether or not the region asks for its children', async () => {
    await getRegionExperienceLocations(
      { params: { regionId: '7' }, query: { includeChildren: 'false' } } as never,
      makeRes() as never);

    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });
});

describe('a visit outlives the point', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ location_id: 1, visit_id: 3 }], rowCount: 1 });
  });

  it('counts a reader progress over the points still on offer', async () => {
    await getExperienceVisitedStatus(
      { params: { id: '42' }, user: { id: 5 } } as never, makeRes() as never);

    // Returning a withdrawn point because this reader had visited it puts the
    // same place on screen twice whenever the source replaces one — identity is
    // the point together with its reference, so editing either is a withdrawal
    // plus an insert — and makes
    // this endpoint's denominator disagree with `location_count` everywhere
    // else. The visit row itself is never touched; what it means for a place
    // nobody offers any more is a curator's question, not this endpoint's.
    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
    expect(locationRead()).not.toMatch(/uvl\.id IS NOT NULL/);
  });

  it('marks only the points still on offer when asked to mark them all', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await markAllLocationsVisited(
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    expect(locationRead()).toMatch(/missing_since IS NULL/);
  });

  it('still lets a user take back a visit to a point that was withdrawn', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 });

    await unmarkAllLocationsVisited(
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    // Filtering here would strand the record: the point is invisible, so
    // nothing else could ever clear it.
    const deletes = sentSql().filter(sql => /DELETE FROM user_visited_locations/i.test(sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).not.toMatch(/missing_since/);

    // The count beside it is the half that matters on the region-scoped
    // branch, which clears one region's visits and can leave a withdrawn
    // point's visit standing elsewhere. Unfiltered, unticking the last region
    // a reader can see keeps a `user_visited_experiences` row the progress
    // view contradicts.
    const counts = sentSql().filter(sql => /COUNT\(\*\) as count/i.test(sql));
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatch(/el\.missing_since IS NULL/);
  });

  it('lets the experience-level record reach zero when the last visible tick goes', async () => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ experience_id: 42, count: '0' }], rowCount: 1 });

    await unmarkLocationVisited(
      { params: { locationId: '7' }, user: { id: 5 } } as never, makeRes() as never);

    // A visit surviving on a withdrawn point would otherwise hold the count at
    // one for ever: the list would keep its check, the progress view would
    // report none visited, and there would be no tick on screen to remove.
    // Before locations were kept, the withdrawn row and its visit went together
    // and this count reached zero on its own.
    const counts = sentSql().filter(sql => /COUNT\(\*\) as count/i.test(sql));
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatch(/el\.missing_since IS NULL/);
  });
});
