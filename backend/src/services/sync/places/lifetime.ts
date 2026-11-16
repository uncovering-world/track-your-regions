/**
 * A place's periods as its Wikidata item states them (#2578, ADR-0217
 * decision 3; #1719): the view a run reports as its source's, read from the
 * same statements the gone rules read (`fetchStandingFacts`). Its beginning,
 * every end and every start after one are read, and written as the periods in
 * which the place stood and the end of what it was used for.
 *
 * - **The beginning**: the earliest inception (`P571`) or official opening
 *   (`P1619`). The earliest, because an opening is as often a reopening:
 *   Notre-Dame de Paris was begun in 1163 and states an opening of
 *   7 December 2024.
 * - **A gap**: an end the place outlived, one after the beginning that a
 *   start follows, and the first start wholly after it (`gapsOf`). The place
 *   stood in one period more than its gaps: the Cathedral of Christ the
 *   Saviour in Moscow opened in 1883, was blown up on 5 December 1931, and
 *   states its inception as 2000, so it stood from 1883 until 5 December 1931
 *   and stands from 2000; Ponte Santa Trinita in Florence, with ends in 1557
 *   and 1944 and openings in 1569 and on 16 March 1958, stood in three.
 * - **A dated significant event** (`P793`) is an end or a start beside the
 *   statements (`DESTROYED_EVENTS`, `REBUILT_EVENTS`): the Old Bridge in
 *   Mostar states no end of existence, a destruction on 9 November 1993 and a
 *   reconstruction that ended on 23 July 2004. A rebuilding is a start only
 *   after an end, since the same word is used of work on a building that never
 *   fell (Berlin Cathedral, 1975 to 1993), and never a beginning; an event
 *   with no date is no boundary; and a destruction that no start follows ends
 *   neither the place, which the gone rules decide, nor a use.
 * - **The end of the place**: only where the gone rules read the place as
 *   gone (`goneReason`, `goneWorkReason`): its last standing period ends at
 *   the latest end (`P576` dissolved or demolished, `P3999` official closure,
 *   or a destruction event), or at no date. A start wholly after that end is
 *   no rebuild of a place read as gone.
 * - **The end of a use**: the latest end statement not followed by a start, on
 *   a place the gone rules do not read as gone, as a use that ended then and
 *   began at a date not known. Göbekli Tepe was abandoned about 7000 BC and
 *   stands; the Registan's 1420 ends a role. An end before the beginning is
 *   the end of an earlier building, not of this one: Bath Abbey's monastery
 *   was dissolved in 1539, and the church stands built from 1572.
 *
 * A place with a beginning or an end stood in one period, or in one more than
 * its gaps; an item that states neither reports no standing period.
 *
 * **A date still ahead has not come** (`latestDayOnEarth`): a demolition
 * announced for next month, or for next year, is no end yet, and an opening
 * announced is no beginning. Such a statement is read as nothing, so the place
 * keeps its beginning and its standing period stays open. Where no end has
 * come, an end still ahead also overrules the gone rules, which read the
 * item's state and not its dates: an item marked demolished whose only end is
 * dated ahead stands until that day, and the run after it reads the end. The
 * other way round would take a standing place off today's lists on an
 * announcement. An end that has come keeps the place gone, whatever is dated
 * after it. A list the shared rule refuses all the same (`periodsFault`) is
 * not reported.
 *
 * An item that states no inception, opening, end or closure, whether or not it can be
 * read, is read by its start time (`P580`) and end time (`P582`) instead: Mohenjo-daro ends about 1700 BC. Where it
 * states any of them, a start or end time is the time of something else, the
 * Dohány Street Synagogue's building (1854 to 1859) among them.
 *
 * A time becomes a date as precisely as the item states it: a day, a month or a
 * year, or a span of a decade, a century or a millennium (a precision of ten
 * millennia and coarser reads as a millennium). A date after AD 1000 stated
 * coarser than a century is an entry error read as its year: the Tomb of the
 * Unknown Soldier in Paris states 11 November 1920 to the ten thousand years.
 * A Julian date to the day becomes the Gregorian day it is
 * (`julianToGregorian`), and a day the Julian calendar does not have is
 * skipped, as is any date the shared rule refuses (`isValidPlaceDate`). Two
 * dates are ordered by the one order of dates (`comparePlaceDates`,
 * `@tyr/shared/lifetime`): one follows another only where the periods they may
 * be do not overlap. Where a start besides the beginning shares the period of
 * the last end, the item leaves unsaid which came first: no end of use is read
 * from that end, and it opens a gap only for a start wholly after it. The Arch of
 * Neutrality, taken down and set up again in 2010, both stated to the year,
 * and standing, reads neither; so does an end in the 1950s beside an opening
 * in 1955; a place begun in 1800, ended in 1900 and started again in 1950
 * reads its rebuild of 1950 whatever an end and a start in 2010 leave unsaid.
 */

