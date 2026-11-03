/**
 * #2259: a place kind refuses a place Wikidata says is gone — collapsed,
 * demolished or never built — read from the item's own statements, never from
 * an event its article tells of.
 *
 * Every rule of the six place kinds reads what an item is (its classes); none
 * reads whether it still stands, and an article read for a disaster carries a
 * place a traveller cannot visit over a fame bar: the Francis Scott Key Bridge
 * (collapsed in 2024), the St. Francis Dam (failed in 1928), the Teton Dam
 * (collapsed in 1976), Old St. Peter's Basilica (pulled down for the new one).
 *
 * No single statement says *gone*. An end of existence (`P576`) is as often
 * the end of what a building housed as the end of the building: Bath Abbey's
 * monastery was dissolved, Hagia Sophia ceased to be a church, the Registan
 * carries one, and Coventry's bombed cathedral is a ruin a visitor walks
 * through. A state of conservation of *demolished or destroyed* sits on
 * churches rebuilt since (the Cathedral of Christ the Saviour, St Michael's
 * Golden-Domed Monastery) and on ruins worth the journey (Fountains Abbey). So
 * an end of existence counts as gone only where the item's state of use agrees
 * that it closed for good, and nothing — a heritage designation that still
 * holds, a state of conservation that says what stands — says it is there to
 * see. Measured on every membership of the six kinds on the development
 * subset of 2026-11-02, that names the Francis Scott Key Bridge and Old
 * St. Peter's Basilica and nothing else.
 *
 * #2280: a work — a statue, a column, a temporary installation — houses
 * nothing, so its end of existence is its removal unless the item says it
 * stands again (`removedWorkReason`), and Public art and Monuments & memorials
 * read it so (`goneWorkReason`).
 */

import type { FilteredEntity } from '../syncContract.js';
import { chunk, values, type SparqlFn } from '../wikidataQueries.js';
import { extractQid, isQid, type SparqlBinding } from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import { statedTime, subsetStandingFacts, type StandingFacts, type StatedTime } from '../subset/standing.js';

export type { StandingFacts };

/** A state of use that says nothing is left. */
const DEMOLISHED: Readonly<Record<string, string>> = { Q56556915: 'demolished or destroyed' };

/** A state of use that says the place was never built. */
const NEVER_BUILT: Readonly<Record<string, string>> = {
  Q811683: 'proposed building or structure',
  Q30108381: 'cancelled',
  Q21514702: 'abandoned project',
};

/** A state of use that agrees with an end of existence: closed, for good or since. */
const CLOSED: Readonly<Record<string, string>> = {
  Q55653430: 'temporarily closed',
  Q104664889: 'permanently closed',
  Q56651571: 'out of service',
  Q11639308: 'decommissioned',
  Q63065035: 'abandoned',
};

/** A work no longer in service, as a dam or a bridge is out of service. */
const OUT_OF_SERVICE: ReadonlySet<string> = new Set(['Q56651571', 'Q11639308']);

/** A state of conservation that says what stands to be seen. */
const STANDS: Readonly<Record<string, string>> = {
  Q56557591: 'preserved',
  Q56557159: 'ruinous',
  Q60539160: 'partially destroyed',
};

const RUINOUS = 'Q56557159';

const named = (ids: readonly string[], words: Readonly<Record<string, string>>) => ids.filter((id) => words[id]).map((id) => words[id]);

