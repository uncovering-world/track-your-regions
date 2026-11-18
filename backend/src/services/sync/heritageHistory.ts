/**
 * A World Heritage Site's history on the lists, read from Wikidata's statements
 * at the end of the UNESCO run (ADR-0217 decision 10, ADR-0225, #2127).
 *
 * UNESCO's dataset states only today: whether a site is on the List of World
 * Heritage in Danger now, and none of the sites it struck off. Wikidata states
 * the history: each stay on the Danger List as a significant event (`P793`,
 * the list of World Heritage in Danger, `Q222384`) with its start and end time
 * (`P580`, `P582`), and a delisting as the end time of the site's World
 * Heritage designation (`P1435` World Heritage Site, `Q9259`). Read on
 * 2026-11-18: Cologne Cathedral states its stay of 2004 to 2006; Liverpool
 * Maritime Mercantile City a stay from 2012 with no end, and its designation's
 * end on 21 July 2021, the day it was delisted.
 *
 * So each World Heritage membership of the run keeps, beside the open stay the
 * dataset gives (`db/inscriptionWriter.ts`), the stays that ended:
 *
 * - a stay Wikidata dates at both ends is written as stated (Cologne, 2004 to 2006);
 * - a stay Wikidata leaves open on a site the list struck off ended with the
 *   listing (Liverpool, 2012 to 21 July 2021);
 * - a stay Wikidata leaves open on a site the dataset does not read in danger
 *   ended at a date not known (the Simien Mountains, listed 1996, removed in
 *   2017 while Wikidata states no end);
 * - one Wikidata leaves open on a site the dataset reads in danger is the
 *   dataset's open stay, whose year stands (Bamiyan, since 2003);
 * - a stay a run wrote before and Wikidata no longer states is kept;
 * - a stay a curator decided stands as it is, and a stay Wikidata states that
 *   overlaps it yields: the run writes its own stays around it
 *   (`writeRecordList`), so a correction of Cologne's 2004 to 2006 still lands
 *   once a curator ended a later stay.
 *
 * A stay is the site's wherever Wikidata states it: on the site's own items
 * (`siteItems`) and on its components' (`componentItemsOf`). The Bamiyan
 * Valley's item states a stay with no dates and the Buddhas of Bamiyan's, the
 * component `208-001`, the stay from 2003; the Medieval Monuments in Kosovo's stay
 * from 2006 is stated on each of their four components. The site's stays are one list
 * (`siteStays`): a stay stated with no date at all says nothing once another
 * is dated, and stays that overlap are one stay. A designation's end is read
 * on the site's own items alone: on a component's it ends that component.
 *
 * The stays hold together (`staysThatHold`): where two overlap the open stay
 * wins, then the earlier. No reader is shown a stay that ended, so they pass
 * the gate. The listing of a membership the list struck off (`former`, a
 * curator's word) ends, `delisted`, at the designation's end where Wikidata
 * states one; one the run lists again opens. That date is written by the run
 * until the review queue offers it to a curator (#2643).
 */

import type { PoolClient } from 'pg';
import { latestDayOnEarth, periodOf } from '@tyr/shared/lifetime';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience, type LockedExperience } from '../../db/experienceWriter.js';
import { UNESCO_SOURCE_ID, WORLD_HERITAGE_KIND_ID } from '../../db/inscription.js';
import { staysThatHold } from '../../db/inscriptionWriter.js';
import {
  listPeriodOf, listRowsOf, readRecordList, writeRecordList, type ListPeriod, type RecordListTable, type SourcedDate,
} from '../../db/placePeriodsWriter.js';
import { statementIdOf } from './places/gone.js';
import { statedTime } from './subset/standing.js';
import { siteItems, type WorldHeritageIndex } from './unescoWikidata.js';
import { sayWait, sparqlQuery, type SparqlBinding, type WaitBudget } from './wikidataUtils.js';
import type { SyncProgress } from './types.js';

