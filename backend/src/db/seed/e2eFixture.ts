/**
 * Deterministic fixture for the Playwright smoke lane.
 *
 * Ids are pinned so the specs can navigate to a place by address — /wv/9001,
 * /wv/9001/r/9001, /wv/9001/r/9001/e/9001 (#644) — without discovering them at
 * runtime. Derived columns (anchor_point, focus_bbox, geom_area_km2,
 * the 3857 mirror) are deliberately absent: the triggers on `regions` own
 * them, and duplicating that here would create a second, wrong source of truth.
 *
 * Two things the lane needs beside the three visible places (#852): a curator
 * who can sign in — the review page is behind `requireCurator`, and no smoke
 * spec signed in before — and something for them to answer: two arrivals under
 * the one gated source `01-schema.sql` seeds (Places of worship,
 * `requires_curation`), `pending` on their memberships, so the review feed opens
 * on exactly two questions and a batch answer has a batch.
 */

import type { PoolClient } from 'pg';
// ADR-0064: raw parameterized SQL on the pool, typed by the generated rows.
import { pool, rollbackQuietly } from '../index.js';
import type {
  ExperienceLocationsRow, ExperienceSourcesRow, UsersRow,
} from '../schema.generated.js';
import { hashPassword } from '../../services/authService.js';
// The rule for a database a test may write to, shared with the database-backed
// lane (#522): this seed deletes and re-inserts its rows and rewinds three
// sequences, so it must never run against the dev catalogue db/index.ts
// defaults to.
import { TEST_DB_NAME_PATTERN } from '../testDbName.js';

export const E2E_WORLD_VIEW_ID = 9001;
export const E2E_REGION_ID = 9001;
export const E2E_REGION_NAME = 'Testland';

/**
 * The curator the review specs sign in as. A fixed password, because the lane
 * signs in through the dialog a person uses; it exists only in a database
 * whose name says `test`, which the guard below refuses to seed otherwise.
 */
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture credential for the isolated test stack, seeded only into a database whose name says `test`; the lane signs in through the dialog with it
export const E2E_CURATOR = { email: 'curator@e2e.test', password: 'e2e-curator-password' };

/** UNESCO World Heritage Sites — seeded by db/init/01-schema.sql. */
const UNESCO_SOURCE_NAME = 'UNESCO World Heritage Sites';
/** The gated source `01-schema.sql` seeds (ADR-0052): its arrivals wait for a curator. */
const WORSHIP_SOURCE_NAME = 'Places of worship';

const EXPERIENCES = [
  { id: 9001, name: 'Testland Old Town', lon: 10.1, lat: 50.1 },
  { id: 9002, name: 'Testland Cathedral', lon: 10.2, lat: 50.2 },
  { id: 9003, name: 'Testland Aqueduct', lon: 10.3, lat: 50.3 },
];

/** Two arrivals nobody has passed, under the gated source — the review feed's rows. */
const ARRIVALS = [
  { id: 9004, name: 'Testland Minster', lon: 10.15, lat: 50.15 },
  { id: 9005, name: 'Testland Chapel', lon: 10.25, lat: 50.25 },
];

/**
 * A point under a published place that a curator has already turned down (#859).
 *
 * It hangs off the Aqueduct, which readers can see, so it is *contents* rather
 * than an arrival — and it is seeded already refused for one reason: a refused
 * part is invisible to the queue, which is the whole point of the mark. The feed
 * therefore still holds exactly the two arrivals the batch spec ticks, and every
 * sentence that spec asserts stays true. Taking this one back is what puts a
 * third question there, which is why that test runs after it.
 *
 * No `experience_location_regions` row, deliberately: placement does not hold a
 * refused point (ADR-0053), so seeding one would be a state the product never
 * produces.
 */
const REFUSED_POINT = {
  experienceId: 9003,
  name: 'Testland Aqueduct — north arch',
  lon: 10.32,
  lat: 50.32,
};

