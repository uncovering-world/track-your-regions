import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { outerDaysOf, periodOf, type PlaceDate } from '@tyr/shared/lifetime';
import { pool } from './index.js';
import { lockExperience, type LockedExperience } from './experienceWriter.js';
import { writePlacePeriods, writeRecordPeriods, type SourcedDate, type SourcedPeriod } from './placePeriodsWriter.js';

/**
 * A place's periods written under its lock (#2578, ADR-0217), executed against
 * PostgreSQL.
 *
 * Three places a traveller knows. The Cathedral of Christ the Saviour in
 * Moscow (Q194474) stood from 1883 until it was blown up on 5 December 1931,
 * and stands again since 2000: a trip of 1980 found a swimming pool there.
 * Nelson's Pillar in Dublin (Q2350741) stood from 1809 until 8 March 1966 and
 * was not rebuilt. Göbekli Tepe (Q214944) holds no period at first, and then a
 * use that ended about 7000 BC, which never says the site is gone.
 */

const CATHEDRAL = 9721;
const PILLAR = 9722;
const GOBEKLI = 9723;
const CURATORS = 11;

let source = 0;
let cathedralRecord = 0;
let pillarRecord = 0;

const on = (year: number, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, property: null, statement: null, ...rest,
});
const open = (from: SourcedDate | null): SourcedPeriod => ({ from, ended: false, until: null, ending: null, what: null });
const ended = (from: SourcedDate | null, until: SourcedDate | null, rest: Partial<SourcedPeriod> = {}): SourcedPeriod =>
  ({ from, ended: true, until, ending: null, what: null, ...rest });

const BLOWN_UP = on(1931, { month: 12, day: 5, property: 'P576', statement: 'Q194474$0D2C1E7A-2' });
const CATHEDRAL_STOOD = [
  ended(on(1883, { property: 'P1619', statement: 'Q194474$0D2C1E7A-1' }), BLOWN_UP, { ending: 'destroyed' }),
  open(on(2000, { property: 'P571' })),
];
const PILLAR_STOOD = [ended(on(1809), on(1966, { month: 3, day: 8 }), { ending: 'destroyed' })];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[CATHEDRAL, PILLAR, GOBEKLI]]);
}

async function place(id: number, name: string, qid: string): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(37.6, 55.74), 4326))`,
    [id, source, qid, name],
  );
  const record = await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.id = $3 RETURNING id`,
    [id, qid, source],
  );
  return record.rows[0].id;
}

/** Run `write` in a transaction holding `id`'s lock, and commit it. */
async function underLock(id: number, write: (client: import('pg').PoolClient, lock: LockedExperience) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, id);
    if (!locked) throw new Error(`no place ${id}`);
    await write(client, locked.lock);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const stood = (id: number, periods: readonly SourcedPeriod[], sourceId = source) => underLock(id, (client, lock) =>
  writePlacePeriods(client, lock, 'stood', periods, { sourceId, decidedBy: null }));

const placePeriods = async (id: number) => (await pool.query(
  `SELECT says, ordinal, from_year, ended, until_year, until_month, until_day, ending, from_first, until_last, source_id
     FROM place_periods WHERE experience_id = $1 ORDER BY says, ordinal`, [id],
)).rows;
const recordPeriods = async (recordId: number) => (await pool.query(
  'SELECT says, ordinal, from_year, ended, until_year, until_property FROM record_periods WHERE record_id = $1 ORDER BY says, ordinal',
  [recordId],
)).rows;
const standsToday = async (id: number) => (await pool.query<{ stands_today: boolean }>(
  'SELECT stands_today FROM experiences WHERE id = $1', [id],
)).rows[0].stands_today;

/**
 * Whether a place is offered for a trip dated to the days `first` to `last`,
 * as a read as of a date asks the stored outer days (ADR-0217 decision 6):
 * it holds no standing period, or one the trip may fall inside.
 */
