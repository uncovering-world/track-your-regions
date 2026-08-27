import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ancestor geometry invalidation is stated once, in the database.
 *
 * A region's outline is the union of what is under it, so a write to
 * `regions.geom` leaves every derived ancestor covering a smaller world than it
 * contains. #667 settled the rule and #679 enforced it by hand at each writer;
 * that review found seven writers beyond the one the issue described, one round
 * at a time, and every miss was permanent -- the parent kept a stale outline
 * with nothing `NULL` beneath it, fell outside every later run's closure
 * (`loadGroupsToCompute` selects regions with no geometry and every ancestor of
 * one, once per run), and the run reported Complete. North America drew 18.3 %
 * of the countries under it that way.
 *
 * Since #680 the rule is `trg_regions_geom_invalidates_parent`, which runs
 * inside the writing statement (ADR-0035). There is no database in this suite,
 * so this is a text-level guard in the shape `regionFocusAntimeridian.test.ts`
 * and `schemaMigrationParity.test.ts` already use: it cannot prove the trigger
 * fires -- that is verified by hand against the dev database, and recorded on
 * the commit that added it -- only that the terms the rule turns on are still
 * there, that the migration says the same thing as the schema, and above all
 * that nothing has written the rule a second time. The second copy is the
 * failure this file exists for: two implementations of "walk up and null" drift,
 * and the whole point of moving it was that there is one.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const collapse = (text: string) => text.replace(/\s+/g, ' ');

const schemaRaw = readFileSync(join(repoRoot, 'db', 'init', '01-schema.sql'), 'utf8');
const schema = collapse(schemaRaw);
const migration = collapse(
  readFileSync(join(repoRoot, 'db', 'migrations', '036-parent-geometry-invalidation-trigger.sql'), 'utf8'),
);

/** Every file under a directory, for the guards that hold a rule across a package. */
function filesUnder(dir: string, ext: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every caller passes a path built from repoRoot and literals
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith(ext))
    .map(name => join(dir, name));
}

/**
 * One function's body, so no assertion below can match another function. The
 * terminator is asserted: a missing one gives -1, and slicing to it would run to
 * the end of the file, where anything at all could satisfy the expectations.
 */
