/**
 * A place's country, where its own statements leave it open, read from where its
 * point lies (#1564): the GADM country that holds the point, the same answer the
 * region tree gives when a visitor browses by country.
 *
 * Among several standing countries it is the one whose territory holds the point
 * — the Basilica of Sant'Ambrogio is in Italy, whatever Wikidata lists first —
 * and, when none of them is that country (a statement that names only wrong
 * countries, a border GADM leaves open), the readers' own choice stays. When no
 * country stands at all it is the GADM country itself: Mediolanum, stated only in
 * Ancient Rome, is in Italy. A point in no GADM country (at sea, on another globe)
 * changes nothing. A country no statement ended stands only as one of today's
 * states (#1575): a sovereign state, or the GADM country itself — Denmark
 * (Q35), the constituent country a Danish church is stated in — so Shechem, stated only in the
 * United Kingdom of Israel, is named by its point too. Where the GADM country
 * itself is the answer it is written as the sovereign state (`P31` sovereign
 * state, Q3624078, as the local subset keeps them) one of whose labels is GADM's
 * name, in the label the readers give it —
 * Chang'an, stated only in dynasties that are gone, reads "People's Republic of
 * China" like every other Chinese place rather than GADM's "China" — and in GADM's
 * spelling only when no state matches. The same set answers every read, so a
 * place is named alike whichever batch it is read in.
 *
 * A candidate is matched by any label the local subset keeps for its item, in any
 * language it keeps, against the GADM country's name, both folded and without
 * diacritics: Wikidata's English "People's Republic of China" is GADM's "China"
 * through its German label, and its "Mexico" is GADM's "México".
 */

import { foldLabel } from '@tyr/shared/labels';
import { pool } from '../../../db/index.js';
import { BEST, termsOf } from '../subset/entities.js';
import type { CountryOption, CountryOptions } from './countryOfPlace.js';
import type { PoolEntity } from './queries.js';

/** A name reduced to what it names, its diacritics removed. */
function folded(name: string): string {
  return foldLabel(name.normalize('NFD').replace(/\p{M}/gu, ''));
}

/** The first of `countries` one of whose names is the GADM country's. */
function matching(
  countries: readonly CountryOption[], gadmCountry: string, namesOf: ReadonlyMap<string, readonly string[]>,
): CountryOption | undefined {
  const wanted = folded(gadmCountry);
  return countries.find(country => [country.label, ...(country.qid ? namesOf.get(country.qid) ?? [] : [])]
    .some(name => folded(name) === wanted));
}

/**
 * The candidate whose names include the GADM country's; when no candidate
 * stands, or none that does is a sovereign state and none is GADM's country
 * (#1575: Shechem's United Kingdom of Israel, an item the reader holds nothing
 * of), the GADM country itself, written as the sovereign state among `states`
 * it names where one matches; or null to keep the readers' choice.
 */
export function chooseByPoint(
  options: CountryOptions, gadmCountry: string, namesOf: ReadonlyMap<string, readonly string[]>,
  states: readonly CountryOption[] = [],
): string | null {
  const gadm = () => matching(states, gadmCountry, namesOf)?.label ?? gadmCountry;
  if (options.noneStands) return gadm();
  const candidate = matching(options.candidates, gadmCountry, namesOf);
  if (candidate) return candidate.label;
  return options.candidates.some(c => c.sovereign) ? null : gadm();
}

/**
 * GADM's continents, the roots of its tree that are not countries. A root that is
 * none of them is a country filed at the root — Australia, whose children are its
 * states — and the country is the root itself.
 */
const GADM_CONTINENTS = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];

/**
 * The GADM country each point lies in, by key. The point is found in a leaf
 * division and walked up to the division under a continent, or to a root that is
 * no continent: a country's own polygon is too large to test a point against in
 * time (3.3 s for Milan against Italy, 2 ms through its comune).
 */
