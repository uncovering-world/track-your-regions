/**
 * A World Heritage Site's inscription as a read asks for it, and as the
 * UNESCO run's record names it (ADR-0153, ADR-0225, #2068, #2127).
 *
 * UNESCO's facts about an inscription are the World Heritage kind's, held on
 * that kind's membership in typed tables, never on the place:
 *
 * - `record_heritage_inscriptions`: the criteria, the area, whether the
 *   property crosses a border, and UNESCO's region (the Struve Geodetic Arc:
 *   (ii)(iii)(vi), ten countries);
 * - `record_danger_periods`: each stay on the List of World Heritage in Danger
 *   (Cologne Cathedral 2004 to 2006, Bamiyan since 2003);
 * - `record_listings`: the membership's listing, whose start is the year of
 *   inscription (Cologne Cathedral 1996) and whose end is a delisting
 *   (Liverpool, 21 July 2021).
 *
 * A reader is shown the year and the open stay while the membership is
 * offered and not judged former. A site a curator confirms UNESCO delisted,
 * kept as a former World Heritage Site (`KINDS_KEPT_AS_FORMER`), shows neither
 * a danger badge nor an inscription year: Liverpool was on the danger list when
 * it was delisted in 2021, and a badge then would claim a listing that ended. A
 * membership a run merely did not see (`missing_since`, not yet judged) keeps
 * both, since a source outage must not change what a reader sees
 * (`readerPredicates.ts`). Placement reads the inscribed area whatever the
 * membership's state: how far a site reaches is a fact about the ground.
 *
 * The run's record still names these facts as it always did (`dateInscribed`,
 * `inDanger`, `dangerList`, `criteria`, `region`, `areaHectares`,
 * `transboundary`), so its diff, its change records and a held proposal keep
 * their `metadata.<key>` names (`@tyr/shared/placeFields`). `inscriptionOf`
 * reads those names into the typed facts and `inscriptionFacts` writes them back
 * in one canonical form, which `inscriptionFactsOfRecordSql` rebuilds from the
 * tables: what a run sends and what it reads back compare alike.
 */

import { parseDangerListing } from '../services/sync/dangerListing.js';
import { MEMBERSHIPS, membershipOfferedSql } from './membership.js';

/** World Heritage Sites, the kind whose membership holds a site's inscription. */
export const WORLD_HERITAGE_KIND_ID = 1;

/** UNESCO, the source whose run reads the inscription. */
export const UNESCO_SOURCE_ID = 1;

/** The keys of the run's record that are the inscription's, held in the typed tables. */
export const INSCRIPTION_FACT_KEYS = [
  'dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'areaHectares', 'transboundary',
] as const;

/** Whether a key of the run's record is the inscription's. */
export const isInscriptionFact = (key: string): boolean => (INSCRIPTION_FACT_KEYS as readonly string[]).includes(key);

/** UNESCO's regions, the vocabulary `record_heritage_inscriptions.unesco_region` holds. */
export const UNESCO_REGIONS = [
  'Africa', 'Arab States', 'Asia and the Pacific', 'Europe and North America', 'Latin America and the Caribbean',
] as const;

/** The largest area the column holds, in hectares (numeric(14,2)). */
const AREA_CEILING_HA = 1e12;

/** What UNESCO says of an inscription, typed. */
export interface Inscription {
  /** The year of inscription: the start of the membership's listing. */
  inscribedYear: number | null;
  /** On the List of World Heritage in Danger now. */
  inDanger: boolean;
  /** The year the current stay began, where the listing gives one. */
  dangerSince: number | null;
  /** The criteria, each as UNESCO writes it: `(ii)`. Null where none is read. */
  criteria: string[] | null;
  region: string | null;
  /** The inscribed area in hectares, to the hundredth. */
  areaHa: number | null;
  transboundary: boolean;
}

/** One criterion, the longer numerals first so `(iii)` is not read as `(i)`. */
const CRITERION = /\((viii|vii|vi|iv|v|ix|x|iii|ii|i)\)/gi;

function criteriaOf(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  const found = [...value.matchAll(CRITERION)].map(match => `(${match[1].toLowerCase()})`);
  return found.length > 0 ? found : null;
}

function yearOf(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^\s*(\d{4})/.exec(String(value));
  return match ? Number(match[1]) : null;
}

function areaOf(value: unknown): number | null {
  const area = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof area !== 'number' || !Number.isFinite(area) || area <= 0 || area >= AREA_CEILING_HA) return null;
  const rounded = Math.round(area * 100) / 100;
  return rounded > 0 && rounded < AREA_CEILING_HA ? rounded : null;
}

const regionOf = (value: unknown): string | null =>
  (typeof value === 'string' && (UNESCO_REGIONS as readonly string[]).includes(value) ? value : null);

/**
 * The inscription the run's record states, read by its keys. The flag says
 * whether the site is in danger wherever it is given: the run sends it as
 * `isInDanger` already read it from the flag and the dated listing, and a
 * curator who publishes `inDanger: false` alone onto a site whose stay is
 * open takes the badge off, though the listing read back from the tables
 * still says "Y 2003". Only a record with no flag is read off the listing:
 * "Y 2013" for the Ancient City of Aleppo.
 */
