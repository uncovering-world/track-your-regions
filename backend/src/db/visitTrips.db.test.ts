/**
 * A visit's trips, each with an approximate date (#2120, ADR-0202), against
 * PostgreSQL: the Uffizi with a trip in March 2022 and one in 2015, as the
 * place's card lists them. A trip is its traveller's alone: another
 * traveller's id answers 404. Unticking the place takes its trips with it,
 * and the untick's Undo puts both back, a trip added while the untick waited
 * for the visit among them. Ids are the fixture's own, deleted before and
 * after; the dependants cascade.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from './index.js';
import { MEMBERSHIPS } from './membership.js';
import { unmarkVisited } from '../controllers/experience/experienceVisitController.js';
import { addTrip, changeTrip, getTrips, removeTrip, restoreVisits } from '../controllers/experience/tripController.js';
import {
  RESTORE_LIMITS, TOO_MANY_TRIPS, TOO_MUCH_TO_UNDO, TRIPS_PER_VISIT, restoreVisitsBodySchema,
} from '../types/trips.js';

const UFFIZI = 9461;
const TRAVELLER = '00000000-0000-4000-8000-000000009461';
const OTHER = '00000000-0000-4000-8000-000000009462';

let travellerId = 0;
let otherId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [UFFIZI]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[TRAVELLER, OTHER]]);
}

const caller = (id: number) => ({ id, role: 'user' }) as Express.User;
const date = (year: number | null, month: number | null = null, day: number | null = null) => ({ year, month, day });
const add = (who: number, d: ReturnType<typeof date>) =>
  addTrip({ params: { experienceId: UFFIZI }, body: d, caller: caller(who) });
/** More undated trips on a visit than adding allows, as a merge can leave one. */
const fill = (tripId: number, more: number) => pool.query(
  `INSERT INTO user_visit_trips (visit_id) SELECT visit_id FROM user_visit_trips, generate_series(1, $2::int) WHERE id = $1`,
  [tripId, more],
);
/** Waits until a statement of another connection waits for a lock the backend `pid` holds. */
async function blockedBy(pid: number): Promise<void> {
  for (let tries = 0; tries < 250; tries += 1) {
    const { rows: [{ waiting }] } = await pool.query<{ waiting: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting', [pid],
    );
    if (waiting) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`nothing waited for backend ${pid}`);
}
const dates = async (who: number) =>
  (await getTrips({ params: { experienceId: UFFIZI }, caller: caller(who) })).trips.map(t => [t.year, t.month, t.day]);

