import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { assignRegionsForExperiences } from '../services/sync/regionAssignmentService.js';
import { suggestKind } from '../controllers/experience/kindSuggestionController.js';
import { separateMembership } from '../controllers/experience/membershipSeparation.js';
import {
  getExperience, getExperienceRegionCounts, getExperiencesByRegion,
} from '../controllers/experience/experienceQueryController.js';
import { queryQueueKeys } from '../controllers/experience/reviewQueueKeys.js';
import { coverageSql, type MatchRow } from '../controllers/admin/catalogueCoverage/reportQueries.js';
import { objectAssertions } from '../controllers/admin/dataAssertions/objectAssertions.js';
import { experienceRegionCountsQuerySchema, experiencesByRegionQuerySchema } from '../types/index.js';

/**
 * A record in a whole changes no reader of a place's kinds (#2483), against
 * PostgreSQL.
 *
 * `source_records` holds a place's records in a kind and its records in a
 * whole (ADR-0198), and nearly every World Heritage site holds a record of its
 * own list line in itself (ADR-0200). A reader of a place's records that means
 * the place's kinds asks `kindRecordSql`; one that forgets it counted a site's
 * record of itself as a second kind (#2481). No lint tells the two kinds of
 * read apart, so this spec holds every such reader to it: `READERS` lists
 * them, and **a reader added later is added to the list**.
 *
 * The fixture is Ancient Thebes with its Necropolis as one site of World
 * Heritage, and the Temple of Karnak as a place of Archaeology of its own, a
 * kind it holds on its own item, each standing in a world view of the
 * fixture's own with a published point and an unread one. Each case reads
 * every reader, writes one record in a whole, and reads them again:
 *
 * - the site's record of its own list line, in itself: it is in no kind and
 *   makes no part, so every reader answers exactly as before;
 * - the temple's record in the site, which makes it the site's part: what a
 *   reader says of its kinds stands, while what names its whole may change
 *   (the card's `part_of`, a coverage match that holds it as a part).
 *
 * Ids are the fixture's own, deleted before and after; the sources are looked
 * up by name, and each record's id is of its source's scheme, derived from the
 * fixture's ids.
 */

const SITE = 92483;
const TEMPLE = 92485;
const PLACES = [SITE, TEMPLE];
/** A World Heritage site that holds no kind: what the catalogue checks list, which a record of its own line must not hide. */
const BARE = 92486;
/** In every fixture place's name, so a place a broken reader separates off is found and deleted too. */
const TAG = '(record kind fixture)';
const WORLD_VIEW = 92483;
const ROOT = 92483;
const LEAF = 92484;
const ADMIN = '00000000-0000-4000-8000-000000092483';
/** A surveyed region of the fixture's own: one expectation names the site, one the temple. */
const COVERAGE_REGION = 'record-kind-fixture-2483';

/** A component reference of the site's list, in the whc-component scheme: `92483-485`. */
const reference = (place: number) => `${SITE}-${String(place % 1000).padStart(3, '0')}`;
const TEMPLE_ITEM = `Q${TEMPLE}001`;

let adminId = 0;
const memberships: Record<number, number> = {};

async function clear(): Promise<void> {
  const places = [...new Set([...PLACES, ...(await pool.query<{ id: number }>(
    'SELECT id FROM experiences WHERE name LIKE $1', [`%${TAG}%`],
  )).rows.map(row => row.id)])];
  await pool.query('DELETE FROM experience_separations WHERE original_id = ANY($1) OR separated_id = ANY($1)', [places]);
  await pool.query('DELETE FROM place_identifier_verdicts WHERE experience_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_parts WHERE whole_id = ANY($1) OR part_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [places]);
  await pool.query('DELETE FROM coverage_regions WHERE slug = $1', [COVERAGE_REGION]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

/** A place of `source` under its id in that source's scheme, with its one kind's membership. */
async function place(id: number, name: string, source: string, key: string, lon: number, lat: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326) FROM experience_sources s WHERE s.name = $6`,
    [id, key, `${name} ${TAG}`, lon, lat, source],
  );
  memberships[id] = (await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3 RETURNING id`,
    [id, key, source],
  )).rows[0].id;
}

