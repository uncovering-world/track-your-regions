import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { lockExperience, type LockedExperience } from './experienceWriter.js';
import { clearPlaceDate, writePlaceDate, writeRecordDates, type SourcedDate } from './placeDatesWriter.js';

/**
 * A place's lifetime written under its lock (#1719, ADR-0214), executed against
 * PostgreSQL.
 *
 * The fixture is Göbekli Tepe as Archaeology holds it: one place and its
 * record (Q214944). Wikidata dates its inception to the 10th millennium BC,
 * circa (−9999 to the millennium), and its end of use to the 7th (−7000).
 * A second place, the Arch of Reunification, stands beside it to own a
 * record the first place's lock must not reach.
 */

const GOBEKLI = 9719;
const ARCH = 9720;
const CURATORS = 11;

let archaeologySource = 0;
let gobekliRecord = 0;
let archRecord = 0;

const sourced = (year: number | null, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, ending: null, property: null, statement: null, ...rest,
});

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[GOBEKLI, ARCH]]);
}

async function place(id: number, name: string, qid: string): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(38.92, 37.22), 4326))`,
    [id, archaeologySource, qid, name],
  );
  const record = await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.id = $3 RETURNING id`,
    [id, qid, archaeologySource],
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

const placeDates = async (id: number) => (await pool.query(
  `SELECT slot, year, month, day, span, circa, ending, source_id, property, statement
     FROM place_dates WHERE experience_id = $1 ORDER BY slot`, [id],
)).rows;
const recordDates = async (recordId: number) => (await pool.query(
  'SELECT slot, year, span, circa, property FROM record_dates WHERE record_id = $1 ORDER BY slot', [recordId],
)).rows;

