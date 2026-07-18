/**
 * Wikidata source for the country canon.
 *
 * One SPARQL query pulls every entity matching the membership rule inputs:
 * has an ISO 3166-1 alpha-2 code (P297), OR is a state with limited
 * recognition (P31/P279* Q15634554), OR holds current UN membership
 * (P463 -> Q1065 with no end date). Facts carried per row: ISO codes
 * (P297/P298/P299), UN membership, limited recognition, sovereign state
 * (P17), claimed-by (P1336).
 */
import { sparqlQuery, extractQid, type SparqlBinding } from '../sync/wikidataUtils.js';
import type { WikidataCountryRow } from './types.js';

export const WIKIDATA_COUNTRIES_QUERY = `
SELECT ?item ?itemLabel ?iso2 ?iso3 ?isoNumeric ?unMember ?limited ?sovereign ?claimedBy WHERE {
  {
    { ?item wdt:P297 [] }
    UNION { ?item wdt:P31/wdt:P279* wd:Q15634554 . }
    UNION { ?item p:P463 ?un . ?un ps:P463 wd:Q1065 . FILTER NOT EXISTS { ?un pq:P582 [] } }
  }
  OPTIONAL { ?item wdt:P297 ?iso2 . }
  OPTIONAL { ?item wdt:P298 ?iso3 . }
  OPTIONAL { ?item wdt:P299 ?isoNumeric . }
  OPTIONAL {
    ?item p:P463 ?unSt . ?unSt ps:P463 wd:Q1065 .
    FILTER NOT EXISTS { ?unSt pq:P582 [] }
    BIND(true AS ?unMember)
  }
  OPTIONAL { ?item wdt:P31/wdt:P279* wd:Q15634554 . BIND(true AS ?limited) }
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
