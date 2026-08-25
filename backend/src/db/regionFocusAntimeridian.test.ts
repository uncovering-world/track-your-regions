import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The antimeridian rule behind `focus_bbox`, held in the three places that state it.
 *
 * A region crossing the dateline is stored as `west > east`; one that really
 * wraps the world keeps a full-width box. Telling those apart is one rule, and
 * before #666 the trigger got it wrong for a reason no reader would guess:
 * GADM's geometry overshoots +180 by 1e-13 degrees -- some 11 nanometres -- and
 * `ST_ShiftLongitude` wraps in both directions, so the five overshooting
 * vertices of the Far Eastern Federal District came back at -179.9999999999999
 * and the shifted span measured 370° against an unshifted 360°. The region was
 * filed as global, the map framed the whole Earth at zoom 1, and the anchor
 * point sat in the North Sea. Fiji's anchor sat in the South Atlantic.
 *
 * There is no database in this suite, so this is a text-level guard in the
 * shape `tileScopeGuards.test.ts` and `schemaMigrationParity.test.ts` already
 * use: it cannot prove the SQL runs, only that the terms the fix turns on are
 * still in it. What it can prove properly is the agreement between the three
 * files, which is where this rule is most likely to drift:
 *
 * - `db/init/01-schema.sql`, where the trigger computes the stored box;
 * - `frontend/src/utils/mapUtils.ts`, which applies the same rule to a GADM
 *   division, since a division has focus data nowhere — not in the tiles, not
 *   in the API — and framing it from a plain `turf.bbox` reproduced the bug in
 *   the client after it was fixed in the database;
 * - `db/migrations/032-antimeridian-focus-data.sql`, whose guard refuses to run
 *   against a database whose function predates the fix, and which would refuse
 *   forever if a term it looks for left the schema.
 *
 * `focusFromGeoJson` itself is tested against the real shapes in
 * `frontend/src/utils/mapUtils.test.ts`; nothing here restates that.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const collapse = (text: string) => text.replace(/\s+/g, ' ');

const schema = collapse(readFileSync(join(repoRoot, 'db', 'init', '01-schema.sql'), 'utf8'));
const migration = collapse(
  readFileSync(join(repoRoot, 'db', 'migrations', '032-antimeridian-focus-data.sql'), 'utf8'),
);
const mapUtils = readFileSync(
  join(repoRoot, 'frontend', 'src', 'utils', 'mapUtils.ts'),
  'utf8',
);

/** The body of update_region_focus_data(), so no assertion below can match another function. */
const focusFn = (() => {
  const start = schema.indexOf('CREATE OR REPLACE FUNCTION update_region_focus_data()');
  expect(start, 'update_region_focus_data() is missing from the schema').toBeGreaterThan(-1);
  const end = schema.indexOf('$$ LANGUAGE plpgsql;', start);
  // Without this, a missing terminator gives -1, slice(start, -1) runs to the end of
  // the file, and a later function can satisfy every assertion below.
  expect(end, 'update_region_focus_data() has no $$ LANGUAGE plpgsql; terminator')
    .toBeGreaterThan(start);
  return schema.slice(start, end);
})();

/** The threshold above which a span is the whole world however it is measured. */
const NEAR_GLOBAL_DEG = 350;

describe('update_region_focus_data() antimeridian rule', () => {
  it('measures snapped geometry, never the raw geometry', () => {
    // The snap is the whole fix: without it ST_ShiftLongitude carries the
    // overshoot back to -179.9999999999999 and the shifted span is the wider one.
    expect(focusFn).toContain('measure_geom := ST_SnapToGrid(effective_geom, 1e-9)');
    expect(focusFn).toContain('ST_ShiftLongitude(measure_geom)');
    expect(focusFn).not.toContain('ST_ShiftLongitude(effective_geom)');
  });

  it('never takes a shifted box that is itself near-global', () => {
    // Antarctica's shifted span is 359.9995° against an unshifted 360°:
    // narrower, and no more of a frame for that. The branch inside the
    // near-global block is the one that can be handed such a span, and it has
    // to check before keeping the box.
    expect(focusFn).toContain('ELSIF shift_span < norm_span AND shift_span <= near_global_deg THEN');
    // The other shifted branch needs no term of its own and must not grow one:
    // it is the else-arm of this test, so it only ever sees a span already
    // below the threshold.
    expect(focusFn).toContain('IF norm_span > near_global_deg THEN');
  });

  it('refuses to aggregate children when one of them covers the globe', () => {
    // Shifting a global child maps both its edges onto 180, so it collapses to
    // a point and contributes nothing. That is how Antarctica's continent row
    // came to claim a 347° window with a gap over Queen Maud Land.
    expect(focusFn).toContain('child_covers_globe');
    expect(focusFn).toMatch(/BOOL_OR\(\s*c\.focus_bbox\[1\] <= c\.focus_bbox\[3\]/);
    expect(focusFn).toContain('AND NOT child_covers_globe');
  });

  it('states the near-global threshold once, as a constant', () => {
    expect(focusFn).toContain(`near_global_deg CONSTANT double precision := ${NEAR_GLOBAL_DEG}`);
    // A bare 350 left behind is a second, unlabelled copy of the threshold.
    expect(focusFn.replace(/near_global_deg CONSTANT double precision := 350;/, ''))
      .not.toContain('350');
  });

  it('agrees with the threshold the frontend applies to a division', () => {
    expect(mapUtils).toContain(`const NEAR_GLOBAL_DEG = ${NEAR_GLOBAL_DEG};`);
  });
});

describe('032-antimeridian-focus-data.sql', () => {
  it('looks for terms the fixed function actually contains', () => {
    // The migration refuses to run against a function predating the fix, and it
    // checks the whole contract rather than one term standing for it: a function
    // that snaps but keeps a near-global shifted box would pass a one-term guard
    // and be handed the repair. Each term has to still be in the schema, or the
    // guard refuses forever and reads as a broken database rather than a stale
    // guard.
    for (const term of ['ST_SnapToGrid', 'shift_span <= near_global_deg', 'child_covers_globe']) {
      expect(migration, `migration guard does not check ${term}`)
        .toContain(`NOT LIKE '%${term}%'`);
      expect(focusFn, `schema no longer contains ${term}, so the guard can never pass`)
        .toContain(term);
    }
  });

  it('recomputes deepest-first, since a parent reads its children stored boxes', () => {
    expect(migration).toContain('FOR lvl IN REVERSE max_depth..0 LOOP');
  });
});
