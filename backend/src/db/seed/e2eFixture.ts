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

import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../index.js';
import {
  experienceSources,
  experienceKindMemberships,
  experienceLocationRegions,
  experienceLocations,
  experienceRegions,
  experiences,
  regions,
  worldViews,
} from '../schema.js';
import { hashPassword } from '../../services/authService.js';

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

// db/index.ts defaults to localhost:5432/track_regions - the developer's
// dev database - when no environment is set. This seed deletes and
// re-inserts fixture rows (world view 9001, experiences 9001-9005, the
// curator) and rewinds three sequences, so it must never run against a
// non-test database. Anchored to a `test` path component rather than a bare
// substring: `/test/i` would let "track_regions_latest" through, since
// "latest" itself contains "test".
const TEST_DB_NAME_PATTERN = /(^|[_-])test($|[_-])/i;

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = { id: number; kindId: number };

async function sourceNamed(tx: Tx, name: string): Promise<Source> {
  const [source] = await tx
    .select({ id: experienceSources.id, kindId: experienceSources.kindId })
    .from(experienceSources)
    .where(eq(experienceSources.name, name));
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
  tx: Tx,
  exp: { id: number; name: string; lon: number; lat: number },
  source: Source,
  curationState: 'auto' | 'pending',
): Promise<void> {
  // Unlike regions.geom, experiences.location and experience_locations.location
  // are NOT NULL, so an insert-then-update split fails on the insert itself.
  // Scalars and geometry therefore go in together, in one raw statement -
  // the same split `upsertExperienceRecord` (services/sync/experienceUpsert.ts)
  // already uses for this exact NOT NULL constraint. sql.identifier()
  // resolves each scalar column name from the Drizzle model, so renaming
  // or dropping any of them still fails `npm run typecheck` even though
  // the statement itself is raw SQL. Only `location` - deliberately
  // absent from the Drizzle model - is a literal, and on the point below
  // `curation_state` too, which the location model does not carry.
  await tx.execute(
    sql`INSERT INTO experiences (
          ${sql.identifier(experiences.id.name)},
          ${sql.identifier(experiences.sourceId.name)},
          ${sql.identifier(experiences.externalId.name)},
          ${sql.identifier(experiences.name.name)},
          location
        ) VALUES (
          ${exp.id}, ${source.id}, ${`e2e-${exp.id}`}, ${exp.name},
          ST_SetSRID(ST_MakePoint(${exp.lon}, ${exp.lat}), 4326)
        )`,
  );

  // The place's membership in the kind its source fills (#822). Without
  // it every reader-facing read hides the place — not refused, not
  // unread, simply never asked — and the smoke lane's region list is
  // empty while nothing says why. Admitted and published, the way a
  // trusted source's arrival is; or pending, the way a gated one's is.
  await tx.insert(experienceKindMemberships).values({
    experienceId: exp.id,
    kindId: source.kindId,
    sourceId: source.id,
    curationState,
    publishedAt: curationState === 'auto' ? new Date() : null,
  });

  const [location] = (
    await tx.execute<{ id: number }>(
      sql`INSERT INTO experience_locations (
            ${sql.identifier(experienceLocations.experienceId.name)},
            ${sql.identifier(experienceLocations.name.name)},
            ${sql.identifier(experienceLocations.ordinal.name)},
            curation_state,
            location
          ) VALUES (
            ${exp.id}, ${exp.name}, 0, ${curationState},
            ST_SetSRID(ST_MakePoint(${exp.lon}, ${exp.lat}), 4326)
          )
          RETURNING id`,
    )
  ).rows;

  await tx.insert(experienceRegions).values({
    experienceId: exp.id,
    regionId: E2E_REGION_ID,
  });

  // Without this, experienceLocationController's `in_region` EXISTS
  // check is false for every fixture location, ExperienceMarkers filters
  // all three out, and the map renders no markers even though the
  // region's experience list shows three.
  await tx.insert(experienceLocationRegions).values({
    locationId: location.id,
    regionId: E2E_REGION_ID,
    assignmentType: 'manual',
  });
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
  tx: Tx, point: { experienceId: number; name: string; lon: number; lat: number },
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO experience_locations (
          ${sql.identifier(experienceLocations.experienceId.name)},
          ${sql.identifier(experienceLocations.name.name)},
          ${sql.identifier(experienceLocations.ordinal.name)},
          curation_state,
          refused_at,
          location
        ) VALUES (
          ${point.experienceId}, ${point.name}, 1, 'pending', NOW(),
          ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)
        )`,
  );
}

/**
 * The curator, with a global scope: every question in the feed is theirs to
 * answer. A local account, verified, so the sign-in dialog admits it; the
 * assignment names the curator as its own assigner, since the fixture has no
 * admin and the column only records who.
 */
async function seedCurator(tx: Tx): Promise<void> {
  const passwordHash = await hashPassword(E2E_CURATOR.password);
  const [user] = (
    await tx.execute<{ id: number }>(
      sql`INSERT INTO users (uuid, email, password_hash, display_name, auth_provider, email_verified, role)
          VALUES (gen_random_uuid()::text, ${E2E_CURATOR.email}, ${passwordHash}, 'E2E Curator', 'local', true, 'curator')
          RETURNING id`,
    )
  ).rows;
  await tx.execute(
    sql`INSERT INTO curator_assignments (user_id, scope_type, assigned_by, notes)
        VALUES (${user.id}, 'global', ${user.id}, 'smoke fixture')`,
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

  await db.transaction(async (tx) => {
    // Idempotent: drop our own rows first. Cascades clear the links, the
    // memberships and the curator's assignment.
    await tx.delete(experiences).where(
      inArray(experiences.id, [...EXPERIENCES, ...ARRIVALS].map((e) => e.id)),
    );
    await tx.delete(worldViews).where(eq(worldViews.id, E2E_WORLD_VIEW_ID));
    await tx.execute(sql`DELETE FROM users WHERE email = ${E2E_CURATOR.email}`);

    const unesco = await sourceNamed(tx, UNESCO_SOURCE_NAME);
    const worship = await sourceNamed(tx, WORSHIP_SOURCE_NAME);

    await tx.insert(worldViews).values({
      id: E2E_WORLD_VIEW_ID,
      name: 'E2E Fixture',
      description: 'Synthetic data for the smoke lane',
      isDefault: false,
      isActive: true,
      // The smoke specs browse anonymously; a hidden world view is invisible
      // to them and every region read under it answers 404.
      isPublic: true,
    });

    await tx.insert(regions).values({
      id: E2E_REGION_ID,
      worldViewId: E2E_WORLD_VIEW_ID,
      name: E2E_REGION_NAME,
    });

    // geom is deliberately absent from the Drizzle model, so it goes through
    // a sql template - still inside this transaction. The BEFORE UPDATE OF
    // geom trigger fires here and fills anchor_point, focus_bbox and
    // geom_area_km2. Never compute those here.
    await tx.execute(
      sql`UPDATE regions SET geom = ST_GeomFromText(${REGION_WKT}, 4326)
          WHERE id = ${E2E_REGION_ID}`,
    );

    for (const exp of EXPERIENCES) await seedPlace(tx, exp, unesco, 'auto');
    for (const exp of ARRIVALS) await seedPlace(tx, exp, worship, 'pending');
    await seedRefusedPoint(tx, REFUSED_POINT);
    await seedCurator(tx);

    // Explicit ids do not advance the sequences; application writes would
    // otherwise collide with the fixture.
    await tx.execute(
      sql`SELECT setval(pg_get_serial_sequence('world_views', 'id'),
                        GREATEST((SELECT MAX(id) FROM world_views), 1))`,
    );
    await tx.execute(
      sql`SELECT setval(pg_get_serial_sequence('regions', 'id'),
                        GREATEST((SELECT MAX(id) FROM regions), 1))`,
    );
    await tx.execute(
      sql`SELECT setval(pg_get_serial_sequence('experiences', 'id'),
                        GREATEST((SELECT MAX(id) FROM experiences), 1))`,
    );
  });
}
