/**
 * The writes of a World Heritage Site's inscription (ADR-0225, #2127): what
 * UNESCO's dataset says of it, in `record_heritage_inscriptions`, and the two
 * of its facts that are periods, the listing's start and the current stay on
 * the List of World Heritage in Danger, through `placePeriodsWriter.ts`.
 *
 * `record_heritage_inscriptions`' writers are a closed list the backend lint
 * names (`INSCRIPTION_WRITE_RULES`, ADR-0069): this module, and the seed. Every
 * write is made under the place's lock and requires its `LockedExperience`,
 * so a run writing a site and a curator publishing its held danger flag never
 * interleave. Whether to write, the gate's hold among it, stays with the caller
 * that decided it: the run's upsert passes the facts the gate let through, and
 * publishing passes the ones a curator accepted (`inscription.ts` names them).
 *
 * A stay that ended is history no reader is shown, read from Wikidata's
 * statements at the end of the run (`services/sync/heritageHistory.ts`); this
 * module keeps those stays and moves only the open one: it opens where the
 * site reads in danger, takes the year the listing gives, and ends, at a date
 * not known, where the site no longer reads in danger. An open stay with no
 * year given, beside stays that ended, starts on the day it is written, the
 * earliest it is known to hold: a start not known would reach back over every
 * stay that ended and take it off. A curator who publishes that a site is no
 * longer in danger ends the open stay as the curator's (`decidedBy`), so the
 * run keeps it ended while the dataset still states that stay, and opens only
 * a stay that begins after it; the stays the curator left as they stood keep
 * their own hand, and Wikidata's history still corrects them.
 */

import type { PoolClient } from 'pg';
import { outerDaysOf, periodOf } from '@tyr/shared/lifetime';
import type { LockedExperience } from './experienceWriter.js';
import { inscriptionOf, UNESCO_SOURCE_ID, type Inscription } from './inscription.js';
import {
  readRecordList, writeCuratorRecordList, writeRecordList, type ListPeriod, type SourcedDate,
} from './placePeriodsWriter.js';

/** A year as a date the source gives no more of: the dataset's "1996", "Y 2013". */
export function yearDate(year: number): SourcedDate {
  return { year, month: null, day: null, span: null, circa: false, property: null, statement: null };
}

/** The day a stay is decided on, as UTC reads it, to the day. */
function dayDate(now: Date): SourcedDate {
  return {
    year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate(),
    span: null, circa: false, property: null, statement: null,
  };
}

/** The days a stay covers, as the hold trigger reads them: an end not known ends it on the day it began. */
function daysOf(stay: ListPeriod): { first: number; last: number } {
  const { fromFirst, untilLast } = outerDaysOf(stay);
  const first = fromFirst ?? Number.NEGATIVE_INFINITY;
  if (!stay.ended) return { first, last: Number.POSITIVE_INFINITY };
  return { first, last: untilLast ?? fromFirst ?? Number.POSITIVE_INFINITY };
}

const overlap = (a: ListPeriod, b: ListPeriod): boolean => {
  const [x, y] = [daysOf(a), daysOf(b)];
  return x.first <= y.last && y.first <= x.last;
};

/**
 * The stays that hold together, in time order (`danger_periods_hold()`): no
 * two overlap. The open stay is the dataset's word on today and is kept first;
 * of the stays that ended, the earlier is kept where two overlap, and of two
 * that begin together the one given first. A stay whose start is not known
 * reaches back to every one before it, so it stands alone. A stay in
 * `standing`, one a curator decided, stands before all of them: a stay that
 * overlaps it yields.
 */
export function staysThatHold(stays: readonly ListPeriod[], standing: readonly ListPeriod[] = []): ListPeriod[] {
  const open = stays.filter((stay) => !stay.ended).slice(-1);
  const ended = stays.filter((stay) => stay.ended)
    .map((stay, index) => ({ stay, index }))
    .sort((a, b) => daysOf(a.stay).first - daysOf(b.stay).first || a.index - b.index)
    .map(({ stay }) => stay);
  const kept: ListPeriod[] = standing.map((stay) => ({ ...stay }));
  for (const stay of [...open, ...ended]) {
    if (!kept.some((other) => overlap(other, stay))) kept.push({ ...stay, ending: null });
  }
  return kept.sort((a, b) => daysOf(a).first - daysOf(b).first);
}

/** The start of the record's first listing: the year of inscription. */
async function writeListingStart(client: PoolClient, lock: LockedExperience, recordId: number, year: number | null): Promise<void> {
  const listings = (await readRecordList(client, 'record_listings', recordId, UNESCO_SOURCE_ID)).periods;
  const start = year === null ? null : yearDate(year);
  const [first, ...later] = listings;
  // A start after the end the listing holds would be no period: the listing keeps its own.
  const startsAfterItsEnd = Boolean(first?.until && start && periodOf(start).first > periodOf(first.until).last);
  if (first && !startsAfterItsEnd) {
    await writeRecordList(client, lock, 'record_listings', recordId, [{ ...first, from: start }, ...later], UNESCO_SOURCE_ID);
  } else if (!first && start) {
    await writeRecordList(client, lock, 'record_listings', recordId, [{ from: start, ended: false, until: null, ending: null }], UNESCO_SOURCE_ID);
  }
}