/** Why the place is gone, from its own statements, or null for a place nothing says is gone. */
export function goneReason(facts: StandingFacts): string | null {
  const demolished = named(facts.use, DEMOLISHED);
  if (demolished.length) return `gone: Wikidata's state of use says ${demolished[0]}`;
  const unbuilt = named(facts.use, NEVER_BUILT);
  if (unbuilt.length) return `never built: Wikidata's state of use says ${unbuilt[0]}`;
  // A designation that still holds, or a state of conservation, says what is there to see.
  if (facts.heritage) return null;
  const closed = named(facts.use, CLOSED);
  const stands = named(facts.conservation, STANDS);
  if (facts.ended && closed.length && !stands.length) {
    const when = facts.endedYear === null ? '' : ` in ${facts.endedYear}`;
    return `gone: Wikidata ends its existence${when}, its state of use says ${closed[0]}, and nothing says it stands`;
  }
  // A work out of service in ruins is the failure itself, not a ruin kept to be seen.
  if (facts.use.some((id) => OUT_OF_SERVICE.has(id)) && facts.conservation.includes(RUINOUS)) {
    const outOfService = facts.use.find((id) => OUT_OF_SERVICE.has(id)) as string;
    return `gone: Wikidata's state of use says ${CLOSED[outOfService]}, and its state of conservation ruinous`;
  }
  return null;
}

/** A significant event (`P793`) that says the work was destroyed rather than taken away. */
const DESTROYED_EVENTS: ReadonlySet<string> = new Set(['Q331483', 'Q17781833']); // demolition, destruction

/**
 * Whether `a` is earlier than `b`, as precisely as the coarser of the two is
 * stated: Running Fence's 1976-09-10 is earlier than its 1976-09-24, and the
 * Arch of Neutrality's 2010 is not earlier than its 2010. A time coarser than
 * a year compares its year.
 */
function isEarlier(a: StatedTime, b: StatedTime): boolean {
  const precision = Math.min(a.precision, b.precision);
  if (a.year !== b.year || precision < 10) return a.year < b.year;
  if (a.month !== b.month || precision < 11) return a.month < b.month;
  return a.day < b.day;
}

/** The months from `a` to `b`, where both are stated to the month or finer; null otherwise. */
const monthsBetween = (a: StatedTime, b: StatedTime): number | null =>
  (a.precision >= 10 && b.precision >= 10 ? (b.year - a.year) * 12 + (b.month - a.month) : null);

/**
 * Whether the item says the work stands after its end: an inception after the
 * end (set up again: the Swedish lion in Narva, ended 1944 and set up in 2000;
 * the Catherine II Monument in Krasnodar, ended 1920 and restored in 2006), one
 * in the same period beside an earlier one (the Arch of Neutrality, 1998 and
 * 2010, ended 2010), a coordinate
 * placed there since the end (moved: the Arch of Neutrality, 2010), or a
 * heritage designation that holds and is not known to be older than the end —
 * a register that listed the work after it ended, or states no start, lists
 * what stands there now (both Moscow Triumphal Gates, ended 1936 and rebuilt).
 * A designation older than the end says only what stood then: the Empress
 * Joséphine was inscribed in 1992 and pulled down in 2020. With no time on the
 * end, only a designation can say so.
 */
function standsAfter(facts: StandingFacts): boolean {
  const end = facts.endedAt;
  const since = (time: StatedTime) => end !== null && !isEarlier(time, end);
  // An inception after the end is a rebuild. One in the same period as the end
  // is a rebuild only beside an earlier inception: alone, it is the work's own
  // first, set up and taken down within that period.
  const rebuilt = (time: StatedTime) => end !== null && since(time)
    && (isEarlier(end, time) || facts.inceptions.some((other) => isEarlier(other, time)));
  return facts.inceptions.some(rebuilt) || facts.placedSince.some(since)
    || facts.designatedSince.some((time) => time === null || end === null || since(time));
}

/**
 * #2280: why a work is no longer where its point is, from its own statements,
 * or null. A work houses nothing, so an end of existence is its removal
 * unless the item says it stands again (`standsAfter`), in the words a curator
 * reads: "destroyed in 1966" where an event (`P793`) or the state of
 * conservation says it was destroyed (Nelson's Pillar, the Arch of
 * Reunification), "a temporary work, taken down in 1976" where it stood less
 * than a year (Running Fence), "removed in 2020" otherwise (the Empress
 * Joséphine, the Utah monolith).
 *
 * Read from statements alone, so an item that describes the original and says
 * nothing of the replica standing today is refused: the Barmaley Fountain's
 * states only its end in 1951 and that it was destroyed. A curator's pin puts
 * such a work back.
 */
