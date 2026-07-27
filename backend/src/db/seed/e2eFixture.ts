/**
 * Deterministic fixture for the Playwright smoke lane.
 *
 * Ids are pinned so the specs can navigate to ?wv=9001 without discovering
 * them at runtime. Derived columns (anchor_point, focus_bbox, geom_area_km2,
 * the 3857 mirror) are deliberately absent: the triggers on `regions` own
 * them, and duplicating that here would create a second, wrong source of truth.
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../index.js';
import {
  experienceCategories,
  experienceLocationRegions,
  experienceLocations,
  experienceRegions,
  experiences,
  regions,
  worldViews,
} from '../schema.js';

export const E2E_WORLD_VIEW_ID = 9001;
export const E2E_REGION_ID = 9001;
export const E2E_REGION_NAME = 'Testland';

// db/index.ts defaults to localhost:5432/track_regions - the developer's
// dev database - when no environment is set. This seed deletes and
// re-inserts fixture rows (world view 9001, experiences 9001-9003) and
// rewinds three sequences, so it must never run against a non-test
// database. Anchored to a `test` path component rather than a bare
// substring: `/test/i` would let "track_regions_latest" through, since
// "latest" itself contains "test".
const TEST_DB_NAME_PATTERN = /(^|[_-])test($|[_-])/i;

/** UNESCO World Heritage Sites — seeded by db/init/01-schema.sql. */
const UNESCO_CATEGORY_NAME = 'UNESCO World Heritage Sites';

const EXPERIENCES = [
  { id: 9001, name: 'Testland Old Town', lon: 10.1, lat: 50.1 },
  { id: 9002, name: 'Testland Cathedral', lon: 10.2, lat: 50.2 },
  { id: 9003, name: 'Testland Aqueduct', lon: 10.3, lat: 50.3 },
];

/** A square around (10,50) — valid, small, and far from the antimeridian. */
const REGION_WKT =
  'MULTIPOLYGON(((10 50, 10.5 50, 10.5 50.5, 10 50.5, 10 50)))';

export async function seedE2eFixture(): Promise<void> {
  const dbName = process.env.DB_NAME || 'track_regions';
  if (!TEST_DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `Refusing to seed "${dbName}" - name does not look like a test database. ` +
        'Point DB_NAME (and DB_HOST/DB_PORT) at a test database before seeding.',
    );
  }

  await db.transaction(async (tx) => {
    // Idempotent: drop our own rows first. Cascades clear the links.
    await tx.delete(experiences).where(
      inArray(experiences.id, EXPERIENCES.map((e) => e.id)),
    );
    await tx.delete(worldViews).where(eq(worldViews.id, E2E_WORLD_VIEW_ID));

    const [category] = await tx
      .select({ id: experienceCategories.id })
      .from(experienceCategories)
      .where(eq(experienceCategories.name, UNESCO_CATEGORY_NAME));
    if (!category) {
      throw new Error(
        `Category "${UNESCO_CATEGORY_NAME}" missing - is db/init applied?`,
      );
    }

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

    for (const exp of EXPERIENCES) {
      // Unlike regions.geom, experiences.location and experience_locations.location
      // are NOT NULL, so an insert-then-update split fails on the insert itself.
      // Scalars and geometry therefore go in together, in one raw statement -
      // the same split `upsertExperienceRecord` (services/sync/syncUtils.ts)
      // already uses for this exact NOT NULL constraint. sql.identifier()
      // resolves each scalar column name from the Drizzle model, so renaming
      // or dropping any of them still fails `npm run typecheck` even though
      // the statement itself is raw SQL. Only `location` - deliberately
      // absent from the Drizzle model - is a literal.
      await tx.execute(
        sql`INSERT INTO experiences (
              ${sql.identifier(experiences.id.name)},
              ${sql.identifier(experiences.categoryId.name)},
              ${sql.identifier(experiences.externalId.name)},
              ${sql.identifier(experiences.name.name)},
              location
            ) VALUES (
              ${exp.id}, ${category.id}, ${`e2e-${exp.id}`}, ${exp.name},
              ST_SetSRID(ST_MakePoint(${exp.lon}, ${exp.lat}), 4326)
            )`,
      );

      const [location] = (
        await tx.execute<{ id: number }>(
          sql`INSERT INTO experience_locations (
                ${sql.identifier(experienceLocations.experienceId.name)},
                ${sql.identifier(experienceLocations.name.name)},
                ${sql.identifier(experienceLocations.ordinal.name)},
                location
              ) VALUES (
                ${exp.id}, ${exp.name}, 0,
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