const offeredOn = async (id: number, trip: PlaceDate) => {
  const days = periodOf(trip);
  return (await pool.query<{ offered: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = $1 AND p.says = 'stood')
         OR EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = $1 AND p.says = 'stood'
                     AND (p.from_first IS NULL OR p.from_first <= $3)
                     AND (NOT p.ended OR p.until_last IS NULL OR p.until_last >= $2)) AS offered`,
    [id, days?.first, days?.last],
  )).rows[0].offered;
};

beforeEach(async () => {
  await clear();
  source = (await pool.query<{ id: number }>("SELECT id FROM experience_sources WHERE name = 'Monuments & memorials'")).rows[0].id;
  cathedralRecord = await place(CATHEDRAL, 'Cathedral of Christ the Saviour', 'Q194474');
  pillarRecord = await place(PILLAR, 'Nelson\'s Pillar', 'Q2350741');
  await place(GOBEKLI, 'Göbekli Tepe', 'Q214944');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a place\'s standing periods (#2578)', () => {
  it('holds the gap of a place destroyed and rebuilt, which stands today', async () => {
    await stood(CATHEDRAL, CATHEDRAL_STOOD);
    const days = CATHEDRAL_STOOD.map(outerDaysOf);
    expect(await placePeriods(CATHEDRAL)).toEqual([
      { says: 'stood', ordinal: 1, from_year: 1883, ended: true, until_year: 1931, until_month: 12, until_day: 5,
        ending: 'destroyed', from_first: days[0].fromFirst, until_last: days[0].untilLast, source_id: source },
      { says: 'stood', ordinal: 2, from_year: 2000, ended: false, until_year: null, until_month: null, until_day: null,
        ending: null, from_first: days[1].fromFirst, until_last: null, source_id: source },
    ]);
    expect(await standsToday(CATHEDRAL)).toBe(true);
    // Nobody stood in the cathedral in 1980; a trip of 1925 or of 2010 finds it.
    expect(await offeredOn(CATHEDRAL, on(1980))).toBe(false);
    expect(await offeredOn(CATHEDRAL, on(1925))).toBe(true);
    expect(await offeredOn(CATHEDRAL, on(2010))).toBe(true);
    // The year it was blown up, and the year it reopened, do not settle the question.
    expect(await offeredOn(CATHEDRAL, on(1931))).toBe(true);
    expect(await offeredOn(CATHEDRAL, on(2000))).toBe(true);
  });

  it('reads a place with standing periods and none open as gone', async () => {
    await stood(PILLAR, PILLAR_STOOD);
    expect(await standsToday(PILLAR)).toBe(false);
    expect(await offeredOn(PILLAR, on(1965))).toBe(true);
    expect(await offeredOn(PILLAR, on(1967))).toBe(false);
  });

  it('reads a place with no period as standing, and one whose only period is a use that ended', async () => {
    expect(await standsToday(GOBEKLI)).toBe(true);
    await underLock(GOBEKLI, (client, lock) => writePlacePeriods(client, lock, 'used', [
      ended(null, on(-7000, { span: 'millennium', circa: true, property: 'P576' })),
    ], { sourceId: source, decidedBy: null }));
    expect(await placePeriods(GOBEKLI)).toMatchObject([{ says: 'used', ordinal: 1, from_year: null, ended: true, until_year: -7000 }]);
    expect(await standsToday(GOBEKLI)).toBe(true);
    expect(await offeredOn(GOBEKLI, on(2019))).toBe(true);
  });

  it('holds an end with no date: gone, and when is not known', async () => {
    await stood(PILLAR, [ended(null, null)], CURATORS);
    expect(await placePeriods(PILLAR)).toMatchObject([
      { says: 'stood', from_year: null, ended: true, until_year: null, from_first: null, until_last: null, source_id: CURATORS },
    ]);
    expect(await standsToday(PILLAR)).toBe(false);
    // A date that does not settle the question offers the place.
    expect(await offeredOn(PILLAR, on(1950))).toBe(true);
  });

  it('follows the periods through every rewrite: a gap filled in, taken back, an end, and none', async () => {
    await stood(CATHEDRAL, [open(on(1883))]);
    expect(await standsToday(CATHEDRAL)).toBe(true);
    await stood(CATHEDRAL, CATHEDRAL_STOOD);
    expect(await standsToday(CATHEDRAL)).toBe(true);
    await stood(CATHEDRAL, [open(on(1883))]);
    expect(await placePeriods(CATHEDRAL)).toMatchObject([{ ordinal: 1, from_year: 1883, ended: false }]);
    expect(await standsToday(CATHEDRAL)).toBe(true);
    await stood(CATHEDRAL, [CATHEDRAL_STOOD[0]]);
    expect(await standsToday(CATHEDRAL)).toBe(false);
    await stood(CATHEDRAL, []);
    expect(await placePeriods(CATHEDRAL)).toEqual([]);
    expect(await standsToday(CATHEDRAL)).toBe(true);
  });

  it('rewrites no row of a list written as it stands', async () => {
    const versions = async () => (await pool.query(
      'SELECT ordinal, xmin::text AS version, updated_at FROM place_periods WHERE experience_id = $1 ORDER BY ordinal', [CATHEDRAL],
    )).rows;
    await stood(CATHEDRAL, CATHEDRAL_STOOD);
    const before = await versions();
    await stood(CATHEDRAL, CATHEDRAL_STOOD);
    expect(await versions()).toEqual(before);
    // The same periods taken from a curator are another view of them, and are written.
    await stood(CATHEDRAL, CATHEDRAL_STOOD, CURATORS);
    expect(await placePeriods(CATHEDRAL)).toMatchObject([{ source_id: CURATORS }, { source_id: CURATORS }]);
  });

  it('refuses a list the rule refuses before the table sees it, and keeps what the place held', async () => {
    await stood(PILLAR, PILLAR_STOOD);
    const held = await placePeriods(PILLAR);
    await expect(stood(PILLAR, [ended(on(1809), on(1966)), open(on(1950))])).rejects.toThrow(/two periods overlap/);
    await expect(stood(PILLAR, [open(on(1809)), open(on(1990))])).rejects.toThrow(/not ended is followed/);
    await expect(stood(PILLAR, [ended(on(1900, { month: 2, day: 29 }), null)])).rejects.toThrow(/not a date/);
    await expect(stood(PILLAR, [{ ...open(on(1809)), ending: 'destroyed' }])).rejects.toThrow(/only a standing period that ended/);
    await expect(stood(PILLAR, [{ ...ended(on(1809), null), what: 'a column' }])).rejects.toThrow(/only a use or a closure is named/);
    expect(await placePeriods(PILLAR)).toEqual(held);
  });

  it('holds the shape in the schema too, for a write that does not come through the writer', async () => {
    const insert = (columns: Record<string, unknown>) => {
      const row = { experience_id: PILLAR, says: 'stood', ordinal: 1, source_id: source, ...columns };
      const names = Object.keys(row);
      const places = names.map((_, index) => `$${index + 1}`).join(', ');
      return pool.query(`INSERT INTO place_periods (${names.join(', ')}) VALUES (${places})`, Object.values(row));
    };
    // An end date on a period that has not ended, a day with no month, a span beside a month, year zero.
    await expect(insert({ until_year: 1966, until_last: 1 })).rejects.toThrow(/place_periods_period/);
    await expect(insert({ from_year: 1809, from_day: 5, from_first: 1 })).rejects.toThrow(/place_periods_period/);
    await expect(insert({ from_year: 1880, from_month: 3, from_span: 'decade', from_first: 1 })).rejects.toThrow(/place_periods_period/);
    await expect(insert({ from_year: 0, from_first: 1 })).rejects.toThrow(/place_periods_period/);
    // An outer day without its date, a date without its outer day, and a start after its end.
    await expect(insert({ from_first: 1 })).rejects.toThrow(/place_periods_period/);
    await expect(insert({ from_year: 1809 })).rejects.toThrow(/place_periods_period/);
    await expect(insert({ from_year: 1966, from_first: 9, ended: true, until_year: 1809, until_last: 1 })).rejects.toThrow(/place_periods_period/);
    // How it ended on a period still open, a name on a standing period, a word the vocabulary lacks.
    await expect(insert({ ending: 'destroyed' })).rejects.toThrow(/place_periods_ending_of_standing/);
    await expect(insert({ what: 'a column' })).rejects.toThrow(/place_periods_what_of_use/);
    await expect(insert({ says: 'rebuilt' })).rejects.toThrow(/check/);
    // Two open standing periods on one place.
    await insert({});
    await expect(insert({ ordinal: 2 })).rejects.toThrow(/idx_place_periods_standing/);
  });
});

describe('experiences.stands_today (#2578, ADR-0217 decision 5)', () => {
  it('is written by nothing but its trigger', async () => {
    await stood(PILLAR, PILLAR_STOOD);
    await expect(pool.query('UPDATE experiences SET stands_today = true WHERE id = $1', [PILLAR])).rejects.toThrow(/derived from place_periods/);
    await expect(pool.query('UPDATE experiences SET stands_today = false WHERE id = $1', [CATHEDRAL])).rejects.toThrow(/derived from place_periods/);
    await expect(pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location, stands_today)
       VALUES ($1, $2, 'Q9724001', 'A place born gone', ST_SetSRID(ST_MakePoint(0, 0), 4326), false)`, [9724, source],
    )).rejects.toThrow(/derived from place_periods/);
    expect(await standsToday(PILLAR)).toBe(false);
    // Writing the value it already holds, as a statement that names every column does, is no write of it.
    await pool.query('UPDATE experiences SET stands_today = false WHERE id = $1', [PILLAR]);
  });

  it('follows a period written past the writer, deleted, and moved to another place', async () => {
    await stood(PILLAR, PILLAR_STOOD);
    await pool.query('UPDATE place_periods SET ended = false, until_year = NULL, until_month = NULL, until_day = NULL, until_last = NULL, ending = NULL WHERE experience_id = $1', [PILLAR]);
    expect(await standsToday(PILLAR)).toBe(true);
    await stood(PILLAR, PILLAR_STOOD);
    await pool.query('UPDATE place_periods SET experience_id = $2 WHERE experience_id = $1', [PILLAR, GOBEKLI]);
    expect([await standsToday(PILLAR), await standsToday(GOBEKLI)]).toEqual([true, false]);
    await pool.query('DELETE FROM place_periods WHERE experience_id = $1', [GOBEKLI]);
    expect(await standsToday(GOBEKLI)).toBe(true);
  });
});

