/**
 * What the coverage report reads: the loaded expectation tables, and for each
 * expectation what the catalogue holds under its identifiers and at its spot
 * (ADR-0081).
 *
 * "Offered to a reader" is never spelled here. A place is offered when a kind's
 * count would count it (`countedMembershipSql`), a work when it is passed and a
 * museum a reader may go to shows it (`venuesShowingSql`): the same fragments
 * the lists and the counts compose, so the report cannot call found what a
 * visitor does not see. That is why this lives in the controller layer, as the
 * Catalogue Checks rules do.
 */

import { pool } from '../../../db/index.js';
import { MEMBERSHIPS } from '../../../db/membership.js';
import { offeredLocationSql, publishedContentSql } from '../../../db/readerPredicates.js';
import type {
  CoverageExpectationsRow, CoverageKindsRow, CoverageRegionsRow, ExperienceLocationsRow, ExperiencesRow,
} from '../../../db/schema.generated.js';
import { countedMembershipSql } from '../../experience/experienceCounts.js';
import { venuesShowingSql } from '../../experience/siteFinds.js';

export type KindRow = Pick<CoverageKindsRow, 'slug' | 'name' | 'form' | 'status' | 'experience_kind_id' | 'issue_number'> & {
  /** The sitelinks a place needs to enter this kind's world tier, where its source states one. */
  enter_sitelinks: number | null;
};

export type RegionRow = Pick<CoverageRegionsRow, 'slug' | 'name' | 'country'> & { surveyed: string };

export type ExpectationRow = Pick<
  CoverageExpectationsRow, 'region_slug' | 'slug' | 'name' | 'type' | 'source_count' | 'sitelinks'
> & { kinds: string[] };

/** One catalogue row an expectation's identifiers match. `kind_id` is null for a work. */
export interface MatchRow {
  region_slug: string;
  slug: string;
  catalogue_name: ExperiencesRow['name'];
  kind_id: number | null;
  offered: boolean;
}

/** One offered catalogue point within reach of an expectation the catalogue was not matched to by id. */
export interface NearbyRow {
  region_slug: string;
  slug: string;
  place: ExperiencesRow['name'];
  point: NonNullable<ExperienceLocationsRow['name']>;
  metres: number;
}

export interface CoverageFacts {
  kinds: KindRow[];
  regions: RegionRow[];
  expectations: ExpectationRow[];
  matches: MatchRow[];
  nearby: NearbyRow[];
}

const KINDS_SQL = `
  SELECT ck.slug, ck.name, ck.form, ck.status, ck.experience_kind_id, ck.issue_number,
         (SELECT MIN((s.api_config->>'enterSitelinks')::int)
            FROM experience_sources s
           WHERE s.kind_id = ck.experience_kind_id AND s.is_active) AS enter_sitelinks
    FROM coverage_kinds ck
   ORDER BY ck.slug`;

const REGIONS_SQL = `
  SELECT cr.slug, cr.name, cr.country, to_char(cr.surveyed, 'YYYY-MM-DD') AS surveyed
    FROM coverage_regions cr
   WHERE ($1::text[] IS NULL OR cr.slug = ANY($1))
   ORDER BY cr.name`;

const EXPECTATIONS_SQL = `
  SELECT x.region_slug, x.slug, x.name, x.type, x.source_count, x.sitelinks,
         ARRAY(SELECT xk.kind_slug
                 FROM coverage_expectation_kinds xk
                WHERE xk.region_slug = x.region_slug AND xk.expectation_slug = x.slug
                ORDER BY xk.kind_slug) AS kinds
    FROM coverage_expectations x
   WHERE ($1::text[] IS NULL OR x.region_slug = ANY($1))
   ORDER BY x.region_slug, x.source_count DESC, x.sitelinks DESC NULLS LAST, x.name`;

/**
 * By identifier and never by name. An entry's identifiers are its Wikidata id,
 * the ids named as the same place, and UNESCO's id of an inscribed property;
 * each is looked up among the places and among the works, whatever the entry's
 * type, since a statue a guide calls a work is a place in the catalogue. A
 * UNESCO id is digits and a Wikidata id starts with Q, so one column of
 * identifiers answers for both without mistaking them.
 */
const MATCHES_SQL = `
  WITH ids AS (
    SELECT x.region_slug, x.slug, x.wikidata_id AS id
      FROM coverage_expectations x
     WHERE x.wikidata_id IS NOT NULL AND ($1::text[] IS NULL OR x.region_slug = ANY($1))
    UNION
    SELECT x.region_slug, x.slug, same.id
      FROM coverage_expectations x
      CROSS JOIN LATERAL unnest(x.same_as) AS same(id)
     WHERE ($1::text[] IS NULL OR x.region_slug = ANY($1))
    UNION
    SELECT x.region_slug, x.slug, x.unesco_id
      FROM coverage_expectations x
     WHERE x.unesco_id IS NOT NULL AND ($1::text[] IS NULL OR x.region_slug = ANY($1))
  )
  SELECT ids.region_slug, ids.slug, e.name AS catalogue_name, m.kind_id,
         (${countedMembershipSql('m', 'e')}) AS offered
    FROM ids
    JOIN experiences e ON e.external_id = ids.id
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
  UNION ALL
  SELECT ids.region_slug, ids.slug, t.name AS catalogue_name, NULL::int AS kind_id,
         (${publishedContentSql('t')} AND EXISTS (SELECT 1 ${venuesShowingSql('t')})) AS offered
    FROM ids
    JOIN treasures t ON t.external_id = ids.id`;

/**
 * What stands where an expectation is: every offered point of an offered place
 * within the given metres. The degree test is the index's prefilter and the
 * geography test is the measure.
 */
const NEARBY_SQL = `
  SELECT x.region_slug, x.slug, e.name AS place, COALESCE(el.name, '') AS point,
         round(ST_Distance(el.location::geography, x.location::geography))::int AS metres
    FROM coverage_expectations x
    JOIN experience_locations el
      ON ST_DWithin(el.location, x.location, 0.01)
     AND ST_DWithin(el.location::geography, x.location::geography, $2)
    JOIN experiences e ON e.id = el.experience_id
   WHERE x.location IS NOT NULL
     AND ($1::text[] IS NULL OR x.region_slug = ANY($1))
     AND ${offeredLocationSql('el')}
     AND ${publishedContentSql('el')}
     AND EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id AND ${countedMembershipSql('m', 'e')})
   ORDER BY x.region_slug, x.slug, metres, e.name`;

/** How near a catalogue point must be to count as standing at an expectation's spot. */
export const SAME_SPOT_METRES = 250;

/** Read everything the report is built from, for every region or for `regionSlugs`. */
export async function readCoverageFacts(regionSlugs?: string[]): Promise<CoverageFacts> {
  const only = regionSlugs ?? null;
  const [kinds, regions, expectations, matches, nearby] = await Promise.all([
    pool.query<KindRow>(KINDS_SQL),
    pool.query<RegionRow>(REGIONS_SQL, [only]),
    pool.query<ExpectationRow>(EXPECTATIONS_SQL, [only]),
    pool.query<MatchRow>(MATCHES_SQL, [only]),
    pool.query<NearbyRow>(NEARBY_SQL, [only, SAME_SPOT_METRES]),
  ]);
  return { kinds: kinds.rows, regions: regions.rows, expectations: expectations.rows, matches: matches.rows, nearby: nearby.rows };
}

/** The statements, for the spec that holds them to the fragments they compose. */
export const coverageSql = { KINDS_SQL, REGIONS_SQL, EXPECTATIONS_SQL, MATCHES_SQL, NEARBY_SQL };