function functionBody(source: string, signature: string, terminator: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const end = source.indexOf(terminator, start);
  expect(end, `${signature} has no ${terminator} terminator`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const triggerFn = functionBody(schema, 'invalidate_parent_region_geometry()', '$$ LANGUAGE plpgsql;');

/** The four cached columns a cleared region loses. The other rungs follow from them. */
const NULLED_COLUMNS =
  'SET geom = NULL, geom_3857 = NULL, geom_simplified_low = NULL, geom_simplified_medium = NULL';

describe('trg_regions_geom_invalidates_parent', () => {
  it('nulls the parent and nothing else, because the walk upward is the cascade', () => {
    // Nulling the parent is itself a write to regions.geom, so the trigger fires
    // again for the grandparent. A recursive CTE here would be the walk written
    // twice over.
    expect(triggerFn).toContain('WHERE id = NEW.parent_region_id');
    expect(triggerFn).not.toContain('RECURSIVE');
    // The region written keeps what it was given: it has just been computed.
    expect(triggerFn).not.toContain('WHERE id = NEW.id');
  });

  it('never nulls a hand-drawn boundary, and so ends the walk at one', () => {
    // Its outline is drawn rather than unioned, so a descendant gaining geometry
    // cannot have moved it and nothing above it is stale either -- the same stop
    // loadGroupsToCompute makes on both arms of its closure (#283).
    expect(triggerFn).toContain('AND is_custom_boundary IS NOT TRUE');
  });

  it('writes no row for an ancestor that is already empty, which is what terminates it', () => {
    // Also what makes a cycle in parent_region_id terminate, where the recursive
    // CTE this replaced would have run forever.
    expect(triggerFn).toContain('AND geom IS NOT NULL');
  });

  it('clears the four columns a cleared region loses', () => {
    // Clearing geom does not clear its own derivatives: trg_regions_geom_3857
    // recomputes those only from a geometry that is there. The two cheap rungs
    // do follow, from geom_simplified_low going NULL (low_changed).
    expect(triggerFn).toContain(NULLED_COLUMNS);
  });

  it('fires on a change and on an insert that brings a shape, and on nothing else', () => {
    // IS DISTINCT FROM on geometry is exact equality in PostGIS, so this is a
    // real change test: a write of the geometry a region already held
    // invalidates nothing.
    expect(schema).toContain(
      'CREATE OR REPLACE TRIGGER trg_regions_geom_invalidates_parent AFTER UPDATE OF geom ON regions '
      + 'FOR EACH ROW WHEN (OLD.geom IS DISTINCT FROM NEW.geom) '
      + 'EXECUTE FUNCTION invalidate_parent_region_geometry();',
    );
    // createRegion with a drawn shape: geometry from the moment the row exists,
    // so it never seeds the run's closure and neither does its parent.
    expect(schema).toContain(
      'CREATE OR REPLACE TRIGGER trg_regions_geom_insert_invalidates_parent AFTER INSERT ON regions '
      + 'FOR EACH ROW WHEN (NEW.geom IS NOT NULL) '
      + 'EXECUTE FUNCTION invalidate_parent_region_geometry();',
    );
  });
});

describe('036-parent-geometry-invalidation-trigger.sql', () => {
  it('carries the same rule the schema does', () => {
    // A database holding data gets the trigger from the migration and an empty
    // one gets it from the schema. The two drifting is invisible until a fresh
    // database behaves differently from the dev one.
    const migrationFn = functionBody(migration, 'invalidate_parent_region_geometry()', '$$ LANGUAGE plpgsql;');
    expect(migrationFn).toContain(NULLED_COLUMNS);
    expect(migrationFn).toContain('WHERE id = NEW.parent_region_id');
    expect(migrationFn).toContain('AND is_custom_boundary IS NOT TRUE');
    expect(migrationFn).toContain('AND geom IS NOT NULL');
    for (const trigger of ['trg_regions_geom_invalidates_parent', 'trg_regions_geom_insert_invalidates_parent']) {
      expect(migration, `the migration does not create ${trigger}`)
        .toContain(`CREATE OR REPLACE TRIGGER ${trigger}`);
    }
  });
});

describe('the rule has one implementation, and no way round it', () => {
  it('lets no backend TypeScript null a geometry along a walk of the tree', () => {
    // Behaviour, not a name: reading ancestors is ordinary and sixteen modules
    // do it -- curator scope in middleware/auth.ts, breadcrumbs, the matchers.
    // What belongs to the trigger alone is nulling geom on rows chosen by
    // following parent_region_id, which is what nullGeometryOf did until #680.
    // A module that wants a region recomputed nulls that one region and lets
    // the news travel up on its own.
    //
    // SQL in this package lives in template literals, so the odd chunks of a
    // split on backticks are the statements. Anchored, or hull_geom = NULL --
    // three legitimate hull-clearing statements -- would read as a match.
    const nullsGeom = /(?<!\w)geom\s*=\s*NULL/;
    const backendSrc = join(repoRoot, 'backend', 'src');
    for (const file of filesUnder(backendSrc, '.ts')) {
      // A guard has to name what it forbids, so the suite is where those names
      // are allowed to appear -- the same exclusion regionFocusAntimeridian
      // makes for the detections it retired.
      if (file.endsWith('.test.ts')) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      const raw = readFileSync(file, 'utf8');
      expect(collapse(raw), `${file} names a helper the trigger replaced`)
        .not.toContain('invalidateAncestorGeometry');
      for (const [index, chunk] of raw.split('`').entries()) {
        if (index % 2 === 0 || !nullsGeom.test(chunk)) continue;
        expect(collapse(chunk), `${file} nulls a geometry along a walk of parent_region_id`)
          .not.toContain('parent_region_id');
      }
    }
  });

  it('keeps invalidateRegionGeometry a single-row statement', () => {
    // It nulls the region a member or structure edit changed, by primary key.
    // The ancestors are the trigger's, reached because this is itself a write to
    // regions.geom.
    const helpers = collapse(readFileSync(
      join(repoRoot, 'backend', 'src', 'controllers', 'worldView', 'helpers.ts'), 'utf8',
    ));
    // Both anchors are asserted for the reason functionBody() asserts its
    // terminator: indexOf gives -1 for a name that has been renamed, slice reads
    // -1 as length - 1, and the window would silently become some other span
    // that could satisfy every expectation below.
    const start = helpers.indexOf('export async function invalidateRegionGeometry');
    expect(start, 'invalidateRegionGeometry is missing').toBeGreaterThan(-1);
    const end = helpers.indexOf('export async function syncImportMatchStatus', start);
    expect(end, 'syncImportMatchStatus no longer follows invalidateRegionGeometry').toBeGreaterThan(start);
    const statement = helpers.slice(start, end);
    expect(statement).toContain('WHERE id = $1 AND is_custom_boundary IS NOT TRUE');
    expect(statement).not.toContain('parent_region_id');
  });

  it('lets no read path write a region geometry', () => {
    // Two public GETs cached what they merged on the fly, fire-and-forget: a
    // bare union with none of the pipeline's work, and storing it took the
    // region out of the run's closure so the good geometry was never computed
    // (#667's shape, from an anonymous request). Under the trigger it would
    // blank a continent for every visitor as well (#680).
    const read = collapse(readFileSync(
      join(repoRoot, 'backend', 'src', 'controllers', 'worldView', 'geometryRead.ts'), 'utf8',
    ));
    expect(read).not.toMatch(/UPDATE regions SET geom/);
  });

  it('is never switched off for a bulk load', () => {
    // db/init-db.py disables three triggers on administrative_divisions while it
    // loads GADM and computes their columns in one pass afterwards. Doing that
    // to this one would lose the invalidation for every row of the load, with
    // nothing afterwards to make up for it.
    for (const dir of ['db', join('backend', 'src'), 'scripts']) {
      const root = join(repoRoot, dir);
      for (const ext of ['.sql', '.py', '.ts', '.sh']) {
        for (const file of filesUnder(root, ext)) {
          if (file.endsWith('.test.ts')) continue;
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from literal roots
          const text = readFileSync(file, 'utf8');
          expect(text, `${file} disables the invalidation trigger`)
            .not.toContain('DISABLE TRIGGER trg_regions_geom');
        }
      }
    }
  });
});