import { SOURCE_ID_SHAPES } from '@tyr/shared/identifiers';
import {
  comparePlaceDates, FURTHEST_YEARS_AHEAD, isValidPlaceDate, julianToGregorian, latestDayOnEarth, periodOf, periodsFault, statedAfter,
  type CalendarDay, type DateSpan, type PlaceEnding,
} from '@tyr/shared/lifetime';
import type { RecordPeriods, SourcedDate, SourcedPeriod } from '../../../db/placePeriodsWriter.js';
import {
  DESTROYED_EVENTS, LIFETIME_PROPERTIES, REBUILT_EVENTS,
  type DatedEvent, type DatedStatement, type LifetimeProperty, type StandingFacts,
} from '../subset/standing.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { fetchStandingFacts } from './gone.js';

const STARTS: readonly string[] = ['P571', 'P1619'];
const ENDS: readonly string[] = ['P576', 'P3999'];

/** The property a significant event is stated under. */
const EVENT_PROPERTY = 'P793';

/** A dated statement or event read as a date, with the period it may be (`periodOf`, `@tyr/shared/lifetime`). */
interface Read {
  date: SourcedDate;
  property: LifetimeProperty | typeof EVENT_PROPERTY;
  first: number;
  last: number;
}

/** What is read as a date: a statement of a lifetime property, or an event's dated qualifier. */
type Stated = Pick<DatedStatement, 'time' | 'julian' | 'circa' | 'statement'> & Pick<Read, 'property'>;

/** Wikidata's precisions coarser than a year, as spans; ten millennia and coarser read as a millennium. */
const SPANS: Readonly<Record<number, DateSpan>> = { 8: 'decade', 7: 'century', 6: 'millennium' };
const precisionSpan = (precision: number): DateSpan | null => SPANS[Math.max(precision, 6)] ?? null;

/** A statement's id in the shape the tables hold (`Q214944$899b…`), or null for one in any other. */
function statementId(id: string): string | null {
  const upper = id.replace(/^q/, 'Q');
  return SOURCE_ID_SHAPES['wikidata-statement'].test(upper) ? upper : null;
}

/** One statement as a date, or null for a time no date can hold. */
function readStatement(statement: Stated, latestYear: number): Read | null {
  const { precision } = statement.time;
  let { year, month, day } = statement.time;
  if (precision >= 11 && statement.julian) {
    const gregorian = julianToGregorian(year, month, day);
    if (!gregorian) return null;
    ({ year, month, day } = gregorian);
  }
  const span = precision <= 6 && year > 1000 ? null : precisionSpan(precision);
  const date: SourcedDate = {
    year,
    month: precision >= 10 && month > 0 ? month : null,
    day: precision >= 11 && month > 0 && day > 0 ? day : null,
    span,
    circa: statement.circa,
    property: statement.property,
    statement: statementId(statement.statement),
  };
  if (!isValidPlaceDate(date, latestYear)) return null;
  return { date, property: statement.property, ...periodOf(date) };
}

/** The one order of dates (`comparePlaceDates`): nonzero only where the periods do not overlap. */
const compare = (a: Read, b: Read): number => comparePlaceDates(a.date, b.date);