export function removedWorkReason(facts: StandingFacts): string | null {
  if (!facts.ended || standsAfter(facts)) return null;
  const when = facts.endedYear === null ? '' : ` in ${facts.endedYear}`;
  const end = facts.endedAt;
  // The latest inception before the end: what was taken down is what was set up last.
  const lastInception = end === null ? null : facts.inceptions
    .filter((time) => isEarlier(time, end))
    .reduce<StatedTime | null>((latest, time) => (latest && !isEarlier(latest, time) ? latest : time), null);
  const months = end && lastInception ? monthsBetween(lastInception, end) : null;
  if (months !== null && months < 12) return `a temporary work, taken down${when}`;
  const destroyed = facts.events.some((event) => DESTROYED_EVENTS.has(event)) || facts.conservation.some((state) => DEMOLISHED[state]);
  return `${destroyed ? 'destroyed' : 'removed'}${when}`;
}

/** Public art's and Monuments & memorials' reading of a gone work: a place's (#2259), then a work's (#2280). */
export function goneWorkReason(facts: StandingFacts): string | null {
  return goneReason(facts) ?? removedWorkReason(facts);
}

const BATCH = 100;

/** The standing facts of each of `qids`, from the subset or the live service; an item neither answers has none. */
export async function fetchStandingFacts(sparql: SparqlFn, qids: readonly string[]): Promise<Map<string, StandingFacts>> {
  const asked = [...new Set(qids.filter(isQid))];
  const out = new Map<string, StandingFacts>();
  for (const batch of chunk(asked, BATCH)) {
    const answer = readsSubset(sparql) ? await subsetStandingFacts(batch) : await liveStandingFacts(sparql, batch);
    for (const [qid, facts] of answer) out.set(qid, facts);
  }
  return out;
}

/** One item's facts as the live answer's rows build them up. */
interface LiveFacts {
  ended: boolean;
  endedYear: number | null;
  endedAt: StatedTime | null;
  use: Set<string>;
  conservation: Set<string>;
  /** By designation and start, so a designation the answer names twice counts once. */
  designations: Map<string, StatedTime | null>;
  inceptions: StatedTime[];
  placedSince: StatedTime[];
  events: Set<string>;
}

/** A time the live service bound, with the precision bound beside it, or null where none was bound. */
function liveTime(value: SparqlBinding[string] | undefined, precision: SparqlBinding[string] | undefined): StatedTime | null {
  if (!value?.value) return null;
  return statedTime(value.value, precision?.value === undefined ? undefined : Number(precision.value));
}

/** What one row of the live answer adds to its item's facts: one statement. */
function addRow(facts: LiveFacts, row: SparqlBinding): void {
  if (row.end?.value) {
    facts.ended = true;
    const year = /^([+-]?\d+)-/.exec(row.end.value);
    if (year && facts.endedYear === null) facts.endedYear = Number(year[1]);
    facts.endedAt ??= liveTime(row.end, row.endPrecision);
  }
  if (row.use?.value) facts.use.add(extractQid(row.use.value));
  if (row.cons?.value) facts.conservation.add(extractQid(row.cons.value));
  if (row.herit?.value) facts.designations.set(`${row.herit.value} ${row.heritSince?.value ?? ''}`, liveTime(row.heritSince, row.heritSincePrecision));
  const inception = liveTime(row.inception, row.inceptionPrecision);
  if (inception) facts.inceptions.push(inception);
  const placed = liveTime(row.placedSince, row.placedSincePrecision);
  if (placed) facts.placedSince.push(placed);
  if (row.event?.value) facts.events.add(extractQid(row.event.value));
}

/**
 * The live twin of `subsetStandingFacts`: one branch of the union per fact, so
 * a row carries one statement and an item's facts do not multiply, each time
 * read with its precision.
 */