/** A point of the place: published, under the list line's reference, or unread and placed by nothing yet. */
async function point(placeId: number, name: string, lon: number, lat: number, state: 'auto' | 'pending'): Promise<void> {
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location, curation_state)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7)`,
    [placeId, name, state === 'auto' ? reference(placeId) : null, state === 'auto' ? 1 : 2, lon, lat, state],
  );
}

/** World Heritage components' record of `placeId` in `wholeId`, under `placeId`'s line of the site's list. */
async function recordInWhole(placeId: number, wholeId: number): Promise<void> {
  await pool.query(
    `INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
     SELECT $1, $2, s.id, $3 FROM experience_sources s WHERE s.name = 'World Heritage components'`,
    [placeId, wholeId, reference(placeId)],
  );
}

/** The (whole, part, reason) pairs "part of" holds of the fixture's places. */
const parts = async () => (await pool.query<{ whole_id: number; part_id: number; reason: string }>(
  'SELECT whole_id, part_id, reason FROM experience_parts WHERE whole_id = ANY($1) OR part_id = ANY($1) ORDER BY part_id',
  [PLACES],
)).rows;

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO world_views (id, name, is_default, is_public) VALUES ($1, 'Record kind fixture', false, true)`, [WORLD_VIEW],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf, geom) VALUES
       ($1, $3, 'Egypt (record kind fixture)', NULL, false, NULL),
       ($2, $3, 'Luxor (record kind fixture)', $1, true, ST_Multi(ST_MakeEnvelope(32.0, 25.0, 33.0, 26.0, 4326)))`,
    [ROOT, LEAF, WORLD_VIEW],
  );

  await place(SITE, 'Ancient Thebes with its Necropolis', 'UNESCO World Heritage Sites', String(SITE), 32.6390, 25.6995);
  await point(SITE, 'Luxor Temple', 32.6390, 25.6995, 'auto');
  await point(SITE, 'Colossi of Memnon', 32.6106, 25.7206, 'pending');
  await place(TEMPLE, 'Temple of Karnak', 'Archaeology', TEMPLE_ITEM, 32.6573, 25.7188);
  await point(TEMPLE, 'Temple of Karnak', 32.6573, 25.7188, 'auto');
  await point(TEMPLE, 'Avenue of Sphinxes', 32.6420, 25.7090, 'pending');
  await assignRegionsForExperiences(PLACES, WORLD_VIEW);

  await pool.query(
    `INSERT INTO coverage_regions (slug, name, country, country_code, centre, radius_km, surveyed)
     VALUES ($1, 'Luxor (record kind fixture)', 'Egypt', 'EG', ST_SetSRID(ST_MakePoint(32.64, 25.70), 4326), 30, '2026-11-13')`,
    [COVERAGE_REGION],
  );
  await pool.query(
    `INSERT INTO coverage_expectations (region_slug, slug, name, type, wikidata_id, unesco_id, source_count)
     VALUES ($1, $2, 'Ancient Thebes', 'place', NULL, $3, 2), ($1, $4, 'Temple of Karnak', 'place', $5, NULL, 2)`,
    [COVERAGE_REGION, `fixture-${SITE}`, String(SITE), `fixture-${TEMPLE}`, TEMPLE_ITEM],
  );

  // The step's own check: both places listed in Luxor, neither a part yet.
  const listed = (await getExperiencesByRegion({
    params: { regionId: LEAF }, query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }), caller: undefined,
  })).experiences.map(row => row.id).sort();
  expect(listed).toEqual(PLACES);
  expect(await parts()).toEqual([]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

/** The answer without one of its fields. */
const without = (answer: object, field: string) =>
  Object.fromEntries(Object.entries(answer).filter(([key]) => key !== field));

/**
 * A reader of a place's records: its answer about the place, read through its
 * own exported function or the statement it sends, and, where a part's record
 * in its whole may change the rest of the answer by design, the part of it
 * that is about the place's kinds.
 */
interface Reader {
  name: string;
  read: (placeId: number) => Promise<unknown>;
  kindsOf?: (answer: unknown) => unknown;
}

/**
 * Every reader of a place's records that means the place's kinds. **A reader
 * added later is added here** (`docs/tech/experiences.md` § A part's record in
 * its whole).
 */
const READERS: Reader[] = [
  {
    // The card's held kinds aggregate the place's records by kind: a record of
    // no kind is a NULL key, which jsonb_object_agg refuses. The fixture's
    // places are not arriving, so the answer is the one a place not arriving
    // gets, after the whole read has run.
    name: 'the kind suggestion (kindSuggestionController.ts)',
    read: placeId => suggestKind({ params: { id: placeId }, caller: { id: adminId, role: 'admin' } as Express.User }),
  },
  {
    // Each place holds one kind, so separating it is refused as its only kind.
    name: 'the membership separation\'s "only kind" guard (membershipSeparation.ts)',
    read: async placeId => {
      const outcome = await separateMembership({ placeId, membershipId: memberships[placeId], separatedBy: adminId });
      return { refusal: outcome.refusal ?? null, separated: outcome.result !== undefined };
    },
  },
  {
    // The card's own read; `updated_at` is the row's clock, not an answer.
    name: 'the place read (GET /api/experiences/:id)',
    read: async placeId => without(await getExperience({ params: { id: placeId }, caller: undefined }), 'updated_at'),
    // A part's card names its site: that is what being a part means (ADR-0100).
    kindsOf: answer => without(answer as Record<string, unknown>, 'part_of'),
  },
  {
    name: 'the region list (getExperiencesByRegion)',
    read: async placeId => (await getExperiencesByRegion({
      params: { regionId: LEAF }, query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }), caller: undefined,
    })).experiences.find(row => row.id === placeId) ?? null,
  },
  {
    // The fixture's world view holds the fixture's places only, so the counts are theirs.
    name: 'the region counts (getExperienceRegionCounts)',
    read: () => getExperienceRegionCounts({
      query: experienceRegionCountsQuerySchema.parse({ worldViewId: WORLD_VIEW, parentRegionId: ROOT }),
    }),
  },
  {
    // Each place's unread point is a waiting question about it.
    name: 'the review queue\'s keys (queryQueueKeys)',
    read: async placeId => (await queryQueueKeys({
      userId: adminId, isAdmin: true, filters: { q: TAG, sort: 'date', limit: 25 },
    })).keys.filter(key => key.id === placeId),
  },
  {
    // The report's own statement, over the fixture's surveyed region.
    name: 'the coverage matches (catalogueCoverage, MATCHES_SQL)',
    read: async placeId => (await pool.query<MatchRow>(coverageSql.MATCHES_SQL, [[COVERAGE_REGION]])).rows
      .filter(row => row.slug === `fixture-${placeId}`)
      .sort((a, b) => String(a.kind_id).localeCompare(String(b.kind_id))),
    // A part's record in its whole is a match that holds the part (a row of no
    // kind, offered nowhere); what matches in a kind stands.
    kindsOf: answer => (answer as MatchRow[]).filter(row => row.kind_id !== null),
  },
  {
    // The checks that ask whether a place holds a kind.
    name: 'the catalogue checks (place-without-membership, membership-source-disagrees-with-row)',
    read: async placeId => Object.fromEntries(await Promise.all(
      ['place-without-membership', 'membership-source-disagrees-with-row'].map(async id => {
        const rule = objectAssertions.find(assertion => assertion.id === id)!;
        const rows = (await pool.query<Record<string, unknown>>(rule.sql)).rows;
        return [id, rows.filter(row => Number(row.experience_id) === placeId)];
      }),
    )),
  },
];

/** A record in a whole written onto one of the fixture's places, with what it makes of the place. */
interface Case {
  name: string;
  place: number;
  /** Writes the record, and checks the step: a part made, or none. */
  record: () => Promise<void>;
  /** Whether the whole answer stands, or only what it says of the place's kinds. */
  compare: 'whole' | 'kinds';
}

const CASES: Case[] = [
  {
    name: "a World Heritage site's record of its own list line (ADR-0200)",
    place: SITE,
    record: async () => {
      await recordInWhole(SITE, SITE);
      // It places the site in no whole and makes no part.
      expect(await parts()).toEqual([]);
    },
    compare: 'whole',
  },
  {
    name: "a part's record in its whole (ADR-0198)",
    place: TEMPLE,
    record: async () => {
      await recordInWhole(TEMPLE, SITE);
      expect(await parts()).toEqual([{ whole_id: SITE, part_id: TEMPLE, reason: 'component' }]);
    },
    compare: 'kinds',
  },
];

describe("a World Heritage site holding no kind, and its record of its own line", () => {
  // The catalogue checks list a place by the kinds it holds, so they are asked of one that holds
  // none: before the record, "without a membership" lists it and "the row's pair" does not. A
  // check that counted the record as a kind would answer the other way round once it is written.
  it('changes no answer of the catalogue checks', async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(33.9750, 28.5560), 4326)
         FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
      [BARE, String(BARE), `Saint Catherine Area ${TAG}`],
    );
    const checks = READERS.find(reader => reader.name.startsWith('the catalogue checks'))!;
    const before = await checks.read(BARE) as Record<string, unknown[]>;
    expect(before['place-without-membership']).toHaveLength(1);
    expect(before['membership-source-disagrees-with-row']).toEqual([]);
    // Its record of its own list line, under the site's own number (ADR-0200).
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
       SELECT $1, $1, s.id, $2 FROM experience_sources s WHERE s.name = 'World Heritage components'`,
      [BARE, `${BARE}-001`],
    );
    expect(await checks.read(BARE)).toEqual(before);
  });
});

describe.each(CASES)('$name', ({ place: placeId, record, compare }) => {
  it.each(READERS)('changes no answer of $name', async ({ read, kindsOf }) => {
    const of = compare === 'kinds' && kindsOf ? kindsOf : (answer: unknown) => answer;
    const before = await read(placeId);
    await record();
    expect(of(await read(placeId))).toEqual(of(before));
  });
});
