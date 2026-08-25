import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
 * - `db/init/01-schema.sql`, where `geometry_focus()` measures and the trigger
 *   stores the box (#674 moved the measurement out of the trigger);
 * - `frontend/src/utils/mapUtils.ts`, which applies the same rule to a shape
 *   that exists only in the client — a boundary being drawn, a cut, a combined
 *   selection — where no trigger has measured it yet. A stored region or
 *   division carries its box and is never measured there; framing a division
 *   from a plain `turf.bbox` is how the bug reached the client before #666,
 *   and downloading its geometry to measure it is what #674 retired;
 * - `db/migrations/032-antimeridian-focus-data.sql`, whose guard refuses to run
 *   against a database whose function predates the fix, and which would refuse
 *   forever if a term it looks for left the schema.
 *
 * `focusFromGeoJson` itself is tested against the real shapes in
 * `frontend/src/utils/mapUtils.test.ts`; nothing here restates that.
 *
 * The last block holds #674's principle across both packages: the rule is
 * decided in exactly two places -- `geometry_focus()` for what the database
 * holds, `focusFromGeoJson()` for what only the client holds -- and every
 * other site reads a stored box. Four detections were found in the tree
 * before it; two of them read Antarctica as crossing.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const collapse = (text: string) => text.replace(/\s+/g, ' ');

const schemaRaw = readFileSync(join(repoRoot, 'db', 'init', '01-schema.sql'), 'utf8');
const schema = collapse(schemaRaw);
/** The schema with its comment lines dropped, for counting what the code does rather than what it says. */
const schemaCode = collapse(
  schemaRaw.split('\n').filter(line => !line.trim().startsWith('--')).join('\n'),
);

/** Every file under a directory, for the guards that hold a rule across a package. */
function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith(ext))
    .map(name => join(dir, name));
}
const migration = collapse(
  readFileSync(join(repoRoot, 'db', 'migrations', '032-antimeridian-focus-data.sql'), 'utf8'),
);
const mapUtils = readFileSync(
  join(repoRoot, 'frontend', 'src', 'utils', 'mapUtils.ts'),
  'utf8',
);

/**
 * One function's body, so no assertion below can match another function. The
 * terminator is asserted: a missing one gives -1, slice(start, -1) runs to the
 * end of the file, and a later function could satisfy every assertion.
 */
function functionBody(signature: string, terminator: string): string {
  const start = schema.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`);
  expect(start, `${signature} is missing from the schema`).toBeGreaterThan(-1);
  const end = schema.indexOf(terminator, start);
  expect(end, `${signature} has no ${terminator} terminator`).toBeGreaterThan(start);
  return schema.slice(start, end);
}

/** The regions trigger: reads geometry_focus(), adds the children aggregation. */
const focusFn = functionBody('update_region_focus_data()', '$$ LANGUAGE plpgsql;');
/** The divisions trigger: reads geometry_focus(), adds nothing (#674). */
const divisionFocusFn = functionBody('update_division_focus_data()', '$$ LANGUAGE plpgsql;');
/** The measurement itself (#674). */
const geometryFocusFn = functionBody('geometry_focus(', 'END; $$;');
/** The threshold, stated once for both. */
const nearGlobalFn = functionBody('near_global_deg()', '$$;');

/** The threshold above which a span is the whole world however it is measured. */
const NEAR_GLOBAL_DEG = 350;

describe('update_region_focus_data() antimeridian rule', () => {
  it('measures snapped geometry, never the raw geometry', () => {
    // The snap is the whole fix: without it ST_ShiftLongitude carries the
    // overshoot back to -179.9999999999999 and the shifted span is the wider one.
    expect(geometryFocusFn).toContain('measure_geom := ST_SnapToGrid(g, 1e-9)');
    expect(geometryFocusFn).toContain('ST_ShiftLongitude(measure_geom)');
    expect(geometryFocusFn).not.toContain('ST_ShiftLongitude(g)');
  });

  it('never takes a shifted box that is itself near-global', () => {
    // Antarctica's shifted span is 359.9995° against an unshifted 360°:
    // narrower, and no more of a frame for that.
    expect(geometryFocusFn).toContain('IF shift_span < norm_span AND shift_span <= near_global_deg() THEN');
  });

  it('delegates the measurement to geometry_focus() and adds only the children', () => {
    // The trigger holds no measurement of its own: one rule, one place (#674).
    // What it adds needs the regions table, which a pure function cannot see.
    expect(focusFn).toContain('SELECT * INTO f FROM geometry_focus(effective_geom)');
    expect(focusFn).toContain('IF f.near_global THEN');
    expect(focusFn).not.toContain('ST_ShiftLongitude');
    expect(focusFn).not.toContain('ST_SnapToGrid');
    expect(focusFn).not.toContain('ST_XMin');
  });

  it('refuses to aggregate children when one of them covers the globe', () => {
    // Shifting a global child maps both its edges onto 180, so it collapses to
    // a point and contributes nothing. That is how Antarctica's continent row
    // came to claim a 347° window with a gap over Queen Maud Land.
    expect(focusFn).toContain('child_covers_globe');
    expect(focusFn).toMatch(/BOOL_OR\(\s*c\.focus_bbox\[1\] <= c\.focus_bbox\[3\]/);
    expect(focusFn).toContain('AND NOT child_covers_globe');
  });

  it('states the near-global threshold once, as a function', () => {
    expect(nearGlobalFn).toContain(`SELECT ${NEAR_GLOBAL_DEG}.0::double precision`);
    // A bare 350 anywhere else is a second, unlabelled copy of the threshold.
    expect(geometryFocusFn).not.toContain('350');
    expect(focusFn).not.toContain('350');
  });

  it('agrees with the threshold the frontend applies to a division', () => {
    expect(mapUtils).toContain(`const NEAR_GLOBAL_DEG = ${NEAR_GLOBAL_DEG};`);
  });
});

describe('032-antimeridian-focus-data.sql', () => {
  it('accepts the trigger the schema now ships', () => {
    // The migration refuses to run against a function predating the fix. Since
    // #674 the trigger delegates to geometry_focus(), so the guard has to accept
    // that shape or refuse forever and read as a broken database rather than a
    // stale guard. The three #671 terms stay for a database between the two.
    expect(migration).toContain("NOT LIKE '%geometry_focus(%'");
    expect(focusFn).toContain('geometry_focus(');
    for (const term of ['ST_SnapToGrid', 'shift_span <= near_global_deg', 'child_covers_globe']) {
      expect(migration, `migration guard dropped the #671 term ${term}`)
        .toContain(`NOT LIKE '%${term}%'`);
    }
  });

  it('recomputes deepest-first, since a parent reads its children stored boxes', () => {
    expect(migration).toContain('FOR lvl IN REVERSE max_depth..0 LOOP');
  });
});

