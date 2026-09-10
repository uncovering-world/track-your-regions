import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A leaf's pieces are kept by the database, from the geometry it holds now.
 *
 * Placement tests a point against the leaves through their geometry cut into
 * pieces of at most 256 vertices (`region_geom_pieces`, #851, ADR-0054): a whole
 * continent read per point is what made a run of 1078 points take 25 minutes.
 * The pieces are a copy, and a copy is only as good as what keeps it. A missing
 * piece costs time -- placement tests a leaf without pieces whole -- but a stale
 * one costs the answer: a point is placed by an outline that is no longer there.
 * So the pieces are replaced by a trigger inside the statement that writes the
 * geometry, the way ADR-0035 keeps ancestor invalidation.
 *
 * No database in this suite, so this is a text-level guard in the shape of
 * `regionAncestorInvalidation.test.ts`: the terms the rule turns on, the
 * migration saying what the schema says, and nothing outside the trigger that
 * writes the table or switches the trigger off. That the trigger fires is
 * verified against the development database.
 */

const repoRoot = join(__dirname, '..', '..', '..');
/** Comments first, then whitespace, so an assertion cannot be met by a comment. */
const collapse = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

const schema = collapse(readFileSync(join(repoRoot, 'db', 'init', '01-schema.sql'), 'utf8'));
const migration = collapse(
  readFileSync(join(repoRoot, 'db', 'migrations', '054-leaf-pieces-for-placement.sql'), 'utf8'),
);

/** Every file under a directory, for the guards that hold a rule across a package. */
function filesUnder(dir: string, ext: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every caller passes a path built from repoRoot and literals
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith(ext))
    .map(name => join(dir, name));
}

/**
 * One function's body. Both anchors are asserted, and the terminator has to come
 * before the next function begins: a body that lost its own would otherwise run on
 * into the next one, where the expectations below could be met by the wrong text.
 */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const end = source.indexOf('$$ LANGUAGE plpgsql;', start);
  expect(end, `${signature} has no terminator`).toBeGreaterThan(start);
  const next = source.indexOf('CREATE OR REPLACE FUNCTION ', start + 1);
  expect(next === -1 || end < next, `${signature} runs on into the next function`).toBe(true);
  return source.slice(start, end);
}

const TABLE = 'CREATE TABLE IF NOT EXISTS region_geom_pieces ( '
  + 'region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE, '
  + 'geom GEOMETRY(MultiPolygon, 4326) NOT NULL );';
const PIECE_INDEX = 'CREATE INDEX IF NOT EXISTS idx_region_geom_pieces_geom ON region_geom_pieces USING GIST(geom);';
const REGION_INDEX = 'CREATE INDEX IF NOT EXISTS idx_region_geom_pieces_region ON region_geom_pieces(region_id);';
const CUT = 'INSERT INTO region_geom_pieces (region_id, geom) SELECT r.id, ST_Multi(piece) FROM regions r '
  + 'CROSS JOIN LATERAL ST_Subdivide(r.geom, 256) AS piece '
  + 'WHERE r.id = p_region_id AND r.is_leaf AND r.geom IS NOT NULL;';
const DELETE_OLD = 'DELETE FROM region_geom_pieces WHERE region_id = NEW.id;';
const GUARDED_CUT = 'BEGIN PERFORM cut_region_geom_pieces(NEW.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING';
const UPDATE_ARM = 'CREATE OR REPLACE TRIGGER trg_regions_geom_pieces AFTER UPDATE OF geom ON regions '
  + 'FOR EACH ROW WHEN (OLD.geom IS DISTINCT FROM NEW.geom) EXECUTE FUNCTION refresh_region_geom_pieces();';
const INSERT_ARM = 'CREATE OR REPLACE TRIGGER trg_regions_geom_insert_pieces AFTER INSERT ON regions '
  + 'FOR EACH ROW WHEN (NEW.geom IS NOT NULL) EXECUTE FUNCTION refresh_region_geom_pieces();';