const LOG_PREFIX = '[UNESCO Sync]';

/** Wikidata's item for the list of World Heritage in Danger, verified 2026-11-18. */
export const DANGER_LIST_ITEM = 'Q222384';
/** Wikidata's item for World Heritage Site, the designation (`P1435`) a delisting ends. */
export const WORLD_HERITAGE_SITE_ITEM = 'Q9259';

/** What Wikidata states of the lists, by item (`Q4176`). */
export interface HeritageStatements {
  /** Each item's stays on the Danger List, as stated; an open one has no `until`. */
  stays: Map<string, ListPeriod[]>;
  /** The end of each item's World Heritage designation, where it states one. */
  listingEnds: Map<string, SourcedDate[]>;
}

/** What Wikidata states of one site, over its own items and its components'. */
export interface SiteStatements {
  stays: ListPeriod[];
  listingEnd: SourcedDate | null;
}

/** A time as a date, to the day, month or year Wikidata states it; anything coarser says nothing here. */
function dateOf(time: string | undefined, precision: string | undefined, property: string, statement: string): SourcedDate | null {
  const stated = statedTime(time, precision === undefined ? undefined : Number(precision));
  if (!stated || stated.precision < 9) return null;
  return {
    year: stated.year,
    month: stated.precision >= 10 ? stated.month : null,
    day: stated.precision >= 11 ? stated.day : null,
    span: null,
    circa: false,
    property,
    statement,
  };
}

const itemOf = (binding: SparqlBinding): string | null => binding.item?.value.split('/').pop() ?? null;

/** Whether `until` may end a period begun at `from`: not before it, and not on a day still ahead. */
function endsAfter(from: SourcedDate | null, until: SourcedDate | null): boolean {
  if (!until) return false;
  const today = latestDayOnEarth(new Date());
  if (periodOf(until).first > periodOf({ ...today, span: null, circa: false }).first) return false;
  return !from || periodOf(until).last >= periodOf(from).first;
}

/**
 * A stay as one statement dates it. An end before the start, a typing slip
 * the schema would refuse, ends the stay at a date not known; an end still
 * ahead says the stay goes on.
 */
function statedStay(from: SourcedDate | null, until: SourcedDate | null): ListPeriod {
  if (!until) return { from, ended: false, until: null, ending: null };
  if (endsAfter(from, until)) return { from, ended: true, until, ending: null };
  const inverted = from !== null && periodOf(until).last < periodOf(from).first;
  return { from, ended: inverted, until: null, ending: null };
}

/**
 * The statements as stays and listing ends, by item: one per statement, a
 * statement stating two start times read by the earlier and two end times by
 * the later.
 */
export function statementsOf(dangerRows: readonly SparqlBinding[], listingRows: readonly SparqlBinding[]): HeritageStatements {
  const stays = new Map<string, Map<string, ListPeriod>>();
  for (const row of dangerRows) {
    const item = itemOf(row);
    const node = row.statement?.value;
    if (!item || !node) continue;
    const statement = statementIdOf(node);
    const from = dateOf(row.start?.value, row.startPrecision?.value, 'P580', statement);
    const until = dateOf(row.end?.value, row.endPrecision?.value, 'P582', statement);
    const byStatement = stays.get(item) ?? new Map<string, ListPeriod>();
    const known = byStatement.get(statement);
    const earlier = known?.from && from && periodOf(known.from).first <= periodOf(from).first ? known.from : from ?? known?.from ?? null;
    const later = known?.until && until && periodOf(known.until).last >= periodOf(until).last ? known.until : until ?? known?.until ?? null;
    byStatement.set(statement, statedStay(earlier, later));
    stays.set(item, byStatement);
  }
  const listingEnds = new Map<string, SourcedDate[]>();
  for (const row of listingRows) {
    const item = itemOf(row);
    const node = row.statement?.value;
    if (!item || !node) continue;
    const end = dateOf(row.end?.value, row.endPrecision?.value, 'P582', statementIdOf(node));
    if (end) listingEnds.set(item, [...listingEnds.get(item) ?? [], end]);
  }
  return {
    stays: new Map([...stays].map(([item, byStatement]) => [item, [...byStatement.values()]])),
    listingEnds,
  };
}