/**
 * Of the dates no other is wholly before (`side` -1) or wholly after (`side`
 * 1), the one under the property read first (an inception before an opening,
 * a dissolution before a closure, a statement before an event), then the most
 * precisely stated: the Arch of Reunification's inception of 2001 begins it
 * beside its opening of August 2001, an inception of 1450 one of the 15th
 * century, which may be either earlier or later, and the Cathedral of Christ
 * the Saviour's end of 5 December 1931 is its end statement's beside the
 * implosion event of that day.
 */
function extreme(reads: readonly Read[], side: -1 | 1): Read | null {
  const order: readonly string[] = [...LIFETIME_PROPERTIES, EVENT_PROPERTY];
  const rank = (read: Read) => order.indexOf(read.property);
  const candidates = reads.filter((read) => !reads.some((other) => compare(other, read) === side));
  return candidates.reduce<Read | null>((best, read) => {
    if (!best) return read;
    if (rank(best) !== rank(read)) return rank(best) < rank(read) ? best : read;
    return best.last - best.first <= read.last - read.first ? best : read;
  }, null);
}

const earliest = (reads: readonly Read[]): Read | null => extreme(reads, -1);
const latest = (reads: readonly Read[]): Read | null => extreme(reads, 1);


/**
 * How a place stopped standing, from the gone rules' reason: "destroyed in
 * 1966" (Nelson's Pillar), "removed in 2020" (the Empress Joséphine), "a
 * temporary work, taken down in 1976" (Running Fence); null where the reason
 * does not say (the Francis Scott Key Bridge's state of use reads closed).
 */
function endingOf(reason: string): PlaceEnding | null {
  if (reason.startsWith('destroyed')) return 'destroyed';
  if (reason.startsWith('removed') || reason.startsWith('a temporary work')) return 'removed';
  return null;
}

/**
 * The item's dated statements as dates, apart by whether their day has come:
 * `ahead` holds those dated wholly after `today`, which say nothing of the
 * place yet.
 */
function readDated(facts: StandingFacts, today: CalendarDay): { reads: Read[]; ahead: Read[] } {
  const now = periodOf({ ...today, span: null, circa: false }).first;
  const all = facts.dated.flatMap((statement) => {
    const read = readStatement(statement, today.year + FURTHEST_YEARS_AHEAD);
    return read ? [read] : [];
  });
  return { reads: all.filter((read) => read.first <= now), ahead: all.filter((read) => read.first > now) };
}

/**
 * The dates of the item's events of `kind`, those whose day has come. An event
 * is dated by one qualifier, the one named first in `by` that it carries, so
 * its day is told once: a destruction happened at its point in time, or was
 * over at its end time; a rebuilding was over at its end time, and the Old
 * Bridge in Mostar, rebuilt from 7 June 2001 to 23 July 2004, stands again
 * from the second. An event that states only when it started gives no date.
 */
function readEvents(
  facts: StandingFacts,
  kind: Readonly<Record<string, string>>,
  by: readonly DatedEvent['qualifier'][],
  today: CalendarDay,
): Read[] {
  const now = periodOf({ ...today, span: null, circa: false }).first;
  const events = facts.datedEvents.filter((event) => kind[event.event]);
  return events.flatMap((event) => {
    const carried = by.find((qualifier) => events.some((other) => other.statement === event.statement && other.qualifier === qualifier));
    if (event.qualifier !== carried) return [];
    const read = readStatement({ ...event, property: EVENT_PROPERTY }, today.year);
    return read && read.first <= now ? [read] : [];
  });
}

/** Whether a gone rule's reason says the place stood and then went, rather than that it was never built. */
const readsAsGone = (reason: string | null): reason is string => reason !== null && !reason.startsWith('never built');

/** A gap in a place's standing: the end it outlived, and the start it stands again from. */
interface Gap {
  outlived: Read;
  rebuilt: Read;
}

/**
 * Every gap the item states, in time order. An end is outlived where a start
 * follows wholly after it, and the place stands again from the first such
 * start; ends with no start between them are one gap, which opens at the
 * latest of them, so the place is offered for as long as the item lets it
 * stand. Ponte Santa Trinita's ends of 1557 and 1944 and its openings of 1569
 * and 16 March 1958 are two gaps.
 */
