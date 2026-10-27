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
import { MEMBERSHIPS, realKindSql } from '../../../db/membership.js';
import { offeredLocationSql, publishedContentSql } from '../../../db/readerPredicates.js';
import type {
  CoverageCalibrationEntriesRow, CoverageCalibrationSourcesRow, CoverageExpectationsRow, CoverageJudgementsRow, CoverageKindsRow,
  CoverageRegionsRow, ExperienceLocationsRow, ExperiencesRow,
} from '../../../db/schema.generated.js';
import { countedMembershipSql } from '../../experience/experienceCounts.js';
import { arrivalWaitingSql } from '../../experience/waitingCounts.js';
import { venuesShowingSql } from '../../experience/siteFinds.js';
import { placePointsSql } from '../../../db/placePoints.js';

export type KindRow = Pick<CoverageKindsRow, 'slug' | 'name' | 'form' | 'status' | 'experience_kind_id' | 'issue_number' | 'in_venue'> & {
  /** The sitelinks a place needs to enter this kind's world tier, where its source states one. */
  enter_sitelinks: number | null;
  /** For a kind of work, the finds' line a source row states: a find under it links to no venue. */
  find_enter_sitelinks: number | null;
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

/** One line of the judgement ledger as loaded; `judged` as a date string. */
export type JudgementRow = Pick<CoverageJudgementsRow, 'region_slug' | 'entry_slug' | 'kind_slug' | 'row_wikidata_id' | 'cause' | 'issue_number' | 'note'> & { judged: string };

/** One offered place within a surveyed region's reach that no entry of the region names (#1601). */
export interface UnnamedRow {
  region_slug: string;
  experience_id: number;
  name: ExperiencesRow['name'];
  /** The Wikidata id the place is known by, its own before a membership's; null for a place only a source's id names. */
  wikidata_id: string | null;
  /** The kinds that offer it, by `experience_kinds` id. */
  kind_ids: number[];
  /** The place's own sitelinks as its source recorded them; null where the source records none (a museum, an inscribed property). */
  sitelinks: number | null;
  /** Kilometres from the region's centre to its nearest offered point, rounded. */
  km: number;
}

/**
 * One top of a kind's calibration list (#1864) with where it stands to the kind: offered
 * by it, held in the catalogue and not offered, refused by the kind's latest real run with
 * the reason it recorded, or absent, nothing holding it and no run naming it.
 */
export type CalibrationRow = Pick<CoverageCalibrationEntriesRow, 'kind_slug' | 'slug' | 'name' | 'wikidata_id' | 'sitelinks'> & {
  sources: string[];
  /** A kind of place offers a place known by the item; for a kind of work, a venue a reader may go to shows a treasure the item names. */
  offered: boolean;
  /** The kind admits a place known by the item, which a reader does not see yet: it waits for a curator. Never set for a work. */
  admitted: boolean;
  /**
   * Not offered, and the catalogue holds the item all the same: the name of one place known by it that the kind
   * does not offer, or for a work the name of the treasure no such venue shows; else null.
   */
  held_as: string | null;
  /** What the latest real, closed run of one of the kind's sources said when it refused the item; null where none did. */
  refused_for: string | null;
};

export type CalibrationSourceRow = Pick<CoverageCalibrationSourcesRow, 'slug' | 'name' | 'url' | 'note'> & { read: string };

export interface CoverageFacts {
  kinds: KindRow[];
  regions: RegionRow[];
  expectations: ExpectationRow[];
  matches: MatchRow[];
  nearby: NearbyRow[];
  judgements: JudgementRow[];
  unnamed: UnnamedRow[];
  calibration: CalibrationRow[];
  calibrationSources: CalibrationSourceRow[];
}

const KINDS_SQL = `
  SELECT ck.slug, ck.name, ck.form, ck.status, ck.experience_kind_id, ck.issue_number, ck.in_venue,
         (SELECT MIN((s.api_config->>'enterSitelinks')::int)
            FROM experience_sources s
           WHERE s.kind_id = ck.experience_kind_id AND s.is_active) AS enter_sitelinks,
         (SELECT MIN((s.api_config->>'findEnterSitelinks')::int)
            FROM experience_sources s
           WHERE ck.form = 'work' AND s.is_active) AS find_enter_sitelinks
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
 * Every identifier a place is known by: its own `external_id`, each membership's
 * (a run finds a place by the id on its membership, ADR-0084), and the Wikidata
 * items a membership resolves a site to. A UNESCO-first place Archaeology knows
 * by its Wikidata item is found by either id. `own` says which is the place's own.
 */
const KNOWN_AS_SQL = `
    SELECT e.id AS experience_id, e.external_id AS id, true AS own FROM experiences e
    UNION
    SELECT m.experience_id, m.external_id, false FROM ${MEMBERSHIPS} m WHERE ${realKindSql('m')}
    UNION
    SELECT m.experience_id, item, false FROM ${MEMBERSHIPS} m CROSS JOIN LATERAL unnest(m.wikidata_items) AS item
     WHERE ${realKindSql('m')}`;

/**
 * By identifier and never by name. An entry's identifiers are its Wikidata id,
 * the ids named as the same place, and UNESCO's id of an inscribed property;
 * each is looked up among the places, by every id a place is known by, and
 * among the works, whatever the entry's type, since a statue a guide calls a
 * work is a place in the catalogue. A UNESCO id is digits and a Wikidata id
 * starts with Q, so one column of identifiers answers for both without
 * mistaking them.
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
  ), known_as AS (${KNOWN_AS_SQL}
  )
  SELECT DISTINCT ids.region_slug, ids.slug, e.name AS catalogue_name, m.kind_id,
         (${countedMembershipSql('m', 'e')}) AS offered
    FROM ids
    JOIN known_as k ON k.id = ids.id
    JOIN experiences e ON e.id = k.experience_id
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
    -- Under every place that shows the point, a part's site included (ADR-0100).
    JOIN ${placePointsSql()} pp ON pp.location_id = el.id
    JOIN experiences e ON e.id = pp.place_id
   WHERE x.location IS NOT NULL
     AND ($1::text[] IS NULL OR x.region_slug = ANY($1))
     AND ${offeredLocationSql('el')}
     AND ${publishedContentSql('el')}
     AND EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id AND ${countedMembershipSql('m', 'e')})
   ORDER BY x.region_slug, x.slug, metres, e.name`;

/** The ledger as loaded (ADR-0116): every judgement of the regions asked for, entries and rows alike. */
const JUDGEMENTS_SQL = `
  SELECT j.region_slug, j.entry_slug, j.kind_slug, j.row_wikidata_id, j.cause, j.issue_number,
         to_char(j.judged, 'YYYY-MM-DD') AS judged, j.note
    FROM coverage_judgements j
   WHERE ($1::text[] IS NULL OR j.region_slug = ANY($1))
   ORDER BY j.region_slug, j.entry_slug NULLS LAST, j.kind_slug, j.row_wikidata_id`;

/**
 * The other direction (#1601): what a region offers that no guide names. Every
 * offered place with an offered, published point within the region's reach,
 * none of whose identifiers (`KNOWN_AS_SQL`) matches an identifier an entry of
 * the region names: the same identifiers and the same `named` set as
 * `MATCHES_SQL`, so a place the lists find is never also a place the lists do
 * not name. The place's own sitelinks are what its source recorded on it; a
 * museum and an inscribed property carry none.
 *
 * The identifiers are read once for the places reached and joined, not asked
 * per row: the `known_as` set is the whole catalogue's, and a correlated
 * subquery over it ran for seconds where the joins run in tens of milliseconds.
 */
const UNNAMED_SQL = `
  WITH named AS (
    SELECT x.region_slug, x.wikidata_id AS id
      FROM coverage_expectations x
     WHERE x.wikidata_id IS NOT NULL AND ($1::text[] IS NULL OR x.region_slug = ANY($1))
    UNION
    SELECT x.region_slug, same.id
      FROM coverage_expectations x
      CROSS JOIN LATERAL unnest(x.same_as) AS same(id)
     WHERE ($1::text[] IS NULL OR x.region_slug = ANY($1))
    UNION
    SELECT x.region_slug, x.unesco_id
      FROM coverage_expectations x
     WHERE x.unesco_id IS NOT NULL AND ($1::text[] IS NULL OR x.region_slug = ANY($1))
  ), reach AS (
    -- The reach in degrees, for the index's prefilter: a degree of longitude is 111 km at the
    -- equator and shrinks with the cosine of the latitude, so the circle in degree space is
    -- drawn at the reach over that cosine, with a tenth over for the ellipsoid. A reach that
    -- comes within six degrees of a pole is drawn over the whole world instead: there a
    -- circle in degrees misses a point a kilometre away across the meridians, and no reach
    -- in degree space is wider than 360. The geography test is the measure.
    SELECT r.slug, r.centre, r.radius_km,
           CASE WHEN abs(ST_Y(r.centre)) + r.radius_km / 111.0 >= 84 THEN 360
                ELSE r.radius_km / 111.0 / cos(radians(ST_Y(r.centre))) * 1.1 END AS degrees,
           -- The centre's twin across the antimeridian, so a reach over it is tested on both sides.
           ST_Translate(r.centre, CASE WHEN ST_X(r.centre) >= 0 THEN -360 ELSE 360 END, 0) AS twin
      FROM coverage_regions r
     WHERE ($1::text[] IS NULL OR r.slug = ANY($1))
  ), reached AS (
    SELECT rc.slug AS region_slug, e.id AS experience_id, e.name, e.metadata,
           round(MIN(ST_Distance(el.location::geography, rc.centre::geography)) / 1000)::int AS km
      FROM reach rc
      JOIN experience_locations el
        ON (ST_DWithin(el.location, rc.centre, rc.degrees) OR ST_DWithin(el.location, rc.twin, rc.degrees))
       AND ST_DWithin(el.location::geography, rc.centre::geography, rc.radius_km * 1000)
      -- Under every place that shows the point, a part's site included (ADR-0100).
      JOIN ${placePointsSql()} pp ON pp.location_id = el.id
      JOIN experiences e ON e.id = pp.place_id
     WHERE ${offeredLocationSql('el')}
       AND ${publishedContentSql('el')}
       AND EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id AND ${countedMembershipSql('m', 'e')})
     GROUP BY rc.slug, e.id
  ), known_as AS (
    SELECT k.* FROM (${KNOWN_AS_SQL}
    ) k
     WHERE k.experience_id IN (SELECT experience_id FROM reached)
  ), named_places AS (
    SELECT DISTINCT k.experience_id, n.region_slug
      FROM known_as k
      JOIN named n ON n.id = k.id
  ), items AS (
    SELECT k.experience_id, (array_agg(k.id ORDER BY k.own DESC, k.id))[1] AS wikidata_id
      FROM known_as k
     WHERE k.id ~ '^Q[1-9][0-9]*$'
     GROUP BY k.experience_id
  ), offering AS (
    SELECT m.experience_id, array_agg(DISTINCT m.kind_id ORDER BY m.kind_id) AS kind_ids
      FROM ${MEMBERSHIPS} m
      JOIN experiences e ON e.id = m.experience_id
     WHERE m.experience_id IN (SELECT experience_id FROM reached)
       AND ${countedMembershipSql('m', 'e')}
     GROUP BY m.experience_id
  )
  SELECT rd.region_slug, rd.experience_id, rd.name, rd.km,
         i.wikidata_id, o.kind_ids,
         (rd.metadata->>'sitelinksCount')::int AS sitelinks
    FROM reached rd
    LEFT JOIN named_places np ON np.experience_id = rd.experience_id AND np.region_slug = rd.region_slug
    LEFT JOIN items i ON i.experience_id = rd.experience_id
    JOIN offering o ON o.experience_id = rd.experience_id
   WHERE np.experience_id IS NULL
   ORDER BY rd.region_slug, sitelinks NULLS LAST, rd.name`;

/**
 * Where each top of a calibration list stands to its kind (#1864): offered when a place known
 * by the item (`KNOWN_AS_SQL`, the identifiers the survey lists match by) has a counted
 * membership in the kind; admitted when its arrival waits in the review queue
 * (`arrivalWaitingSql`, the queue's own fragment: admitted, unread, not marked missing — the
 * line let it through and a curator will see it; a place a curator passed that no longer
 * stands, or an arrival the next run marked missing, waits for nobody and stays held); held when
 * such a place exists and the kind neither offers nor admits it, named by the
 * place's own id before a membership's; refused when the latest real, closed run of one of the
 * kind's active sources filtered the item, with the reason the run recorded
 * (`experience_sync_changes`, a refusal is never a membership row); absent otherwise. A kind of
 * place is joined by its `experience_kind_id`. A kind of work has no catalogue kind (#1988): a work
 * is offered where a treasure the item names is shown by a venue a reader may go to
 * (`venuesShowingSql`, the survey matches' own fragment), and held where such a treasure exists
 * and no such venue shows it.
 *
 * The identifiers are joined once and aggregated per entry, as `MATCHES_SQL` joins them: a
 * subquery per entry over the whole `known_as` union ran it once per top, with no index, and
 * the report is read on every Catalogue Checks collect.
 */
const CALIBRATION_SQL = `
  WITH known_as AS (${KNOWN_AS_SQL}
  ), latest_run AS (
    SELECT DISTINCT ON (s.kind_id) s.kind_id, l.id AS log_id
      FROM experience_sync_logs l
      JOIN experience_sources s ON s.id = l.source_id
     WHERE NOT l.is_dry_run AND l.status IN ('success', 'partial') AND s.is_active
     ORDER BY s.kind_id, l.id DESC
  ), holding AS (
    SELECT c.kind_slug, c.slug,
           bool_or(COALESCE(counted.offered, false)) AS offered,
           bool_or(COALESCE(counted.admitted, false)) AS admitted,
           (array_agg(e.name ORDER BY k.own DESC, e.id))[1] AS held_as
      FROM coverage_calibration_entries c
      JOIN coverage_kinds ck ON ck.slug = c.kind_slug AND ck.form = 'place'
      JOIN known_as k ON k.id = c.wikidata_id
      JOIN experiences e ON e.id = k.experience_id
      LEFT JOIN LATERAL (
        SELECT bool_or(${countedMembershipSql('m', 'e')}) AS offered,
               bool_or(${arrivalWaitingSql('e', 'm')}) AS admitted
          FROM ${MEMBERSHIPS} m
         WHERE m.experience_id = e.id AND m.kind_id = ck.experience_kind_id
      ) counted ON true
     GROUP BY c.kind_slug, c.slug
  ), works AS (
    SELECT c.kind_slug, c.slug,
           bool_or(${publishedContentSql('t')} AND EXISTS (SELECT 1 ${venuesShowingSql('t')})) AS offered,
           (array_agg(t.name ORDER BY t.id))[1] AS held_as
      FROM coverage_calibration_entries c
      JOIN coverage_kinds ck ON ck.slug = c.kind_slug AND ck.form = 'work'
      JOIN treasures t ON t.external_id = c.wikidata_id
     GROUP BY c.kind_slug, c.slug
  ), refusals AS (
    SELECT ck.slug AS kind_slug, ch.external_id, (array_agg(ch.error ORDER BY ch.id DESC))[1] AS error
      FROM latest_run lr
      JOIN coverage_kinds ck ON ck.experience_kind_id = lr.kind_id
      JOIN experience_sync_changes ch ON ch.sync_log_id = lr.log_id AND ch.change_type = 'filtered'
     GROUP BY ck.slug, ch.external_id
  )
  SELECT c.kind_slug, c.slug, c.name, c.wikidata_id, c.sitelinks,
         ARRAY(SELECT cs.source_slug FROM coverage_calibration_entry_sources cs
                WHERE cs.kind_slug = c.kind_slug AND cs.entry_slug = c.slug ORDER BY cs.source_slug) AS sources,
         COALESCE(h.offered, w.offered, false) AS offered,
         COALESCE(h.admitted, false) AS admitted,
         COALESCE(h.held_as, w.held_as) AS held_as,
         r.error AS refused_for
    FROM coverage_calibration_entries c
    LEFT JOIN holding h ON (h.kind_slug, h.slug) = (c.kind_slug, c.slug)
    LEFT JOIN works w ON (w.kind_slug, w.slug) = (c.kind_slug, c.slug)
    LEFT JOIN refusals r ON r.kind_slug = c.kind_slug AND r.external_id = c.wikidata_id
   ORDER BY c.kind_slug, c.slug`;

const CALIBRATION_SOURCES_SQL = `
  SELECT s.slug, s.name, s.url, to_char(s.read, 'YYYY-MM-DD') AS read, s.note
    FROM coverage_calibration_sources s
   ORDER BY s.slug`;

/** How near a catalogue point must be to count as standing at an expectation's spot. */
export const SAME_SPOT_METRES = 250;

/** Read everything the report is built from, for every region or for `regionSlugs`. */
export async function readCoverageFacts(regionSlugs?: string[]): Promise<CoverageFacts> {
  const only = regionSlugs ?? null;
  const [kinds, regions, expectations, matches, nearby, judgements, unnamed, calibration, calibrationSources] = await Promise.all([
    pool.query<KindRow>(KINDS_SQL),
    pool.query<RegionRow>(REGIONS_SQL, [only]),
    pool.query<ExpectationRow>(EXPECTATIONS_SQL, [only]),
    pool.query<MatchRow>(MATCHES_SQL, [only]),
    pool.query<NearbyRow>(NEARBY_SQL, [only, SAME_SPOT_METRES]),
    pool.query<JudgementRow>(JUDGEMENTS_SQL, [only]),
    pool.query<UnnamedRow>(UNNAMED_SQL, [only]),
    // A kind's list is the whole world's, so a region never narrows it.
    pool.query<CalibrationRow>(CALIBRATION_SQL),
    pool.query<CalibrationSourceRow>(CALIBRATION_SOURCES_SQL),
  ]);
  return {
    kinds: kinds.rows,
    regions: regions.rows,
    expectations: expectations.rows,
    matches: matches.rows,
    nearby: nearby.rows,
    judgements: judgements.rows,
    unnamed: unnamed.rows,
    calibration: calibration.rows,
    calibrationSources: calibrationSources.rows,
  };
}

/** The statements, for the spec that holds them to the fragments they compose. */
export const coverageSql = { KINDS_SQL, REGIONS_SQL, EXPECTATIONS_SQL, MATCHES_SQL, NEARBY_SQL, JUDGEMENTS_SQL, UNNAMED_SQL, CALIBRATION_SQL };
