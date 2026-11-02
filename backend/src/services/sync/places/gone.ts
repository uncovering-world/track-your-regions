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
 */

import type { FilteredEntity } from '../syncContract.js';
import { chunk, values, type SparqlFn } from '../wikidataQueries.js';
import { extractQid, isQid } from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import { subsetStandingFacts, type StandingFacts } from '../subset/standing.js';
import { moveRefused, type RefusedItemOf } from './lateRefusal.js';

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

async function liveStandingFacts(sparql: SparqlFn, qids: string[]): Promise<Map<string, StandingFacts>> {
  const rows = await sparql(`
    SELECT ?e ?end ?use ?cons ?herit WHERE {
      VALUES ?e { ${values(qids)} }
      OPTIONAL { ?e wdt:P576 ?end }
      OPTIONAL { ?e wdt:P5817 ?use }
      OPTIONAL { ?e wdt:P5816 ?cons }
      OPTIONAL { ?e p:P1435 ?h . ?h a wikibase:BestRank ; ps:P1435 ?herit . FILTER NOT EXISTS { ?h pq:P582 ?hEnded } }
    }`, { kind: 'entities', label: `whether ${qids.length} places still stand` });
  const out = new Map<string, { ended: boolean; endedYear: number | null; use: Set<string>; conservation: Set<string>; heritage: boolean }>();
  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    if (!isQid(qid)) continue;
    const facts = out.get(qid) ?? { ended: false, endedYear: null, use: new Set<string>(), conservation: new Set<string>(), heritage: false };
    if (row.end?.value) {
      facts.ended = true;
      const year = /^(-?\d+)-/.exec(row.end.value);
      if (year && facts.endedYear === null) facts.endedYear = Number(year[1]);
    }
    if (row.use?.value) facts.use.add(extractQid(row.use.value));
    if (row.cons?.value) facts.conservation.add(extractQid(row.cons.value));
    if (row.herit?.value) facts.heritage = true;
    out.set(qid, facts);
  }
  return new Map([...out].map(([qid, f]) => [qid, { ...f, use: [...f.use], conservation: [...f.conservation] }]));
}

/**
 * Refuse, by name and with the reason, every item the run would write that
 * Wikidata says is gone, after the kind's rule and its tiers have decided: the
 * items leave `items` and join `filtered`, so a place the catalogue already
 * offers is refused as any refusal of it is — held for a curator, never
 * deleted. Returns how many it refused, for the run's log.
 */
export async function refuseGone<T>(
  items: T[], filtered: FilteredEntity[], sparql: SparqlFn, of: RefusedItemOf<T>, logPrefix: string,
): Promise<number> {
  const facts = await fetchStandingFacts(sparql, items.map(of.id));
  const gone = moveRefused(items, filtered, of, (item) => {
    const known = facts.get(of.id(item));
    return known ? goneReason(known) : null;
  });
  if (gone.length) console.log(`${logPrefix} Refused as gone (#2259): ${gone.join(', ')}`);
  return gone.length;
}