beforeEach(async () => {
  await clear();
  [travellerId, otherId] = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user'), ($2, 'Another', 'user') RETURNING id`,
    [TRAVELLER, OTHER],
  )).rows.map(row => row.id);
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Uffizi Gallery (trips fixture)', ST_SetSRID(ST_MakePoint(11.2553, 43.7678), 4326)
       FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [UFFIZI, `Q${UFFIZI}001`],
  );
  await pool.query(
    `INSERT INTO ${MEMBERSHIPS} (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [UFFIZI, `Q${UFFIZI}001`],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a visit's trips (#2120)", () => {
  it('ticks the place with its first trip, and lists the trips newest first, an undated one last', async () => {
    await add(travellerId, date(2015));
    await add(travellerId, date(null));
    await add(travellerId, date(2022, 3));

    const answer = await getTrips({ params: { experienceId: UFFIZI }, caller: caller(travellerId) });
    expect(answer.visited).toBe(true);
    expect(await dates(travellerId)).toEqual([[2022, 3, null], [2015, null, null], [null, null, null]]);
  });

  it('changes a date in place, and keeps the visit when the last trip goes', async () => {
    const { trip } = await add(travellerId, date(2015));
    await changeTrip({ params: { tripId: trip.id }, body: date(2015, 5), caller: caller(travellerId) });
    expect(await dates(travellerId)).toEqual([[2015, 5, null]]);

    await removeTrip({ params: { tripId: trip.id }, caller: caller(travellerId) });
    const answer = await getTrips({ params: { experienceId: UFFIZI }, caller: caller(travellerId) });
    expect(answer).toMatchObject({ visited: true, trips: [] });
  });

  it("answers 404 for another traveller's trip, and changes nothing", async () => {
    const { trip } = await add(travellerId, date(2022, 3));

    await expect(changeTrip({ params: { tripId: trip.id }, body: date(1999), caller: caller(otherId) }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(removeTrip({ params: { tripId: trip.id }, caller: caller(otherId) }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await dates(travellerId)).toEqual([[2022, 3, null]]);
    expect(await getTrips({ params: { experienceId: UFFIZI }, caller: caller(otherId) }))
      .toMatchObject({ visited: false, trips: [] });
  });

  it('takes a trip up to the 365th, and refuses the next in words', async () => {
    const { trip } = await add(travellerId, date(2000));
    await pool.query(
      `INSERT INTO user_visit_trips (visit_id, year) SELECT visit_id, 2001 FROM user_visit_trips, generate_series(1, $2::int)
        WHERE id = $1`,
      [trip.id, TRIPS_PER_VISIT - 2],
    );
    await add(travellerId, date(2002));

    await expect(add(travellerId, date(2003))).rejects.toMatchObject({ statusCode: 400, message: TOO_MANY_TRIPS });
    expect(await dates(travellerId)).toHaveLength(TRIPS_PER_VISIT);
  });

  it('refuses a day the month does not have', async () => {
    const { trip } = await add(travellerId, date(2023, 2));
    await expect(pool.query('UPDATE user_visit_trips SET day = 29 WHERE id = $1', [trip.id])).rejects.toThrow();
  });

  it('gives the untick its trips back, and its Undo restores the visit with them', async () => {
    await add(travellerId, date(2022, 3));
    await add(travellerId, date(2015));

    const answer = await unmarkVisited({ params: { experienceId: UFFIZI }, caller: caller(travellerId) });
    expect(answer.removed).toEqual([expect.objectContaining({
      experienceId: UFFIZI, trips: [date(2022, 3), date(2015)],
    })]);
    expect((await getTrips({ params: { experienceId: UFFIZI }, caller: caller(travellerId) })).visited).toBe(false);

    await restoreVisits({ body: { visits: answer.removed }, caller: caller(travellerId) });
    expect(await dates(travellerId)).toEqual([[2022, 3, null], [2015, null, null]]);
  });

  it('gives back a trip added while the untick waited for the visit, and its Undo restores it', async () => {
    await add(travellerId, date(2015));

    // The second trip added by the real addTrip on a connection whose
    // transaction stays open, holding the visit row its upsert wrote.
    const adding = await pool.connect();
    const spy = vi.spyOn(pool, 'query');
    try {
      await adding.query('BEGIN');
      const { rows: [{ pid }] } = await adding.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      spy.mockImplementationOnce(((text: string, values: unknown[]) => adding.query(text, values)) as never);
      await add(travellerId, date(2022, 3));

      const unticking = unmarkVisited({ params: { experienceId: UFFIZI }, caller: caller(travellerId) });
      await blockedBy(pid);
      await adding.query('COMMIT');
      const answer = await unticking;

      expect(answer.removed).toEqual([expect.objectContaining({
        experienceId: UFFIZI, trips: [date(2022, 3), date(2015)],
      })]);
      expect((await getTrips({ params: { experienceId: UFFIZI }, caller: caller(travellerId) })).visited).toBe(false);
      await restoreVisits({ body: { visits: answer.removed }, caller: caller(travellerId) });
      expect(await dates(travellerId)).toEqual([[2022, 3, null], [2015, null, null]]);
    } finally {
      spy.mockRestore();
      await adding.query('ROLLBACK');
      adding.release();
    }
  });

  it('removes a visit holding as many trips as an Undo puts back, and restores it whole', async () => {
    const { trip } = await add(travellerId, date(2000));
    await fill(trip.id, RESTORE_LIMITS.trips - 1);

    const answer = await unmarkVisited({ params: { experienceId: UFFIZI }, caller: caller(travellerId) });
    expect(answer.removed[0].trips).toHaveLength(RESTORE_LIMITS.trips);
    await restoreVisits({ body: restoreVisitsBodySchema.parse({ visits: answer.removed }), caller: caller(travellerId) });
    expect(await dates(travellerId)).toHaveLength(RESTORE_LIMITS.trips);
  });

  it('deletes nothing where the removal would take more than an Undo puts back, and says what to do', async () => {
    const { trip } = await add(travellerId, date(2000));
    await fill(trip.id, RESTORE_LIMITS.trips);

    await expect(unmarkVisited({ params: { experienceId: UFFIZI }, caller: caller(travellerId) }))
      .rejects.toMatchObject({ statusCode: 400, message: TOO_MUCH_TO_UNDO });
    expect(await dates(travellerId)).toHaveLength(RESTORE_LIMITS.trips + 1);
  });
});