describe('the antimeridian is decided in two places, and nowhere else', () => {
  it('has geometry_focus() as the only measurement in the schema', () => {
    // Comments may name ST_ShiftLongitude to explain the rule; code may call
    // it once, inside the function that is the rule.
    const calls = schemaCode.match(/ST_ShiftLongitude\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(geometryFocusFn).toContain('ST_ShiftLongitude(');
  });

  it('feeds both focus triggers from it', () => {
    expect(divisionFocusFn).toContain('SELECT * INTO f FROM geometry_focus(NEW.geom)');
    expect(divisionFocusFn).not.toContain('ST_XMin');
    expect(schema).toContain(
      'CREATE OR REPLACE TRIGGER trigger_division_focus_data BEFORE INSERT OR UPDATE OF geom ON administrative_divisions',
    );
  });

  it('lets no backend TypeScript decide it from raw longitudes', () => {
    // The two retired detections: a threshold over a point cloud in
    // hull/dateline.ts, and an envelope test in geometryRead.ts. Neither may
    // come back under its old name or its old arithmetic; a backend module
    // reads focus_bbox, or asks geometry_focus() for a shape that is not stored.
    const backendSrc = join(repoRoot, 'backend', 'src');
    for (const file of filesUnder(backendSrc, '.ts')) {
      if (file.endsWith('.test.ts')) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} defines a crossing detection of its own`)
        .not.toMatch(/function crossesDateline\(/);
      expect(text, `${file} decides a crossing from an envelope`)
        .not.toMatch(/min_lng|max_lng/);
    }
  });

  it('keeps the frontend threshold in one place, equal to the schema', () => {
    const frontendSrc = join(repoRoot, 'frontend', 'src');
    const declarations = filesUnder(frontendSrc, '.ts')
      .concat(filesUnder(frontendSrc, '.tsx'))
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      .filter(file => /NEAR_GLOBAL_DEG\s*=/.test(readFileSync(file, 'utf8')));
    expect(declarations.map(file => file.slice(repoRoot.length + 1)))
      .toEqual(['frontend/src/utils/mapUtils.ts']);
    expect(mapUtils).toContain(`const NEAR_GLOBAL_DEG = ${NEAR_GLOBAL_DEG};`);
  });

  it("frames the map's own division paths from the stored box, not a measurement", () => {
    // useMapInteractions used to measure a clipped tile feature and a
    // downloaded geometry to frame a division; both now read what the
    // division list carried (#674).
    const interactions = readFileSync(
      join(repoRoot, 'frontend', 'src', 'components', 'regionMap', 'useMapInteractions.ts'),
      'utf8',
    );
    expect(interactions).not.toContain('turf.bbox');
    expect(interactions).not.toContain('focusFromGeoJson');
    expect(interactions).not.toContain('fetchDivisionGeometry');
  });
});