/** The record's stays once the open one follows the inscription: the run's, or the curator's who decided them. */
async function writeStays(
  client: PoolClient,
  lock: LockedExperience,
  recordId: number,
  inscription: Inscription,
  decidedBy: number | null,
): Promise<boolean> {
  const held = await readRecordList(client, 'record_danger_periods', recordId, UNESCO_SOURCE_ID);
  const ended = held.periods.filter((stay) => stay.ended);
  const open = held.periods.find((stay) => !stay.ended);
  // A listing that gives no year ("Y") keeps the start the open stay holds. A
  // stay it opens beside stays that ended starts today, the earliest it is
  // known to hold: a start not known would overlap them all (`staysThatHold`).
  const stated = inscription.dangerSince === null ? open?.from ?? null : yearDate(inscription.dangerSince);
  const since = stated ?? (ended.length > 0 ? dayDate(new Date()) : null);
  const next = inscription.inDanger
    ? [...ended, { from: since, ended: false, until: null, ending: null }]
    : [...ended, ...(open ? [{ ...open, ended: true, until: null }] : [])];
  // A curator's answer that ends the open stay, or moves stays a curator
  // decided, is the curator's: the run's write would leave those as they stand.
  // Only the stays it changes are stamped so (`writeCuratorRecordList`).
  if (decidedBy !== null && ((!inscription.inDanger && open) || held.theirs)) {
    await writeCuratorRecordList(client, lock, 'record_danger_periods', recordId, staysThatHold(next), decidedBy);
    return true;
  }
  await writeRecordList(client, lock, 'record_danger_periods', recordId, staysThatHold(next), UNESCO_SOURCE_ID);
  return false;
}

/**
 * Write the inscription a World Heritage membership's facts state, under the
 * run's record's keys (`inscriptionOf`): the inscription's row, the start of
 * its first listing (a record with no listing gets an open one from the year,
 * and none where no year is known), and its open stay on the Danger List. A
 * listing or a stay a curator decided is left as it stands.
 *
 * `decidedBy` is the curator publishing the facts, null on a run's write.
 * Where a curator's facts say the site is out of danger and a stay is open,
 * the open one is ended at a date not known and stamped with the decision
 * (`writeCuratorRecordList`): Bamiyan's badge comes off, and the next run
 * that still reads "Y 2003" leaves it off. A curator's answer on stays a
 * curator already decided is written so too, putting the badge back among
 * them. A stay the answer leaves as it stood keeps its own hand. A curator
 * who puts the badge on with no year known, beside Cologne's stay of 2004 to
 * 2006, opens a stay from that day and keeps the one that ended.
 * Answers whether it wrote the stays so, for the caller to claim `danger`
 * on the record (`trg_danger_periods_hold`).
 */
export async function writeInscription(
  client: PoolClient,
  lock: LockedExperience,
  recordId: number,
  facts: Readonly<Record<string, unknown>>,
  decidedBy: number | null = null,
): Promise<boolean> {
  const inscription = inscriptionOf(facts);
  const written = await client.query(
    `INSERT INTO record_heritage_inscriptions (record_id, criteria, area_ha, transboundary, unesco_region)
     SELECT r.id, $3::varchar(6)[], $4::numeric, $5, $6 FROM source_records r WHERE r.id = $1 AND r.experience_id = $2
     ON CONFLICT (record_id) DO UPDATE
        SET criteria = EXCLUDED.criteria, area_ha = EXCLUDED.area_ha, transboundary = EXCLUDED.transboundary,
            unesco_region = EXCLUDED.unesco_region
      WHERE (record_heritage_inscriptions.criteria, record_heritage_inscriptions.area_ha,
             record_heritage_inscriptions.transboundary, record_heritage_inscriptions.unesco_region)
            IS DISTINCT FROM (EXCLUDED.criteria, EXCLUDED.area_ha, EXCLUDED.transboundary, EXCLUDED.unesco_region)
     RETURNING record_id`,
    [recordId, lock.id, inscription.criteria, inscription.areaHa, inscription.transboundary, inscription.region],
  );
  if (written.rowCount === 0) {
    const owned = await client.query('SELECT 1 FROM source_records WHERE id = $1 AND experience_id = $2', [recordId, lock.id]);
    if (owned.rowCount === 0) throw new RangeError(`inscriptionWriter: record ${recordId} is not a record of place ${lock.id}`);
  }

  await writeListingStart(client, lock, recordId, inscription.inscribedYear);
  return writeStays(client, lock, recordId, inscription, decidedBy);
}
