/**
 * A removal never deletes what its Undo would refuse (#2120): the delete is
 * held to `RESTORE_LIMITS` inside its own statement, and its answer is the
 * removed visits, a 404 for none, or a 400 in words with nothing deleted.
 */
import { describe, expect, it } from 'vitest';
import { removedVisitsOf, removeVisitsSql, type RemovedVisitRow } from './visits.js';
import { RESTORE_LIMITS, TOO_MUCH_TO_UNDO } from '../types/trips.js';

const none = (visits: number, trips: number): RemovedVisitRow =>
  ({ taken_visits: visits, taken_trips: trips, experience_id: null, marked_at: null, notes: null, rating: null, trips: null });

describe('a removal held to what its Undo puts back', () => {
  it('deletes only while the visits and trips it takes are within the limits', () => {
    const sql = removeVisitsSql('$1::int[]');
    expect(sql).toMatch(new RegExp(
      `DELETE FROM user_visited_experiences[\\s\\S]*taken_visits <= ${RESTORE_LIMITS.visits} AND size\\.taken_trips <= ${RESTORE_LIMITS.trips}`,
    ));
  });

  it('answers the visits removed, at the limit too', () => {
    const at = { ...none(1, RESTORE_LIMITS.trips), experience_id: 9461, trips: [{ year: 2015, month: null, day: null }] };
    expect(removedVisitsOf([at])).toEqual([
      { experienceId: 9461, markedAt: null, notes: null, rating: null, trips: [{ year: 2015, month: null, day: null }] },
    ]);
  });

  it('refuses a removal over either limit in words, and answers 404 where there was nothing', () => {
    for (const over of [none(RESTORE_LIMITS.visits + 1, 0), none(2, RESTORE_LIMITS.trips + 1)]) {
      expect(() => removedVisitsOf([over])).toThrow(expect.objectContaining({ statusCode: 400, message: TOO_MUCH_TO_UNDO }));
    }
    expect(() => removedVisitsOf([none(0, 0)])).toThrow(expect.objectContaining({ statusCode: 404 }));
  });
});