/** The latest of the dates, by the last day each may be; null for none. */
const latestOf = (dates: readonly SourcedDate[]): SourcedDate | null =>
  dates.reduce<SourcedDate | null>((latest, date) => (!latest || periodOf(date).last > periodOf(latest).last ? date : latest), null);

/** The days a stay as stated may cover: from its start, or with none from always, to its end, or with none for ever. */
function spanOf(stay: ListPeriod): { first: number; last: number } {
  const first = stay.from ? periodOf(stay.from).first : Number.NEGATIVE_INFINITY;
  return { first, last: stay.ended && stay.until ? periodOf(stay.until).last : Number.POSITIVE_INFINITY };
}

/**
 * Two stays that overlap as one: from the earlier start, a start not known
 * yielding to a known one, and ended at the later end where either states
 * one, since a statement left open is more often an end nobody typed than a
 * stay that goes on (two components of site 144 state 2004 to 2014 and 2004 to 2015).
 */
function fused(a: ListPeriod, b: ListPeriod): ListPeriod {
  const starts = [a.from, b.from].filter((date): date is SourcedDate => date !== null);
  const from = starts.reduce<SourcedDate | null>((earliest, date) => (!earliest || periodOf(date).first < periodOf(earliest).first ? date : earliest), null);
  const until = latestOf([a, b].flatMap((stay) => (stay.ended && stay.until ? [stay.until] : [])));
  return { from, ended: until !== null, until, ending: null };
}

/**
 * A site's stays as stated over all its items, one per stay: a stay with no
 * date at all says only that the site stood on the list, so it is left out
 * once another is dated (the Bamiyan Valley's item beside the Buddhas'); two
 * that overlap, the same stay stated on two components among them, are fused.
 */
export function siteStays(stays: readonly ListPeriod[]): ListPeriod[] {
  const dated = stays.filter((stay) => stay.from !== null || stay.until !== null);
  if (dated.length === 0) return stays.slice(0, 1).map((stay) => ({ ...stay }));
  const merged: ListPeriod[] = [];
  for (const stay of [...dated].sort((a, b) => spanOf(a).first - spanOf(b).first)) {
    const last = merged.at(-1);
    if (last && spanOf(stay).first <= spanOf(last).last) merged[merged.length - 1] = fused(last, stay);
    else merged.push(stay);
  }
  return merged;
}

/**
 * The items of a site's components the run's index knows (`208-001`, the
 * Buddhas of Bamiyan, for `208`), leaving out an item whose every statement
 * of the reference is deprecated.
 */
export function componentItemsOf(index: WorldHeritageIndex, site: string): string[] {
  const items = (index.bySite.get(String(site).trim())?.component ?? [])
    .filter((candidate) => !candidate.deprecated && candidate.item !== null)
    .map((candidate) => candidate.item!.split('/').pop()!);
  return [...new Set(items)].sort();
}

/**
 * What the statements say of one site: its stays over its own items and its
 * components' (`siteStays`), and the end of its designation over its own
 * items alone.
 */
export function siteStatements(
  statements: HeritageStatements, items: readonly string[], components: readonly string[] = [],
): SiteStatements {
  const all = [...new Set([...items, ...components])];
  return {
    stays: siteStays(all.flatMap((item) => statements.stays.get(item) ?? [])),
    listingEnd: latestOf(items.flatMap((item) => statements.listingEnds.get(item) ?? [])),
  };
}

