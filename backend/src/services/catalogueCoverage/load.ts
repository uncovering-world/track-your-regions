/**
 * The catalogue-coverage tables, replaced whole from the files (ADR-0081).
 *
 * `coverage_kinds`, `coverage_regions`, `coverage_expectations` and
 * `coverage_expectation_kinds` are a copy of `db/catalogue-coverage/`. This is
 * their one writer: it empties all four and fills them from what
 * `readCoverageFiles` returned, in one transaction, so a reader of the tables
 * sees the previous files or these and never a mixture, and a load that fails
 * leaves the previous content standing.
 *
 * `DELETE`, not `TRUNCATE`: a truncate takes an exclusive lock a report in
 * flight would wait behind, and is not safe for a transaction that has already
 * read the tables.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { ExperienceKindsRow } from '../../db/schema.generated.js';
import type { CoverageFiles, CoverageKind } from './files.js';

export interface CoverageLoadSummary {
  kinds: number;
  regions: number;
  expectations: number;
  filings: number;
}

/** The register and `experience_kinds` do not describe the same live kinds. */
export class CoverageRegisterMismatch extends Error {
  constructor(readonly problems: string[]) {
    super(`The register of kinds does not agree with experience_kinds:\n${problems.join('\n')}`);
    this.name = 'CoverageRegisterMismatch';
  }
}

/**
 * What the files' own reader cannot see: whether each catalogue kind has its
 * live record, under the catalogue's own name.
 */
function registerAgainstCatalogue(kinds: CoverageKind[], catalogue: Pick<ExperienceKindsRow, 'id' | 'name'>[]): string[] {
  const problems: string[] = [];
  const records = new Map(kinds.filter(kind => kind.experience_kind_id !== null).map(kind => [kind.experience_kind_id, kind]));
  for (const row of catalogue) {
    const record = records.get(row.id);
    if (!record) {
      problems.push(`the catalogue kind ${row.name} (experience_kinds ${row.id}) has no live record in kinds.jsonl`);
    } else if (record.name !== row.name) {
      problems.push(`${record.slug} is named ${record.name} and experience_kinds ${row.id} is named ${row.name}`);
    }
    records.delete(row.id);
  }
  for (const [id, record] of records) {
    problems.push(`${record.slug} names experience_kinds ${id}, which the catalogue does not have`);
  }
  return problems;
}

const point = (lat: number | null, lon: number | null): string | null =>
  (lat === null || lon === null ? null : `POINT(${lon} ${lat})`);

async function fill(client: PoolClient, files: CoverageFiles): Promise<CoverageLoadSummary> {
  // Each row is sent under the table's own column names, as one JSON array per table.
  const kinds = files.kinds.map(kind => ({
    slug: kind.slug,
    name: kind.name,
    form: kind.form,
    definition: kind.definition,
    status: kind.status,
    experience_kind_id: kind.experience_kind_id,
    issue_number: kind.issue,
    vision_heading: kind.vision,
    in_venue: kind.in_venue,
  }));
  const regions = files.regions.map(region => ({
    slug: region.slug,
    name: region.name,
    country: region.country,
    centre: point(region.lat, region.lon),
    radius_km: region.radius_km,
    surveyed: region.surveyed,
  }));
  const expectations = [...files.expectations].flatMap(([regionSlug, entries]) => entries.map(entry => ({
    region_slug: regionSlug,
    slug: entry.slug,
    name: entry.name,
    aliases: entry.aliases,
    type: entry.type,
    wikidata_id: entry.wikidata,
    same_as: entry.same_as,
    unesco_id: entry.unesco,
    venue: entry.venue,
    source_count: entry.sources,
    sitelinks: entry.sitelinks,
    location: point(entry.lat, entry.lon),
    note: entry.note,
  })));
  const filings = [...files.expectations].flatMap(([regionSlug, entries]) => entries.flatMap(entry =>
    entry.kinds.map(kindSlug => ({ region_slug: regionSlug, expectation_slug: entry.slug, kind_slug: kindSlug }))));

  // Children first, so no row is ever left pointing at a parent that is gone.
  await client.query('DELETE FROM coverage_expectation_kinds');
  await client.query('DELETE FROM coverage_expectations');
  await client.query('DELETE FROM coverage_regions');
  await client.query('DELETE FROM coverage_kinds');

  await client.query(
    `INSERT INTO coverage_kinds (slug, name, form, definition, status, experience_kind_id, issue_number, vision_heading, in_venue)
     SELECT slug, name, form, definition, status, experience_kind_id, issue_number, vision_heading, in_venue
       FROM jsonb_to_recordset($1::jsonb)
         AS sent(slug text, name text, form text, definition text, status text,
                 experience_kind_id integer, issue_number integer, vision_heading text, in_venue boolean)`,
    [JSON.stringify(kinds)],
  );
  await client.query(
    `INSERT INTO coverage_regions (slug, name, country, centre, radius_km, surveyed)
     SELECT slug, name, country, ST_GeomFromText(centre, 4326), radius_km, surveyed
       FROM jsonb_to_recordset($1::jsonb)
         AS sent(slug text, name text, country text, centre text, radius_km double precision, surveyed date)`,
    [JSON.stringify(regions)],
  );
  await client.query(
    `INSERT INTO coverage_expectations
            (region_slug, slug, name, aliases, type, wikidata_id, same_as, unesco_id, venue,
             source_count, sitelinks, location, note)
     SELECT region_slug, slug, name,
            ARRAY(SELECT jsonb_array_elements_text(aliases)), type, wikidata_id,
            ARRAY(SELECT jsonb_array_elements_text(same_as)), unesco_id, venue,
            source_count, sitelinks, ST_GeomFromText(location, 4326), note
       FROM jsonb_to_recordset($1::jsonb)
         AS sent(region_slug text, slug text, name text, aliases jsonb, type text, wikidata_id text,
                 same_as jsonb, unesco_id text, venue text, source_count integer, sitelinks integer,
                 location text, note text)`,
    [JSON.stringify(expectations)],
  );
  await client.query(
    `INSERT INTO coverage_expectation_kinds (region_slug, expectation_slug, kind_slug)
     SELECT region_slug, expectation_slug, kind_slug
       FROM jsonb_to_recordset($1::jsonb)
         AS sent(region_slug text, expectation_slug text, kind_slug text)`,
    [JSON.stringify(filings)],
  );
  return { kinds: kinds.length, regions: regions.length, expectations: expectations.length, filings: filings.length };
}

/**
 * Replace the four tables with `files`.
 *
 * @throws CoverageRegisterMismatch before anything is deleted, when the register
 *   and `experience_kinds` disagree.
 */
export async function replaceCoverage(files: CoverageFiles): Promise<CoverageLoadSummary> {
  // One transaction on one client: a `pool.query('BEGIN')` pins nothing.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const catalogue = await client.query<Pick<ExperienceKindsRow, 'id' | 'name'>>('SELECT id, name FROM experience_kinds ORDER BY id');
    const problems = registerAgainstCatalogue(files.kinds, catalogue.rows);
    if (problems.length > 0) throw new CoverageRegisterMismatch(problems);
    const summary = await fill(client, files);
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
