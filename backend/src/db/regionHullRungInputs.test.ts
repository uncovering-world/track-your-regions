import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `uses_hull` chooses what a region's rungs are made of, so changing it has to
 * rebuild them.
 *
 * Rule 19: the low and medium rungs of a hull region derive from
 * `COALESCE(hull_geom_3857, geom_3857)` rather than from the real outline. The
 * flag is documented as manually editable (rule 17) and `updateRegion` writes it
 * on its own — `buildRegionUpdateClauses` puts `uses_hull = $n` in the SET list
 * and nothing else changes. `update_regions_geom_3857()` decided what to rebuild
 * from `geom`, `hull_geom` and `geom_simplified_low`, all three untouched by
 * that write, so the rungs kept the shape they were traced from while
 * `tile_region_islands` switched to the hull layer at once: two layers drawing
 * two different shapes for one region, and no run reporting anything.
 *
 * Measured against the old trigger on the dev database, giving one region a
 * hull and flipping the flag alone: the 5 km rung stayed at 323 points and the
 * 1 km rung at 1,331, against a 45-point hull. With the flag in the trigger's
 * change test they become 24 and 36.
 *
 * The rung inputs are decided in the database, which is where the invalidation
 * belongs (ADR-0035): a caller cannot forget what it does not have to remember.
 * This guard reads the schema text, the way `renderedRungTopology.test.ts` and
 * `tileScopeGuards.test.ts` do, because `db/init/01-schema.sql` has no test
 * runner of its own.
 */

const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8');

/** The body of the `regions` 3857 trigger, between `AS $$` and the closing `$$`. */
function triggerBody(): string {
  const header = 'CREATE OR REPLACE FUNCTION update_regions_geom_3857()';
  const start = schema.indexOf(header);
  if (start === -1) throw new Error('db/init/01-schema.sql declares no update_regions_geom_3857()');
  const open = schema.indexOf('AS $$', start);
  const end = schema.indexOf('\n$$', open);
  if (open === -1 || end === -1) throw new Error('unterminated body for update_regions_geom_3857()');
  return schema.slice(open + 'AS $$'.length, end);
}

describe('a region whose hull flag changes gets its rungs rebuilt', () => {
  const body = triggerBody();

  it('tests the flag itself for a change, not the geometries it chooses between', () => {
    // IS DISTINCT FROM rather than <>: the column is nullable, and NULL <> true
    // is NULL, which would read as "unchanged" on the first flag a row is given.
    expect(body).toContain('NEW.uses_hull IS DISTINCT FROM OLD.uses_hull');
  });

  it('rebuilds the four derived rungs on it, beside a geometry or hull change', () => {
    expect(body).toContain('IF geom_changed OR hull_changed OR hull_flag_changed THEN');
    // The branch that arm guards is the one that reads the flag to pick an
    // input — and it has to be *inside* it. Bounded at the block's own END IF,
    // or the CASE moving into a later sibling block would still pass.
    const opens = body.indexOf('IF geom_changed OR hull_changed OR hull_flag_changed');
    const closes = body.indexOf('END IF;', opens);
    expect(opens).toBeGreaterThan(-1);
    expect(closes).toBeGreaterThan(opens);
    expect(body.slice(opens, closes)).toContain(
      'CASE WHEN NEW.uses_hull THEN COALESCE(NEW.hull_geom_3857, NEW.geom_3857)',
    );
  });
});