/** A square around (10,50) — valid, small, and far from the antimeridian. */
const REGION_WKT =
  'MULTIPOLYGON(((10 50, 10.5 50, 10.5 50.5, 10 50.5, 10 50)))';

type Source = Pick<ExperienceSourcesRow, 'id' | 'kind_id'>;

async function sourceNamed(client: PoolClient, name: string): Promise<Source> {
  const { rows: [source] } = await client.query<Source>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1',
    [name],
  );
  if (!source) {
    throw new Error(`Source "${name}" missing - is db/init applied?`);
  }
  return source;
}

/**
 * One place, its membership, its point and its region rows.
 *
 * `curationState` is what the membership and the point say about whether a
 * person has looked: `auto` is a trusted source's arrival, published unread;
 * `pending` is a gated source's, held for the review feed (ADR-0025).
 */
async function seedPlace(
  client: PoolClient,
  exp: { id: number; name: string; lon: number; lat: number },
  source: Source,
  curationState: 'auto' | 'pending',
): Promise<void> {
  // Unlike regions.geom, experiences.location and experience_locations.location
  // are NOT NULL, so an insert-then-update split fails on the insert itself.
  // Scalars and geometry therefore go in together, in one statement - the
  // same shape `upsertExperienceRecord` (services/sync/experienceUpsert.ts)
  // already uses for this exact NOT NULL constraint.
  await client.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [exp.id, source.id, `e2e-${exp.id}`, exp.name, exp.lon, exp.lat],
  );

  // The place's membership in the kind its source fills (#822). Without
  // it every reader-facing read hides the place — not refused, not
  // unread, simply never asked — and the smoke lane's region list is
  // empty while nothing says why. Admitted and published, the way a
  // trusted source's arrival is; or pending, the way a gated one's is.
  await client.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [exp.id, source.kind_id, source.id, curationState,
      curationState === 'auto' ? new Date() : null],
  );

  const { rows: [location] } = await client.query<Pick<ExperienceLocationsRow, 'id'>>(
    `INSERT INTO experience_locations (experience_id, name, ordinal, curation_state, location)
     VALUES ($1, $2, 0, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
     RETURNING id`,
    [exp.id, exp.name, curationState, exp.lon, exp.lat],
  );

  await client.query(
    'INSERT INTO experience_regions (experience_id, region_id) VALUES ($1, $2)',
    [exp.id, E2E_REGION_ID],
  );

  // Without this, experienceLocationController's `in_region` EXISTS
  // check is false for every fixture location, ExperienceMarkers filters
  // all three out, and the map renders no markers even though the
  // region's experience list shows three.
  await client.query(
    `INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
     VALUES ($1, $2, 'manual')`,
    [location.id, E2E_REGION_ID],
  );
}

/**
 * A second point under an already-published place, unread and already turned down.
 *
 * `ordinal` 1 because the place's own point took 0 and the pair is unique;
 * `curation_state` 'pending' beside `refused_at` because that is exactly what the
 * refusal writes — the mark never replaces the state (ADR-0053), and a fixture
 * that wrote one without the other would be a row the product cannot produce.
 */
