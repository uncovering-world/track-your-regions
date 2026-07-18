/**
 * Wikidata source for the country canon.
 *
 * One SPARQL query pulls every entity matching the membership rule inputs:
 * has an ISO 3166-1 alpha-2 code (P297), OR is DIRECTLY a state with limited
 * recognition (P31 Q10711424 — no P279* subclass traversal, see below), OR
 * holds current UN membership (P463 -> Q1065 with no end date). Facts
 * carried per row: ISO codes (P297/P298/P299), UN membership, limited
 * recognition, sovereign state (P17), claimed-by (P1336).
 *
 * Q10711424 ("state with limited recognition") is the LIVE class QID. The
 * originally documented Q15634554 was merged into it (SPARQL does not
 * follow entity redirects, so the stale QID silently matched zero rows —
 * task-9 calibration finding B); do not revert without re-checking
 * Special:EntityData/Q15634554.json.
 *
 * No `/wdt:P279*` after `wdt:P31`: transitively following Q10711424's
 * Wikidata subclass tree over-matches by ~25x (691 items live, vs. a
 * direct-instance count of 42) by pulling in unrelated subclasses such as
 * "umphakatsi" (Eswatini chiefdom, 329 instances), "traditional chiefdom in
 * Cameroon" (66), South African/South-West-African bantustans, and historical
 * "barbarian kingdom"/"Gothic kingdom" classes — discovered live-testing this
 * fix (task-9 fix-wave); direct `wdt:P31` was the plan's own pre-authorized
 * fallback for exactly this "wildly off" scenario. Re-check with the COUNT
 * query in country-canon-and-disputes-plan-1-data.md Task 3 Step 5 before
 * reintroducing the transitive form.
 *
 * FILTER NOT EXISTS { ?item wdt:P576 [] } (P576 = dissolved/abolished date)
 * excludes most historical entities whose UN-membership/limited-recognition
 * statements lack end-date qualifiers (task-9 finding S1) — confirmed live:
 * removes the Mongolian People's Republic, German Democratic Republic (DD),
 * Yugoslavia (YU), Kingdom of Laos and 9 similar historical-regime rows.
 * Known residual, verified against live Wikidata entity data (not a query
 * bug — do not add more filters for these without controller sign-off, see
 * task-9 report): Q644636 "British Cyprus" carries no P576 claim despite
 * ending in 1960, so it still races current Q229 "Republic of Cyprus" for
 * the `cy` slug — the pre-existing duplicate-iso2 dedup in buildCountries()
 * keeps whichever row the endpoint returns first, unresolved by this fix.
 * Q17765809 "Third Hellenic Republic" also has no P576 and carries its own
 * un-ended UN-membership statement, duplicating Greece the same way
 * Q756617 "Kingdom of Denmark" duplicated Denmark (see exceptions.json).
 */
import { sparqlQuery, extractQid, type SparqlBinding } from '../sync/wikidataUtils.js';
import type { WikidataCountryRow } from './types.js';

export const WIKIDATA_COUNTRIES_QUERY = `
SELECT ?item ?itemLabel ?iso2 ?iso3 ?isoNumeric ?unMember ?limited ?sovereign ?claimedBy WHERE {
  {
    { ?item wdt:P297 [] }
    UNION { ?item wdt:P31 wd:Q10711424 . }
    UNION { ?item p:P463 ?un . ?un ps:P463 wd:Q1065 . FILTER NOT EXISTS { ?un pq:P582 [] } }
  }
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  OPTIONAL { ?item wdt:P297 ?iso2 . }
  OPTIONAL { ?item wdt:P298 ?iso3 . }
  OPTIONAL { ?item wdt:P299 ?isoNumeric . }
  OPTIONAL {
    ?item p:P463 ?unSt . ?unSt ps:P463 wd:Q1065 .
    FILTER NOT EXISTS { ?unSt pq:P582 [] }
    BIND(true AS ?unMember)
  }
  OPTIONAL { ?item wdt:P31 wd:Q10711424 . BIND(true AS ?limited) }
  OPTIONAL { ?item wdt:P17 ?sovereign . }
  OPTIONAL { ?item wdt:P1336 ?claimedBy . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

function rowFromBinding(b: SparqlBinding, qid: string): WikidataCountryRow {
  const sovereignQid = b.sovereign ? extractQid(b.sovereign.value) : null;
  const isoNumeric = b.isoNumeric ? Number(b.isoNumeric.value) : NaN;
  return {
    qid,
    label: b.itemLabel?.value ?? qid,
    iso2: b.iso2?.value ?? null,
    iso3: b.iso3?.value ?? null,
    isoNumeric: Number.isFinite(isoNumeric) ? isoNumeric : null,
    isUnMember: b.unMember?.value === 'true',
    hasLimitedRecognition: b.limited?.value === 'true',
    sovereignQid: sovereignQid === qid ? null : sovereignQid,
    claimedByQids: [],
  };
}

// Backfill single-valued facts earlier rows lacked (endpoint row order is
// unspecified): first non-null value wins per field.
function backfillScalarFacts(row: WikidataCountryRow, b: SparqlBinding): void {
  if (row.iso2 === null && b.iso2) row.iso2 = b.iso2.value;
  if (row.iso3 === null && b.iso3) row.iso3 = b.iso3.value;
  if (row.isoNumeric === null && b.isoNumeric) {
    const n = Number(b.isoNumeric.value);
    if (Number.isFinite(n)) row.isoNumeric = n;
  }
}

function mergeRow(row: WikidataCountryRow, b: SparqlBinding, qid: string): void {
  if (b.unMember?.value === 'true') row.isUnMember = true;
  if (b.limited?.value === 'true') row.hasLimitedRecognition = true;
  const claimant = b.claimedBy ? extractQid(b.claimedBy.value) : null;
  if (claimant && !row.claimedByQids.includes(claimant)) row.claimedByQids.push(claimant);
  backfillScalarFacts(row, b);
  // Sovereign backfills the same first-non-null-wins way, except a
  // self-reference stays null (matches rowFromBinding).
  if (row.sovereignQid === null && b.sovereign) {
    const sov = extractQid(b.sovereign.value);
    if (sov !== qid) row.sovereignQid = sov;
  }
}

/** Pure: SPARQL bindings (one row per item×claimedBy) -> deduped country rows. */
export function parseWikidataBindings(bindings: SparqlBinding[]): WikidataCountryRow[] {
  const byQid = new Map<string, WikidataCountryRow>();
  for (const b of bindings) {
    if (!b.item) continue;
    const qid = extractQid(b.item.value);
    const existing = byQid.get(qid);
    const row = existing ?? rowFromBinding(b, qid);
    if (!existing) byQid.set(qid, row);
    mergeRow(row, b, qid);
  }
  return [...byQid.values()];
}

export async function fetchWikidataCountries(logPrefix: string): Promise<WikidataCountryRow[]> {
  const bindings = await sparqlQuery(WIKIDATA_COUNTRIES_QUERY, logPrefix);
  return parseWikidataBindings(bindings);
}