export function inscriptionOf(facts: Readonly<Record<string, unknown>>): Inscription {
  const listing = parseDangerListing(facts.dangerList);
  const inDanger = typeof facts.inDanger === 'boolean' ? facts.inDanger : listing?.listed === true;
  return {
    inscribedYear: yearOf(facts.dateInscribed),
    inDanger,
    dangerSince: inDanger ? listing?.since ?? null : null,
    criteria: criteriaOf(facts.criteria),
    region: regionOf(facts.region),
    areaHa: areaOf(facts.areaHectares),
    transboundary: facts.transboundary === true,
  };
}

/**
 * The inscription under the run's record's keys, in the one form the tables
 * give back (`inscriptionFactsOfRecordSql`): the year as text, the criteria
 * joined, the listing "Y 2013" (or "Y" with no year) while in danger and null
 * otherwise.
 */
export function inscriptionFacts(inscription: Inscription): Record<string, unknown> {
  const { inDanger, dangerSince } = inscription;
  const listed = dangerSince === null ? 'Y' : `Y ${dangerSince}`;
  return {
    dateInscribed: inscription.inscribedYear === null ? null : String(inscription.inscribedYear),
    inDanger,
    dangerList: inDanger ? listed : null,
    criteria: inscription.criteria === null ? null : inscription.criteria.join(''),
    region: inscription.region,
    areaHectares: inscription.areaHa,
    transboundary: inscription.transboundary,
  };
}

/** A record's facts split into the inscription's keys and the rest, which stay in `facts`. */
export function splitInscriptionFacts(facts: Readonly<Record<string, unknown>>): {
  inscription: Record<string, unknown> | null;
  rest: Record<string, unknown>;
} {
  const entries = Object.entries(facts);
  const own = entries.filter(([key]) => isInscriptionFact(key));
  return {
    inscription: own.length > 0 ? Object.fromEntries(own) : null,
    rest: Object.fromEntries(entries.filter(([key]) => !isInscriptionFact(key))),
  };
}

/**
 * The id of the place's World Heritage membership a reader is shown: offered
 * and not judged former.
 */
function shownRecordSql(experience: string): string {
  return `(SELECT wh.id FROM ${MEMBERSHIPS} wh
            WHERE wh.experience_id = ${experience}.id AND wh.kind_id = ${WORLD_HERITAGE_KIND_ID}
              AND ${membershipOfferedSql('wh')} AND wh.source_membership = 'present')`;
}

/**
 * The year of inscription a reader is shown, as text ("1996" for Cologne
 * Cathedral): the start of the first listing of the shown membership, or NULL
 * where there is none.
 */
export function inscriptionYearSql(experience = 'e'): string {
  return `(SELECT l.from_year::text FROM record_listings l
            WHERE l.record_id = ${shownRecordSql(experience)}
            ORDER BY l.ordinal LIMIT 1)`;
}

/**
 * The stay on the List of World Heritage in Danger a reader is shown, as a
 * `jsonb` `{"since": 2003}` (Bamiyan; `null` where the year is not known),
 * or NULL where the shown membership has no open stay or there is none.
 */
export function dangerStaySql(experience = 'e'): string {
  return `(SELECT jsonb_build_object('since', d.from_year) FROM record_danger_periods d
            WHERE d.record_id = ${shownRecordSql(experience)} AND NOT d.ended)`;
}

/**
 * The area UNESCO inscribed, in hectares, as a `numeric`, or NULL where the
 * place holds no World Heritage membership or the list states no area.
 */
export function inscribedAreaSql(experience = 'e'): string {
  return `(SELECT i.area_ha FROM ${MEMBERSHIPS} wh
             JOIN record_heritage_inscriptions i ON i.record_id = wh.id
            WHERE wh.experience_id = ${experience}.id AND wh.kind_id = ${WORLD_HERITAGE_KIND_ID})`;
}

/**
 * A record's inscription under the run's record's keys, as a `jsonb` object in
 * `inscriptionFacts`' form, or NULL on a record that holds none: what the run's
 * diff compares its record with, and what publishing a held fact merges onto.
 * `record` is the `source_records` alias.
 */
export function inscriptionFactsOfRecordSql(record: string): string {
  return `(SELECT jsonb_build_object(
              'dateInscribed', (SELECT l.from_year::text FROM record_listings l
                                 WHERE l.record_id = i.record_id ORDER BY l.ordinal LIMIT 1),
              'inDanger', d.record_id IS NOT NULL,
              'dangerList', CASE WHEN d.record_id IS NULL THEN NULL
                                 WHEN d.from_year IS NULL THEN 'Y' ELSE 'Y ' || d.from_year END,
              'criteria', array_to_string(i.criteria, ''),
              'region', i.unesco_region,
              'areaHectares', i.area_ha,
              'transboundary', i.transboundary)
            FROM record_heritage_inscriptions i
            LEFT JOIN record_danger_periods d ON d.record_id = i.record_id AND NOT d.ended
           WHERE i.record_id = ${record}.id)`;
}