async function seedRefusedPoint(
  client: PoolClient, point: { experienceId: number; name: string; lon: number; lat: number },
): Promise<void> {
  await client.query(
    `INSERT INTO experience_locations
       (experience_id, name, ordinal, curation_state, refused_at, location)
     VALUES ($1, $2, 1, 'pending', NOW(), ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [point.experienceId, point.name, point.lon, point.lat],
  );
}

/**
 * The curator, with a global scope: every question in the feed is theirs to
 * answer. A local account, verified, so the sign-in dialog admits it; the
 * assignment names the curator as its own assigner, since the fixture has no
 * admin and the column only records who.
 */
async function seedCurator(client: PoolClient): Promise<void> {
  const passwordHash = await hashPassword(E2E_CURATOR.password);
  const { rows: [user] } = await client.query<Pick<UsersRow, 'id'>>(
    `INSERT INTO users (uuid, email, password_hash, display_name, auth_provider, email_verified, role)
     VALUES (gen_random_uuid()::text, $1, $2, 'E2E Curator', 'local', true, 'curator')
     RETURNING id`,
    [E2E_CURATOR.email, passwordHash],
  );
  await client.query(
    `INSERT INTO curator_assignments (user_id, scope_type, assigned_by, notes)
     VALUES ($1, 'global', $1, 'smoke fixture')`,
    [user.id],
  );
}

/** Every row of the fixture, inside the one transaction `seedE2eFixture` opened. */
async function seedRows(client: PoolClient): Promise<void> {
  // Idempotent: drop our own rows first. Cascades clear the links, the
  // memberships and the curator's assignment.
  await client.query(
    'DELETE FROM experiences WHERE id = ANY($1::int[])',
    [[...EXPERIENCES, ...ARRIVALS].map((e) => e.id)],
  );
  await client.query('DELETE FROM world_views WHERE id = $1', [E2E_WORLD_VIEW_ID]);
  await client.query('DELETE FROM users WHERE email = $1', [E2E_CURATOR.email]);

  const unesco = await sourceNamed(client, UNESCO_SOURCE_NAME);
  const worship = await sourceNamed(client, WORSHIP_SOURCE_NAME);

  // The smoke specs browse anonymously; a hidden world view is invisible
  // to them and every region read under it answers 404, so it is public.
  await client.query(
    `INSERT INTO world_views (id, name, description, is_default, is_active, is_public)
     VALUES ($1, $2, $3, false, true, true)`,
    [E2E_WORLD_VIEW_ID, 'E2E Fixture', 'Synthetic data for the smoke lane'],
  );

  await client.query(
    'INSERT INTO regions (id, world_view_id, name) VALUES ($1, $2, $3)',
    [E2E_REGION_ID, E2E_WORLD_VIEW_ID, E2E_REGION_NAME],
  );

  // The geometry goes in by a second statement, still inside this
  // transaction: the BEFORE UPDATE OF geom trigger fires here and fills
  // anchor_point, focus_bbox and geom_area_km2. Never compute those here.
  await client.query(
    'UPDATE regions SET geom = ST_GeomFromText($1, 4326) WHERE id = $2',
    [REGION_WKT, E2E_REGION_ID],
  );

  for (const exp of EXPERIENCES) await seedPlace(client, exp, unesco, 'auto');
  for (const exp of ARRIVALS) await seedPlace(client, exp, worship, 'pending');
  await seedRefusedPoint(client, REFUSED_POINT);
  await seedCurator(client);

  // Explicit ids do not advance the sequences; application writes would
  // otherwise collide with the fixture.
  await client.query(
    `SELECT setval(pg_get_serial_sequence('world_views', 'id'),
                   GREATEST((SELECT MAX(id) FROM world_views), 1))`,
  );
  await client.query(
    `SELECT setval(pg_get_serial_sequence('regions', 'id'),
                   GREATEST((SELECT MAX(id) FROM regions), 1))`,
  );
  await client.query(
    `SELECT setval(pg_get_serial_sequence('experiences', 'id'),
                   GREATEST((SELECT MAX(id) FROM experiences), 1))`,
  );
}

export async function seedE2eFixture(): Promise<void> {
  const dbName = process.env.DB_NAME || 'track_regions';
  if (!TEST_DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `Refusing to seed "${dbName}" - name does not look like a test database. ` +
        'Point DB_NAME (and DB_HOST/DB_PORT) at a test database before seeding.',
    );
  }

  // One transaction on one client, the shape every writer here uses: a
  // `pool.query('BEGIN')` pins nothing, and the rows would land on whichever
  // connection the pool handed out next.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    await seedRows(client);
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