function gapsOf(ends: readonly Read[], starts: readonly Read[]): Gap[] {
  const byRestart = new Map<Read, Read[]>();
  for (const end of ends) {
    const rebuilt = earliest(starts.filter((start) => compare(start, end) > 0));
    if (rebuilt) byRestart.set(rebuilt, [...byRestart.get(rebuilt) ?? [], end]);
  }
  return [...byRestart]
    .map(([rebuilt, outlived]) => ({ rebuilt, outlived: latest(outlived) as Read }))
    .sort((a, b) => a.rebuilt.first - b.rebuilt.first || a.rebuilt.last - b.rebuilt.last);
}

/**
 * The gaps that leave every period the right way round. A date known to a
 * span may share its days with another, so a start can be paired with an end
 * stated before it: an end in 1900, a rebuilding in 1952, an end known to the
 * decade of 1950 and a rebuilding in 1970 would stand from 1952 until the
 * 1950s. The item leaves unsaid whether that end came after the rebuilding,
 * so the gap it would open is not read, and the place stands from 1952. The
 * same holds for the last start before the end of a place read as gone.
 */
function settled(gaps: readonly Gap[], finalEnd: Read | null): Gap[] {
  const kept: Gap[] = [];
  for (const gap of gaps) {
    const before = kept.at(-1);
    if (!before || !statedAfter(before.rebuilt.date, gap.outlived.date)) kept.push(gap);
  }
  while (finalEnd && kept.length > 0 && statedAfter((kept.at(-1) as Gap).rebuilt.date, finalEnd.date)) kept.pop();
  return kept;
}

/** How a period before a gap ended, where an event says so: a destruction, a demolition or an implosion is *destroyed*. */
const gapEnding = (end: Read): PlaceEnding | null => (end.property === EVENT_PROPERTY ? 'destroyed' : null);

/**
 * The periods in which a place stood: one more than its gaps, one from its
 * beginning, or none for a place with no beginning and no gap that is not
 * read as gone. `last` is how the last of them ends, or that it is open.
 *
 * The first begins at the place's beginning unless that is stated later than
 * the period's own end, which a date known to a span allows: the Church of
 * St. Jaume in Alcúdia states its inception to the century of 1900, a
 * destruction on 18 February 1870 and a reconstruction that ended on 25 July
 * 1893. The century may be the first church's or the second's, so the church
 * stood from a date not known until 1870, and stands from 1893.
 */
function standingOf(
  began: Read | null,
  gaps: readonly Gap[],
  last: Pick<SourcedPeriod, 'ended' | 'until' | 'ending' | 'what'>,
  gone: boolean,
): SourcedPeriod[] {
  // A beginning stated later than the first end is the beginning of something else:
  // what stood until that end began at a date the item does not give.
  const firstEnd = gaps.at(0)?.outlived.date ?? last.until;
  const first = began && !(firstEnd && statedAfter(began.date, firstEnd)) ? began.date : null;
  if (gaps.length === 0) return began || gone ? [{ from: first, ...last }] : [];
  const froms = [first, ...gaps.map((gap) => gap.rebuilt.date)];
  return froms.map((from, index) => {
    const gap = gaps.at(index);
    return gap ? { from, ended: true, until: gap.outlived.date, ending: gapEnding(gap.outlived), what: null } : { from, ...last };
  });
}

/** The lists a view reports: each that holds a period and that the shared rule does not refuse. */
function reported(lists: Record<'stood' | 'used', SourcedPeriod[]>, today: CalendarDay): RecordPeriods {
  const out: RecordPeriods = {};
  for (const says of ['stood', 'used'] as const) {
    if (lists[says].length > 0 && periodsFault(says, lists[says], today) === null) out[says] = lists[says];
  }
  return out;
}

/**
 * A place's periods as its item states them, given what the gone rules read of
 * it (`goneReason`, or `goneWorkReason` for a kind that holds works; null for
 * a place they do not read as gone). Writes nothing.
 */