describe('a source\'s view of a place\'s periods (#2578, ADR-0084)', () => {
  it('writes the view whole: a list it no longer reports is cleared, and a shorter one loses its tail', async () => {
    const used = [ended(null, on(1931, { property: 'P3999' }))];
    await underLock(CATHEDRAL, (client, lock) => writeRecordPeriods(client, lock, cathedralRecord, { stood: CATHEDRAL_STOOD, used }));
    expect(await recordPeriods(cathedralRecord)).toEqual([
      { says: 'stood', ordinal: 1, from_year: 1883, ended: true, until_year: 1931, until_property: 'P576' },
      { says: 'stood', ordinal: 2, from_year: 2000, ended: false, until_year: null, until_property: null },
      { says: 'used', ordinal: 1, from_year: null, ended: true, until_year: 1931, until_property: 'P3999' },
    ]);
    await underLock(CATHEDRAL, (client, lock) => writeRecordPeriods(client, lock, cathedralRecord, { stood: [open(on(1883))] }));
    expect(await recordPeriods(cathedralRecord)).toEqual([
      { says: 'stood', ordinal: 1, from_year: 1883, ended: false, until_year: null, until_property: null },
    ]);
    await underLock(CATHEDRAL, (client, lock) => writeRecordPeriods(client, lock, cathedralRecord, {}));
    expect(await recordPeriods(cathedralRecord)).toEqual([]);
    // A source's view is not the place's: nothing of it reached the place.
    expect(await placePeriods(CATHEDRAL)).toEqual([]);
    expect(await standsToday(CATHEDRAL)).toBe(true);
  });

  it('leaves the old view as it stood when a list of the new one is refused', async () => {
    await underLock(CATHEDRAL, (client, lock) => writeRecordPeriods(client, lock, cathedralRecord, { stood: CATHEDRAL_STOOD }));
    const held = await recordPeriods(cathedralRecord);
    // The new view rewrites the standing periods and gives the use a 31 April:
    // refused, and nothing of it reaches the table, even for a caller that
    // goes on and commits the rest of its transaction.
    let refused: unknown = null;
    await underLock(CATHEDRAL, async (client, lock) => {
      try {
        await writeRecordPeriods(client, lock, cathedralRecord, {
          stood: [open(on(1883))], used: [ended(null, on(1931, { month: 4, day: 31 }))],
        });
      } catch (error) {
        refused = error;
      }
    });
    expect(refused).toBeInstanceOf(RangeError);
    expect(await recordPeriods(cathedralRecord)).toEqual(held);
  });

  it('refuses to write the view of a record another place holds', async () => {
    await expect(underLock(CATHEDRAL, (client, lock) => writeRecordPeriods(client, lock, pillarRecord, { stood: PILLAR_STOOD })))
      .rejects.toThrow(/is not a record of place/);
    expect(await recordPeriods(pillarRecord)).toEqual([]);
  });

  it('goes with its record, and the place\'s periods with the place', async () => {
    await underLock(PILLAR, async (client, lock) => {
      await writeRecordPeriods(client, lock, pillarRecord, { stood: PILLAR_STOOD });
      await writePlacePeriods(client, lock, 'stood', PILLAR_STOOD, { sourceId: source, decidedBy: null });
    });
    await pool.query('DELETE FROM experiences WHERE id = $1', [PILLAR]);
    expect(await recordPeriods(pillarRecord)).toEqual([]);
    expect(await placePeriods(PILLAR)).toEqual([]);
  });
});