async function liveStandingFacts(sparql: SparqlFn, qids: string[]): Promise<Map<string, StandingFacts>> {
  const rows = await sparql(`
    SELECT ?e ?end ?endPrecision ?use ?cons ?herit ?heritSince ?heritSincePrecision
           ?inception ?inceptionPrecision ?placedSince ?placedSincePrecision ?event WHERE {
      VALUES ?e { ${values(qids)} }
      { ?e p:P576 ?n . ?n a wikibase:BestRank ; ps:P576 ?end .
        OPTIONAL { ?n psv:P576 [ wikibase:timePrecision ?endPrecision ] } }
      UNION { ?e wdt:P5817 ?use }
      UNION { ?e wdt:P5816 ?cons }
      UNION { ?e p:P1435 ?h . ?h a wikibase:BestRank ; ps:P1435 ?herit . FILTER NOT EXISTS { ?h pq:P582 ?hEnded }
        OPTIONAL { ?h pqv:P580 [ wikibase:timeValue ?heritSince ; wikibase:timePrecision ?heritSincePrecision ] } }
      UNION { ?e p:P571 ?i . ?i a wikibase:BestRank ; psv:P571 [ wikibase:timeValue ?inception ; wikibase:timePrecision ?inceptionPrecision ] }
      UNION { ?e p:P625 ?c . ?c a wikibase:BestRank ; pqv:P580 [ wikibase:timeValue ?placedSince ; wikibase:timePrecision ?placedSincePrecision ] .
        FILTER NOT EXISTS { ?c pq:P582 ?cEnded } }
      UNION { ?e wdt:P793 ?event }
    }`, { kind: 'entities', label: `whether ${qids.length} places still stand` });
  const out = new Map<string, LiveFacts>();
  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    if (!isQid(qid)) continue;
    const facts = out.get(qid) ?? {
      ended: false, endedYear: null, endedAt: null, use: new Set<string>(), conservation: new Set<string>(),
      designations: new Map<string, StatedTime | null>(), inceptions: [], placedSince: [], events: new Set<string>(),
    };
    addRow(facts, row);
    out.set(qid, facts);
  }
  return new Map([...out].map(([qid, { designations, ...f }]) => [qid, {
    ...f, use: [...f.use], conservation: [...f.conservation], events: [...f.events],
    heritage: designations.size > 0, designatedSince: [...designations.values()],
  }]));
}

/**
 * Refuse, by name and with the reason, every item the run would write that
 * Wikidata says is gone, after the kind's rule and its tiers have decided: the
 * items leave `items` and join `filtered`, so a place the catalogue already
 * offers is refused as any refusal of it is — held for a curator, never
 * deleted. `reasonOf` is the kind's reading: a place's (`goneReason`) unless
 * the kind holds works (`goneWorkReason`). Returns how many it refused, for
 * the run's log.
 */
export async function refuseGone<T>(
  items: T[], filtered: FilteredEntity[], sparql: SparqlFn,
  of: { id: (item: T) => string; name: (item: T) => string; type?: (item: T) => string | null | undefined },
  logPrefix: string,
  reasonOf: (facts: StandingFacts) => string | null = goneReason,
): Promise<number> {
  const facts = await fetchStandingFacts(sparql, items.map(of.id));
  const kept: T[] = [];
  const gone: string[] = [];
  for (const item of items) {
    const known = facts.get(of.id(item));
    const reason = known ? reasonOf(known) : null;
    if (!reason) { kept.push(item); continue; }
    const type = of.type?.(item);
    filtered.push({ externalId: of.id(item), name: of.name(item), reason, ...(type ? { type } : {}) });
    gone.push(of.name(item));
  }
  items.splice(0, items.length, ...kept);
  if (gone.length) console.log(`${logPrefix} Refused as gone: ${gone.join(', ')}`);
  return gone.length;
}