export function lifetimeOf(
  facts: StandingFacts,
  goneReasonOf: string | null,
  today: CalendarDay = latestDayOnEarth(new Date()),
): RecordPeriods {
  const { reads, ahead } = readDated(facts, today);
  // Start and end times stand in only for an item that states no inception,
  // opening, end or closure, whether or not its date could be read.
  const lifetimeStated = facts.dated.some((statement) => STARTS.includes(statement.property) || ENDS.includes(statement.property));
  const [startProperties, endProperties] = lifetimeStated ? [STARTS, ENDS] : [['P580'], ['P582']];
  const stated = reads.filter((read) => startProperties.includes(read.property));
  // A rebuilding is no beginning: the place stood before what it says was rebuilt.
  const began = earliest(stated);
  const starts = [...stated, ...readEvents(facts, REBUILT_EVENTS, ['P582', 'P585'], today)];
  // An end before the beginning ends an earlier building, not this place; one
  // in the same period may be either, and stays.
  const sinceItBegan = (end: Read) => !began || compare(end, began) >= 0;
  const statedEnds = reads.filter((read) => endProperties.includes(read.property)).filter(sinceItBegan);
  const ends = [...statedEnds, ...readEvents(facts, DESTROYED_EVENTS, ['P585', 'P582'], today).filter(sinceItBegan)];
  // Where no end has come, a statement's or an event's, one dated to a day
  // still ahead says the place stands until then, whatever state the gone
  // rules read.
  const onlyEndAhead = ends.length === 0 && ahead.some((read) => endProperties.includes(read.property));
  const reason = readsAsGone(goneReasonOf) && !onlyEndAhead ? goneReasonOf : null;
  const gone = reason !== null;
  // A place read as gone ended at the latest end, a destruction among them.
  const finalEnd = gone ? latest(ends) : null;
  // A gap follows an end the place outlived, which a start follows wholly
  // after it: for a gone place, an end before its last, and a start not
  // wholly after its last. An end whose order with a start is unsaid is
  // outlived only by a start wholly after it.
  const gaps = settled(finalEnd
    ? gapsOf(ends.filter((end) => compare(end, finalEnd) < 0), starts.filter((start) => compare(start, finalEnd) <= 0))
    : gapsOf(ends, starts), finalEnd);

  // The last standing period is open unless the gone rules read the place as gone.
  const last = gone
    ? { ended: true, until: finalEnd?.date ?? null, ending: endingOf(reason), what: null }
    : { ended: false, until: null, ending: null, what: null };
  const stood = standingOf(began, gaps, last, gone);
  // The end of a use is the last end the item states that no start follows.
  // A start besides the beginning in the same period leaves unsaid which came
  // first, and a destruction event ends no use: Byōdō-in, destroyed in 1336 as
  // its item has it, is a temple today.
  const lastStated = gone ? null : latest(statedEnds);
  const useEnded = lastStated !== null && !starts.some((start) => start !== began && compare(start, lastStated) >= 0);
  const used: SourcedPeriod[] = useEnded ? [{ from: null, ended: true, until: lastStated.date, ending: null, what: null }] : [];
  return reported({ stood, used }, today);
}

/**
 * Each run item's place's lifetime as its source sees it, read in one pass
 * before the run writes (#1719): `items` names, for each item, the key the run
 * knows it by and the Wikidata item its dates are read from, and `goneOf` is
 * the gone rule of a kind that runs one (`goneReason`, `goneWorkReason`);
 * every other kind derives no end of the place. An item the door does not
 * answer has no entry, and the run leaves its record's view as it stands.
 */
export async function readLifetimes(
  sparql: SparqlFn,
  items: readonly { key: string; qid: string }[],
  goneOf?: (facts: StandingFacts) => string | null,
): Promise<Map<string, RecordPeriods>> {
  const facts = await fetchStandingFacts(sparql, items.map((item) => item.qid));
  const out = new Map<string, RecordPeriods>();
  for (const { key, qid } of items) {
    const known = facts.get(qid);
    if (known) out.set(key, lifetimeOf(known, goneOf ? goneOf(known) : null));
  }
  return out;
}