export async function gadmCountriesAt(points: ReadonlyArray<{ key: string; lon: number; lat: number }>): Promise<Map<string, string>> {
  if (!points.length) return new Map();
  const result = await pool.query<{ key: string; name: string }>(`
    SELECT p.key, c.name
      FROM unnest($1::text[], $2::float8[], $3::float8[]) AS p(key, lon, lat)
      CROSS JOIN LATERAL (
        WITH RECURSIVE up AS (
          SELECT leaf.id, leaf.parent_id, leaf.name FROM (
            SELECT d.id, d.parent_id, d.name FROM administrative_divisions d
             WHERE NOT d.has_children AND ST_Intersects(d.geom, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
             ORDER BY d.id
             LIMIT 1
          ) leaf
          UNION ALL
          SELECT a.id, a.parent_id, a.name FROM administrative_divisions a JOIN up ON a.id = up.parent_id
        )
        SELECT COALESCE(
          (SELECT up.name FROM up JOIN administrative_divisions r ON r.id = up.parent_id
            WHERE r.parent_id IS NULL AND r.name = ANY($4::text[])),
          (SELECT up.name FROM up WHERE up.parent_id IS NULL AND NOT up.name = ANY($4::text[]))
        ) AS name
      ) c
     WHERE c.name IS NOT NULL`,
    [points.map(p => p.key), points.map(p => p.lon), points.map(p => p.lat), GADM_CONTINENTS],
  );
  return new Map(result.rows.map(row => [row.key, row.name]));
}

/**
 * The sovereign states the local subset keeps (best-rank `P31` Q3624078), each in
 * the label the readers give an item: some two hundred, the same for every read.
 */
async function sovereignStates(): Promise<CountryOption[]> {
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
      WHERE c.property = 'P31' AND c.value_item = 'Q3624078' AND c.rank >= 0 AND ${BEST('c')}`,
  );
  const ids = result.rows.map(row => row.subject);
  const terms = await termsOf(ids);
  return ids.map(qid => ({ qid, label: terms.get(qid)?.label ?? qid, sovereign: true }));
}

/** Every label the local subset keeps for each item, in any language. */
async function namesOf(qids: string[]): Promise<Map<string, string[]>> {
  if (!qids.length) return new Map();
  const result = await pool.query<{ id: string; label: string }>(
    'SELECT id, label FROM wikidata_labels WHERE id = ANY($1::text[]) AND label IS NOT NULL', [qids],
  );
  const out = new Map<string, string[]>();
  for (const row of result.rows) out.set(row.id, [...(out.get(row.id) ?? []), row.label]);
  return out;
}

/** Names each entity whose statements left the country open by where its point lies, in place. */
export async function settleCountriesByPoint(entities: PoolEntity[]): Promise<PoolEntity[]> {
  const open = entities.filter(e => e.countryOptions && e.lat !== null && e.lon !== null && e.onEarth);
  if (!open.length) return entities;
  // The words a GADM country is written in when it is the answer itself, read
  // only when some place may need it: no standing country, or no sovereign one.
  const states = open.some(e => e.countryOptions!.noneStands || !e.countryOptions!.candidates.some(c => c.sovereign))
    ? await sovereignStates() : [];
  const candidateItems = open.flatMap(e => e.countryOptions!.candidates.flatMap(c => (c.qid ? [c.qid] : [])));
  const [countries, names] = await Promise.all([
    gadmCountriesAt(open.map(e => ({ key: e.qid, lon: e.lon!, lat: e.lat! }))),
    namesOf([...new Set([...candidateItems, ...states.map(s => s.qid!)])]),
  ]);
  for (const entity of open) {
    const gadmCountry = countries.get(entity.qid);
    const choice = gadmCountry ? chooseByPoint(entity.countryOptions!, gadmCountry, names, states) : null;
    if (choice) entity.countryLabel = choice;
  }
  return entities;
}