describe.each([
  ['01-schema.sql', schema],
  ['054-leaf-pieces-for-placement.sql', migration],
])('region_geom_pieces in %s', (_name, source) => {
  it('keeps the pieces in a table of their own, indexed piece by piece', () => {
    // A column would not do: GiST indexes a row whole, and the gain is that each
    // small piece is found by its own box.
    expect(source).toContain(TABLE);
    expect(source).toContain(PIECE_INDEX);
    expect(source).toContain(REGION_INDEX);
  });

  it('cuts the current row of a leaf, never a geometry handed to it', () => {
    // A trigger's NEW can be older than the row once trg_update_is_leaf or the
    // invalidation has written it inside the same statement.
    const cut = functionBody(source, 'cut_region_geom_pieces(p_region_id INTEGER)');
    expect(cut).toContain(CUT);
    expect(cut).not.toContain('NEW.');
  });

  it('drops the old pieces before cutting, and a failed cut leaves none rather than stale ones', () => {
    const refresh = functionBody(source, 'refresh_region_geom_pieces()');
    const deleted = refresh.indexOf(DELETE_OLD);
    expect(deleted, 'the refresh no longer deletes the old pieces').toBeGreaterThan(-1);
    // Outside the handled block: a delete rolled back with a failed cut would
    // leave the previous geometry's pieces standing, and place points by them.
    expect(refresh.indexOf(GUARDED_CUT), 'the cut is not behind the delete, in a handled block')
      .toBeGreaterThan(deleted);
  });

  it('fires on a geometry write and on an insert that brings a shape, and never on is_leaf', () => {
    expect(source).toContain(UPDATE_ARM);
    expect(source).toContain(INSERT_ARM);
    // A parent left childless is nulled for recompute by the handler that
    // emptied it; cutting its old outline first is work the next statement
    // throws away, up to a minute of it inside a request.
    expect(source).not.toMatch(/OF [^;]*is_leaf[^;]*EXECUTE FUNCTION refresh_region_geom_pieces/);
  });
});

describe('054-leaf-pieces-for-placement.sql', () => {
  it('holds writes to regions while it cuts, and leaves the table analysed', () => {
    // Without the lock a geometry written during the backfill gets its fresh
    // pieces joined by a cut of the outline it replaced.
    const lock = migration.indexOf('LOCK TABLE regions IN SHARE ROW EXCLUSIVE MODE;');
    expect(lock, 'the backfill does not lock regions').toBeGreaterThan(-1);
    expect(migration.indexOf('cut_region_geom_pieces(leaf.id)')).toBeGreaterThan(lock);
    // And it fails open as the trigger does: one geometry GEOS cannot cut must
    // neither abort a twenty-minute run nor undo the leaves already cut.
    expect(migration).toContain(
      'BEGIN pieces := pieces + cut_region_geom_pieces(leaf.id); '
      + 'EXCEPTION WHEN OTHERS THEN failed := failed + 1; RAISE WARNING',
    );
    expect(migration).toContain('AND NOT EXISTS (SELECT 1 FROM region_geom_pieces p WHERE p.region_id = r.id)');
    expect(migration).toContain('ANALYZE region_geom_pieces;');
  });
});

describe('the pieces have one writer, and no way round it', () => {
  it('lets no backend TypeScript write the pieces', () => {
    const writes = /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE|TRUNCATE)\s+region_geom_pieces\b/i;
    for (const file of filesUnder(join(repoRoot, 'backend', 'src'), '.ts')) {
      // A guard names what it forbids, so the suite may.
      if (file.endsWith('.test.ts')) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      expect(readFileSync(file, 'utf8'), `${file} writes region_geom_pieces`).not.toMatch(writes);
    }
  });

  it('is never switched off wholesale for a bulk load', () => {
    // regionAncestorInvalidation.test.ts refuses DISABLE TRIGGER trg_regions_geom*,
    // which names these triggers too. What it does not see is a switch that names
    // no trigger: ALL or USER on the table, or a session replaying as a replica,
    // which fires no ordinary trigger at all.
    const wholesale = [/DISABLE\s+TRIGGER\s+(ALL|USER)\b/i, /session_replication_role/i];
    for (const dir of ['db', 'scripts', join('backend', 'src')]) {
      for (const ext of ['.sql', '.py', '.ts', '.sh']) {
        for (const file of filesUnder(join(repoRoot, dir), ext)) {
          if (file.endsWith('.test.ts')) continue;
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from literal roots
          const text = readFileSync(file, 'utf8');
          for (const pattern of wholesale) {
            expect(text, `${file} switches the region triggers off wholesale`).not.toMatch(pattern);
          }
        }
      }
    }
  });
});