/** Two stays that begin on the same date as stated, to the day it is stated to: January 2004 is not September 2004. */
const sameStart = (a: ListPeriod, b: ListPeriod): boolean =>
  (a.from === null && b.from === null)
  || (a.from !== null && b.from !== null
    && a.from.year === b.from.year && a.from.month === b.from.month && a.from.day === b.from.day);

/** A membership's lists as stored, and whether the list still names it. */
export interface StoredLists {
  stays: readonly ListPeriod[];
  listings: readonly ListPeriod[];
  /** The source lists the membership (`source_membership = 'present'`); false where it struck it off. */
  listed: boolean;
  /** Which of the stays a curator decided or another source wrote, one per stay: each stands as it is. */
  others?: readonly boolean[];
}

/**
 * A membership's listings once Wikidata's statements are read in, and the day
 * its listing ended where the list struck it off and that day is known: the
 * designation's end Wikidata states (Liverpool, 21 July 2021), else the end
 * the listing holds. A membership the list names again has its last listing
 * open.
 */
function listingsOf(stored: StoredLists, stated: SiteStatements | null): { listings: ListPeriod[]; delisted: SourcedDate | null } {
  if (!stored.listed) {
    // The current listing, the last, ends; an earlier one stands as it is.
    const earlier = stored.listings.slice(0, -1);
    const listing = stored.listings.at(-1) ?? { from: null, ended: false, until: null, ending: null };
    const statedEnd = stated?.listingEnd ?? null;
    const heldEnd = listing.ended ? listing.until : null;
    const delisted = endsAfter(listing.from, statedEnd) ? statedEnd : heldEnd;
    return { listings: [...earlier, { ...listing, ended: true, until: delisted, ending: 'delisted' }], delisted };
  }
  const last = stored.listings[stored.listings.length - 1];
  if (!last?.ended) return { listings: [...stored.listings], delisted: null };
  return { listings: [...stored.listings.slice(0, -1), { ...last, ended: false, until: null, ending: null }], delisted: null };
}

/** A stay Wikidata states, as this membership keeps it (the rules in the header); null for one it does not. */
function stayKept(stay: ListPeriod, stored: StoredLists, delisted: SourcedDate | null): ListPeriod | null {
  if (stay.ended) return stay;
  if (!stored.listed) return { ...stay, ended: true, until: endsAfter(stay.from, delisted) ? delisted : null };
  if (stored.stays.some((held) => !held.ended)) return null;
  return { ...stay, ended: true, until: null };
}

/**
 * A membership's stays and listing once Wikidata's statements are read in
 * (the rules in the header). `stated` is null where Wikidata was not asked or
 * did not answer: the listing still follows whether the list names the site,
 * and the stays are kept.
 */
export function historyOf(stored: StoredLists, stated: SiteStatements | null): { stays: ListPeriod[]; listings: ListPeriod[] } {
  const { listings, delisted } = listingsOf(stored, stated);
  const theirs = stored.stays.filter((_, index) => stored.others?.[index] === true);
  const candidates = (stated?.stays ?? [])
    .map((stay) => stayKept(stay, stored, delisted))
    .filter((stay): stay is ListPeriod => stay !== null);
  for (const stay of stored.stays.filter((_, index) => stored.others?.[index] !== true)) {
    // The open stay of a site the list names is the dataset's, and stands
    // over any stay Wikidata states that it overlaps (`staysThatHold`).
    const stated = candidates.findIndex((other) => sameStart(other, stay));
    if (!stay.ended && stored.listed) candidates.push(stay);
    else if (stated < 0) candidates.push(stay.ended ? stay : stayKept(stay, stored, delisted)!);
    // A statement that ends the stay at no date keeps the end the stay holds: 2017 for the Simien Mountains.
    else if (stay.ended && stay.until && candidates[stated].ended && !candidates[stated].until) {
      candidates[stated] = { ...candidates[stated], until: stay.until };
    }
  }
  return { stays: staysThatHold(candidates, theirs), listings };
}