beforeEach(async () => {
  await clear();
  archaeologySource = (await pool.query<{ id: number }>(
    "SELECT id FROM experience_sources WHERE name = 'Archaeology'",
  )).rows[0].id;
  gobekliRecord = await place(GOBEKLI, 'Göbekli Tepe', 'Q9719001');
  archRecord = await place(ARCH, 'Arch of Reunification', 'Q9719002');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a place\'s dates (#1719)', () => {
  it('holds a BC start to the millennium, circa, and an end of use, with the statement each was read from', async () => {
    await underLock(GOBEKLI, async (client, lock) => {
      await writePlaceDate(client, lock, 'began', {
        ...sourced(-9999, { span: 'millennium', circa: true, property: 'P571', statement: 'Q214944$0D2C1E7A-1' }),
        sourceId: archaeologySource, decidedBy: null,
      });
      await writePlaceDate(client, lock, 'use_ended', {
        ...sourced(-7000, { span: 'millennium', property: 'P576' }), sourceId: archaeologySource, decidedBy: null,
      });
    });
    expect(await placeDates(GOBEKLI)).toEqual([
      { slot: 'began', year: -9999, month: null, day: null, span: 'millennium', circa: true, ending: null,
        source_id: archaeologySource, property: 'P571', statement: 'Q214944$0D2C1E7A-1' },
      { slot: 'use_ended', year: -7000, month: null, day: null, span: 'millennium', circa: false, ending: null,
        source_id: archaeologySource, property: 'P576', statement: null },
    ]);
  });

  it('replaces a slot it writes again, and takes one off', async () => {
    await underLock(ARCH, async (client, lock) => {
      await writePlaceDate(client, lock, 'ended', { ...sourced(2024), sourceId: archaeologySource, decidedBy: null });
      await writePlaceDate(client, lock, 'ended', {
        ...sourced(2024, { month: 1, ending: 'destroyed' }), sourceId: CURATORS, decidedBy: null,
      });
    });
    expect(await placeDates(ARCH)).toMatchObject([{ slot: 'ended', year: 2024, month: 1, ending: 'destroyed', source_id: CURATORS }]);
    let cleared: boolean[] = [];
    await underLock(ARCH, async (client, lock) => {
      cleared = [await clearPlaceDate(client, lock, 'ended'), await clearPlaceDate(client, lock, 'ended')];
    });
    expect(cleared).toEqual([true, false]);
    expect(await placeDates(ARCH)).toEqual([]);
  });

  it('lets only the place\'s end be known with no year', async () => {
    await underLock(ARCH, async (client, lock) => {
      await writePlaceDate(client, lock, 'ended', { ...sourced(null), sourceId: CURATORS, decidedBy: null });
    });
    expect(await placeDates(ARCH)).toMatchObject([{ slot: 'ended', year: null }]);
    await expect(underLock(ARCH, (client, lock) =>
      writePlaceDate(client, lock, 'began', { ...sourced(null), sourceId: CURATORS, decidedBy: null }),
    )).rejects.toThrow(RangeError);
  });

  it('refuses a date the rule refuses before the table sees it: year zero, 29 February 1900, an ending on a start', async () => {
    const write = (slot: 'began' | 'ended', date: SourcedDate) => underLock(GOBEKLI, (client, lock) =>
      writePlaceDate(client, lock, slot, { ...date, sourceId: archaeologySource, decidedBy: null }));
    await expect(write('began', sourced(0))).rejects.toThrow(RangeError);
    await expect(write('began', sourced(1900, { month: 2, day: 29 }))).rejects.toThrow(RangeError);
    await expect(write('began', sourced(1900, { ending: 'destroyed' }))).rejects.toThrow(RangeError);
    expect(await placeDates(GOBEKLI)).toEqual([]);
  });

  it('holds the shape in the schema too, for a write that does not come through the writer', async () => {
    const insert = (year: number | null, month: number | null, day: number | null, span: string | null, slot = 'began') =>
      pool.query(
        'INSERT INTO place_dates (experience_id, slot, year, month, day, span, source_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [GOBEKLI, slot, year, month, day, span, archaeologySource],
      );
    await expect(insert(0, null, null, null)).rejects.toThrow(/check/);
    await expect(insert(1931, null, 5, null)).rejects.toThrow(/place_dates_day_in_month/);
    await expect(insert(1880, 3, null, 'decade')).rejects.toThrow(/place_dates_span_of_year/);
    await expect(insert(null, null, null, null)).rejects.toThrow(/place_dates_year_unless_ended/);
    await expect(insert(1931, null, null, null, 'opened')).rejects.toThrow(/check/);
  });
});

describe('a source\'s view of a place\'s dates (#1719, ADR-0084)', () => {
  it('writes the view whole: a slot it no longer reports is cleared', async () => {
    await underLock(GOBEKLI, (client, lock) => writeRecordDates(client, lock, gobekliRecord, {
      began: sourced(-9999, { span: 'millennium', circa: true, property: 'P571' }),
      use_ended: sourced(-7000, { span: 'millennium', property: 'P576' }),
    }));
    expect(await recordDates(gobekliRecord)).toEqual([
      { slot: 'began', year: -9999, span: 'millennium', circa: true, property: 'P571' },
      { slot: 'use_ended', year: -7000, span: 'millennium', circa: false, property: 'P576' },
    ]);
    await underLock(GOBEKLI, (client, lock) => writeRecordDates(client, lock, gobekliRecord, {
      began: sourced(-9600, { span: 'century', property: 'P571' }),
    }));
    expect(await recordDates(gobekliRecord)).toEqual([
      { slot: 'began', year: -9600, span: 'century', circa: false, property: 'P571' },
    ]);
    await underLock(GOBEKLI, (client, lock) => writeRecordDates(client, lock, gobekliRecord, {}));
    expect(await recordDates(gobekliRecord)).toEqual([]);
  });

  it('leaves the old view as it stood when a later date of the new one is refused', async () => {
    await underLock(GOBEKLI, (client, lock) => writeRecordDates(client, lock, gobekliRecord, {
      began: sourced(-9999, { span: 'millennium', circa: true, property: 'P571' }),
      use_ended: sourced(-7000, { span: 'millennium', property: 'P576' }),
    }));
    // The new view drops the end of use, rewrites the start, and gives the
    // rebuild a 31 April: refused, and nothing of it reaches the table, even
    // for a caller that goes on and commits the rest of its transaction.
    let refused: unknown = null;
    await underLock(GOBEKLI, async (client, lock) => {
      try {
        await writeRecordDates(client, lock, gobekliRecord, {
          began: sourced(-9600, { span: 'century', property: 'P571' }),
          rebuilt: sourced(1931, { month: 4, day: 31 }),
        });
      } catch (error) {
        refused = error;
      }
    });
    expect(refused).toBeInstanceOf(RangeError);
    expect(await recordDates(gobekliRecord)).toEqual([
      { slot: 'began', year: -9999, span: 'millennium', circa: true, property: 'P571' },
      { slot: 'use_ended', year: -7000, span: 'millennium', circa: false, property: 'P576' },
    ]);
  });

  it('refuses to write the view of a record another place holds', async () => {
    await expect(underLock(GOBEKLI, (client, lock) => writeRecordDates(client, lock, archRecord, {
      began: sourced(2001),
    }))).rejects.toThrow(/is not a record of place/);
    expect(await recordDates(archRecord)).toEqual([]);
  });

  it('goes with its record, and the place\'s dates with the place', async () => {
    await underLock(GOBEKLI, async (client, lock) => {
      await writeRecordDates(client, lock, gobekliRecord, { began: sourced(-9999, { span: 'millennium' }) });
      await writePlaceDate(client, lock, 'began', { ...sourced(-9999, { span: 'millennium' }), sourceId: archaeologySource, decidedBy: null });
    });
    await pool.query('DELETE FROM experiences WHERE id = $1', [GOBEKLI]);
    expect(await recordDates(gobekliRecord)).toEqual([]);
    expect(await placeDates(GOBEKLI)).toEqual([]);
  });
});