/** The two questions, one per list: the Danger List's stays, and the designations that ended. */
const DANGER_QUERY = `
  SELECT ?item ?statement ?start ?startPrecision ?end ?endPrecision WHERE {
    ?statement ps:P793 wd:${DANGER_LIST_ITEM} .
    ?item p:P793 ?statement .
    ?statement wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
    OPTIONAL { ?statement pqv:P580 ?sv . ?sv wikibase:timeValue ?start ; wikibase:timePrecision ?startPrecision . }
    OPTIONAL { ?statement pqv:P582 ?ev . ?ev wikibase:timeValue ?end ; wikibase:timePrecision ?endPrecision . }
  }`;
const DELISTING_QUERY = `
  SELECT ?item ?statement ?end ?endPrecision WHERE {
    ?statement ps:P1435 wd:${WORLD_HERITAGE_SITE_ITEM} ; pq:P582 ?anyEnd .
    ?item p:P1435 ?statement .
    ?statement wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
    ?statement pqv:P582 ?ev . ?ev wikibase:timeValue ?end ; wikibase:timePrecision ?endPrecision .
  }`;

/**
 * Ask Wikidata for every stay on the Danger List and every World Heritage
 * designation that ended: two questions, about 120 statements together on
 * 2026-11-18. Answers null where Wikidata did not answer, and the run keeps
 * the stays it holds.
 */
export async function fetchHeritageStatements(progress: SyncProgress, budget: WaitBudget): Promise<HeritageStatements | null> {
  const options = {
    budget,
    isCancelled: () => progress.cancel,
    onWait: (wait: Parameters<typeof sayWait>[2]) => { sayWait(progress, 'Wikidata', wait, budget); },
  };
  try {
    const danger = await sparqlQuery(DANGER_QUERY, LOG_PREFIX, options);
    const delistings = await sparqlQuery(DELISTING_QUERY, LOG_PREFIX, options);
    return statementsOf(danger, delistings);
  } catch (error) {
    if (progress.cancel) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`${LOG_PREFIX} Wikidata did not answer about the Danger List: ${msg}`);
    return null;
  }
}

interface StoredRecord {
  id: number;
  experience_id: number;
  external_id: string;
  name: string | null;
  listed: boolean;
  /** A curator decided, or another source wrote, a listing: the run leaves the listings to them. */
  listings_theirs: boolean;
  /** Every stay, each with `theirs` where a curator decided it or another source wrote it. */
  stays: Record<string, unknown>[];
  listings: Record<string, unknown>[];
}

/** A list's rows as written, to tell whether a write would change anything. */
const rowsKey = (table: RecordListTable, periods: readonly ListPeriod[]): string => JSON.stringify(listRowsOf(table, periods));

/**
 * One membership's history, in its own transaction under the place's lock,
 * read again there: a curator's publish may have moved the open stay since,
 * decided a stay, which then stands as it is, decided the listings, which are
 * then left to them, or judged the membership again. Answers whether a list was written; a failure,
 * a connection not granted among them, is logged and the run goes on.
 */
async function writeRecordHistory(
  record: StoredRecord,
  stated: SiteStatements | null,
  change: { stays: boolean; listings: boolean },
): Promise<boolean> {
  let client: PoolClient | null = null;
  let broken: Error | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const locked = await lockExperience(client, record.experience_id);
    const written = locked ? await writeHistoryUnderLock(client, locked.lock, record, stated, change) : false;
    await client.query('COMMIT');
    return written;
  } catch (error) {
    if (client) broken = await rollbackQuietly(client);
    console.error('%s Could not write the list history of site %s:', LOG_PREFIX, record.external_id, error);
    return false;
  } finally {
    client?.release(broken);
  }
}

/** The lists `writeRecordHistory` writes, as the membership stands under the lock. */
async function writeHistoryUnderLock(
  client: PoolClient,
  lock: LockedExperience,
  record: StoredRecord,
  stated: SiteStatements | null,
  change: { stays: boolean; listings: boolean },
): Promise<boolean> {
  const now = (await client.query<{ listed: boolean }>(
    `SELECT source_membership = 'present' AS listed FROM source_records WHERE id = $1`, [record.id],
  )).rows[0];
  if (!now) return false;
  const stays = await readRecordList(client, 'record_danger_periods', record.id, UNESCO_SOURCE_ID);
  const listings = await readRecordList(client, 'record_listings', record.id, UNESCO_SOURCE_ID);
  const next = historyOf({ stays: stays.periods, others: stays.others, listings: listings.periods, listed: now.listed }, stated);
  let written = false;
  if (change.listings && !listings.theirs) {
    written = await writeRecordList(client, lock, 'record_listings', record.id, next.listings, UNESCO_SOURCE_ID);
  }
  if (change.stays) {
    written = await writeRecordList(client, lock, 'record_danger_periods', record.id, next.stays, UNESCO_SOURCE_ID) || written;
  }
  return written;
}

/**
 * Write each World Heritage membership's history (`historyOf`): every
 * membership of the run's source, the ones the list struck off among them,
 * since a delisted site is in no dataset the run reads. Only a membership whose
 * lists would change is locked and written, each in its own transaction.
 * Listings a curator decided or another source wrote one of are left to them;
 * a stay a curator decided stands as it is, and the run's stays are written
 * around it (`writeRecordList`, which leaves the list whole where they would
 * move it). Answers how many memberships were written.
 */
export async function writeHeritageHistory(index: WorldHeritageIndex | null, statements: HeritageStatements | null): Promise<number> {
  const columns = (table: string) => `COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.ordinal) FROM ${table} t
                                                WHERE t.record_id = r.id AND t.source_id = ${UNESCO_SOURCE_ID}
                                                  AND t.decided_at IS NULL), '[]'::jsonb)`;
  const theirs = (table: string) => `EXISTS (SELECT 1 FROM ${table} t WHERE t.record_id = r.id
                                              AND (t.source_id <> ${UNESCO_SOURCE_ID} OR t.decided_at IS NOT NULL))`;
  const stays = `COALESCE((SELECT jsonb_agg(to_jsonb(t) || jsonb_build_object(
                                 'theirs', t.source_id <> ${UNESCO_SOURCE_ID} OR t.decided_at IS NOT NULL) ORDER BY t.ordinal)
                               FROM record_danger_periods t WHERE t.record_id = r.id), '[]'::jsonb)`;
  const records = (await pool.query<StoredRecord>(
    `SELECT r.id, r.experience_id, r.external_id, COALESCE(r.reported_name, e.name) AS name,
            r.source_membership = 'present' AS listed, ${theirs('record_listings')} AS listings_theirs,
            ${stays} AS stays, ${columns('record_listings')} AS listings
       FROM source_records r JOIN experiences e ON e.id = r.experience_id
      WHERE r.source_id = $1 AND r.kind_id = $2`,
    [UNESCO_SOURCE_ID, WORLD_HERITAGE_KIND_ID],
  )).rows;

  let written = 0;
  for (const record of records) {
    const stored: StoredLists = {
      stays: record.stays.map(listPeriodOf), others: record.stays.map((row) => row.theirs === true),
      listings: record.listings.map(listPeriodOf), listed: record.listed,
    };
    const stated = index && statements
      ? siteStatements(statements, siteItems(index, record.external_id, record.name), componentItemsOf(index, record.external_id))
      : null;
    const next = historyOf(stored, stated);
    const change = {
      stays: rowsKey('record_danger_periods', next.stays) !== rowsKey('record_danger_periods', stored.stays),
      listings: !record.listings_theirs && rowsKey('record_listings', next.listings) !== rowsKey('record_listings', stored.listings),
    };
    if ((change.stays || change.listings) && await writeRecordHistory(record, stated, change)) written += 1;
  }
  return written;
}
