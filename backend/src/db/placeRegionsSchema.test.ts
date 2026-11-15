import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoFile } from '../testSupport/repoFile.js';
import { offeredLocationSql, publishedContentSql } from './readerPredicates.js';
import { membershipAdmittedSql, kindRecordSql } from './membership.js';
import { PLACE_POINT_ARMS } from './placePoints.js';

/**
 * A place's regions are written by the database (ADR-0197): `place_shown_points()`
 * decides which of a place's points place it and which of them a reader may see,
 * and `refresh_place_regions()` writes the rows from them. Those two terms are
 * the TypeScript side's too — `offeredLocationSql` and `publishedContentSql`, and
 * placement's refusal term (ADR-0053) — so a change to one that missed the other
 * would list a place where no reader is shown a point, or hide one where they are.
 *
 * No database in this suite, so this is a text-level guard in the shape of
 * `regionGeomPieces.test.ts`: the terms the function turns on, the migration
 * saying what the schema says, and the triggers being per statement. What rows
 * it writes is `placeRegions.db.test.ts`'s.
 */

/** Comments first, then whitespace, so an assertion cannot be met by a comment. */
const collapse = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

const schema = collapse(readFileSync(repoFile('db', 'init', '01-schema.sql'), 'utf8'));
const migration = collapse(
  readFileSync(repoFile('db', 'migrations', '231-a-place-has-one-region-junction.sql'), 'utf8'),
);
const leavesMigration = collapse(
  readFileSync(repoFile('db', 'migrations', '247-a-whole-knows-its-leaves.sql'), 'utf8'),
);
const geometryMigration = collapse(readFileSync(
  repoFile('db', 'migrations', '243-a-place-is-placed-by-its-outline-and-its-nearest-region.sql'), 'utf8',
));

/** The body of one function, from its CREATE to the end of its dollar quote. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start, `${name} is declared`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(start, close + 2);
}

describe('the points that place a place', () => {
  const body = functionBody(schema, 'place_shown_points');

  it('are the points a reader-facing read calls offered, and not turned down', () => {
    expect(body).toContain(collapse(offeredLocationSql('el')));
    expect(body).toContain('el.refused_at IS NULL');
  });

  it('are visible to a reader by the term every reader-facing read of a point carries', () => {
    expect(body).toContain(collapse(publishedContentSql('el')));
  });

  it('are a place\'s own and its direct parts\', the two arms every reader of its points reads', () => {
    // A region must never list a place whose points no reader read shows.
    expect(body).not.toContain('RECURSIVE');
    expect(body).toContain('SELECT prt.whole_id, prt.part_id FROM experience_parts prt WHERE prt.whole_id = ANY(places)');
    expect(PLACE_POINT_ARMS).toHaveLength(2);
    expect(PLACE_POINT_ARMS[1].from).toMatch(/experience_parts prt\s+JOIN experience_locations el ON el\.experience_id = prt\.part_id/);
  });
});

describe('the geometry that places a place (ADR-0207)', () => {
  const shapes = functionBody(schema, 'place_shape_regions_expected');

  it('is asked of the points placement places, by the terms a reader-facing read calls offered', () => {
    expect(shapes).toContain(`WHERE ${collapse(offeredLocationSql('el'))} AND el.refused_at IS NULL`);
  });

  it('asks an outline whether it is the place\'s own before it places anything', () => {
    expect(shapes).toContain('outline_reaches_place(s.boundary, s.location)');
  });

  it('places by a kind record\'s point only a place with no point of its own, by the terms a record is offered by', () => {
    expect(shapes).toContain(`${kindRecordSql('m')} AND ${membershipAdmittedSql('m')}`);
    expect(shapes).toContain('NOT EXISTS (SELECT 1 FROM experience_locations el WHERE el.experience_id = s.id)');
  });

  it('is written under the places\' region keys, taken before it is computed', () => {
    const writer = functionBody(schema, 'refresh_place_shape_regions');
    expect(writer.indexOf('PERFORM lock_place_regions(places)')).toBeGreaterThan(0);
    expect(writer.indexOf('lock_place_regions')).toBeLessThan(writer.indexOf('place_shape_regions_expected'));
  });

  it('is read by the refresh, which still reads no geometry', () => {
    const expected = functionBody(schema, 'place_regions_expected');
    expect(expected).toContain('experience_shape_regions');
    expect(expected).not.toMatch(/ST_|region_geom_pieces/);
  });
});

describe('the refresh', () => {
  const body = functionBody(schema, 'refresh_place_regions');

  it('walks up to the wholes the places are direct parts of, as far as it walks down', () => {
    const reach = functionBody(schema, 'place_regions_reach');
    expect(reach).not.toContain('RECURSIVE');
    expect(reach).toContain('SELECT prt.whole_id FROM experience_parts prt WHERE prt.part_id = ANY(places)');
  });

  it('never writes over a curator\'s manual row', () => {
    expect(body).toContain("er.assignment_type IS DISTINCT FROM 'manual' AND r.id = er.region_id");
    expect(body).toContain("WHERE er.assignment_type IS DISTINCT FROM 'manual' AND er.listing IS DISTINCT FROM EXCLUDED.listing");
  });

  it('locks the places it rewrites, in key order, before it computes their rows', () => {
    // A place with no rows yet has none to lock: two parts of a new whole
    // placed at once would each compute the whole without the other.
    const lock = functionBody(schema, 'lock_place_regions');
    expect(lock).toContain('WHERE NOT (p % 1024) = ANY(held) ORDER BY 1)');
    expect(lock).toContain('PERFORM pg_advisory_xact_lock(1197, place_key)');
    expect(body).toContain('affected := lock_place_regions(places)');
    expect(body.indexOf('lock_place_regions')).toBeLessThan(body.indexOf('place_regions_expected'));
  });

  it('reads the reach again once its keys are held, and takes what a wait added', () => {
    // A part relation committed while it waited may add a whole to the reach.
    const lock = functionBody(schema, 'lock_place_regions');
    const loop = lock.slice(lock.indexOf('LOOP'));
    expect(loop).toContain('affected := place_regions_reach(places)');
    expect(loop).toContain('EXIT WHEN cardinality(wanted) = 0');
    expect(loop.indexOf('place_regions_reach')).toBeLessThan(loop.indexOf('pg_advisory_xact_lock'));
  });
});

describe('the triggers that call it', () => {
  it('fire once per statement, never per row', () => {
    for (const trigger of ['trg_place_regions_point_update', 'trg_place_regions_point_delete',
      'trg_place_regions_part_insert', 'trg_place_regions_part_update', 'trg_place_regions_part_delete']) {
      const at = schema.indexOf(`CREATE TRIGGER ${trigger}`);
      expect(at, `${trigger} is declared`).toBeGreaterThanOrEqual(0);
      const declaration = schema.slice(at, schema.indexOf(';', at));
      expect(declaration).toContain('FOR EACH STATEMENT');
    }
  });

  it('refresh a part relation\'s old and new places in one call, so one key order holds', () => {
    const body = functionBody(schema, 'place_regions_follow_parts');
    expect(body.match(/refresh_place_regions\(/g)).toHaveLength(1);
  });

  it('follow every column of a point that decides whether it places its place', () => {
    const body = functionBody(schema, 'place_regions_follow_points');
    for (const column of ['experience_id', 'curation_state', 'refused_at', 'missing_since', 'existence', 'merged_into_id']) {
      expect(body).toContain(`o.${column}`);
      expect(body).toContain(`n.${column}`);
    }
  });
});

describe('the migration', () => {
  it('declares what the schema declares, each function as the latest migration that declares it', () => {
    for (const name of ['place_shown_points', 'place_regions_reach', 'lock_place_regions', 'refresh_place_regions',
      'place_regions_follow_points', 'place_regions_follow_parts']) {
      expect(functionBody(migration, name)).toBe(functionBody(schema, name));
    }
    for (const name of ['place_regions_expected', 'places_with_regions', 'outline_reaches_place',
      'place_shape_regions_expected', 'refresh_place_shape_regions']) {
      expect(functionBody(geometryMigration, name)).toBe(functionBody(schema, name));
    }
    expect(migration).toContain("CHECK (listing IN ('offered', 'fallback', 'scope'))");
    expect(migration).toContain("CHECK (assignment_type IS DISTINCT FROM 'manual' OR listing = 'offered')");
  });

  it('writes every place\'s rows once, in a transaction after the one holding the table\'s lock', () => {
    const backfill = migration.indexOf('SELECT refresh_place_regions(NULL)');
    expect(backfill).toBeGreaterThan(0);
    const before = migration.slice(0, backfill);
    expect(before.lastIndexOf('COMMIT;')).toBeGreaterThan(before.indexOf('ALTER TABLE experience_regions'));
    expect(before.lastIndexOf('BEGIN;')).toBeGreaterThan(before.lastIndexOf('COMMIT;'));
  });

  it('places every place by its geometry, then refreshes the ones it placed, after the shape has committed', () => {
    const backfill = geometryMigration.indexOf('refresh_place_shape_regions(NULL, w.world_view_id)');
    expect(backfill).toBeGreaterThan(0);
    const before = geometryMigration.slice(0, backfill);
    expect(before.lastIndexOf('COMMIT;')).toBeGreaterThan(before.indexOf('CREATE TABLE IF NOT EXISTS experience_shape_regions'));
    expect(before.lastIndexOf('BEGIN;')).toBeGreaterThan(before.lastIndexOf('COMMIT;'));
    expect(geometryMigration.indexOf('SELECT refresh_place_regions(ARRAY(SELECT DISTINCT experience_id FROM experience_shape_regions))'))
      .toBeGreaterThan(backfill);
  });
});

describe("a whole's leaves (ADR-0206)", () => {
  const expected = functionBody(schema, 'whole_leaves_expected');
  const refresh = functionBody(schema, 'refresh_whole_leaves');

  it('are offered by the visible point the region refresh places by', () => {
    // A whole counting a place no reader is shown would read "1 of 34" where the list holds 33.
    expect(expected).toContain(collapse(offeredLocationSql('el')));
    expect(expected).toContain('el.refused_at IS NULL');
    expect(expected).toContain(collapse(publishedContentSql('el')));
  });

  it('are written by a refresh of their own, which the region refresh never calls nor is called by', () => {
    expect(refresh).not.toContain('refresh_place_regions');
    expect(functionBody(schema, 'refresh_place_regions')).not.toContain('whole_leaves');
  });

  it('lock every place they rewrite, on the region keys and in key order, before computing', () => {
    expect(refresh).toContain('WHERE NOT (p % 1024) = ANY(held) ORDER BY 1)');
    expect(refresh).toContain('PERFORM pg_advisory_xact_lock(1197, place_key)');
    expect(refresh).toContain('UNION SELECT place_ancestors(places)');
    expect(refresh.indexOf('pg_advisory_xact_lock')).toBeLessThan(refresh.indexOf('whole_leaves_expected'));
  });

  it('follow a part relation and a point by statement, before the region triggers take their keys', () => {
    const triggers = ['part_insert', 'part_update', 'part_delete', 'point_insert', 'point_update', 'point_delete'];
    for (const suffix of triggers) {
      const at = schema.indexOf(`CREATE TRIGGER trg_place_leaves_${suffix}`);
      expect(at, `trg_place_leaves_${suffix} is declared`).toBeGreaterThanOrEqual(0);
      expect(schema.slice(at, schema.indexOf(';', at))).toContain('FOR EACH STATEMENT');
    }
    // Postgres fires the triggers of one timing and event on one table in name
    // order, so each leaf trigger must sort before the region trigger declared
    // beside it. A point added has no region twin: placement refreshes its rows.
    const declared = [...schema.matchAll(/CREATE TRIGGER (trg_place_(?:leaves|regions)_\w+) (AFTER|BEFORE) ([A-Z ]+?) ON (\w+)/g)]
      .map(([, name, timing, events, table]) => ({ name, timing, events: events.split(' OR '), table }));
    const leaves = declared.filter(t => t.name.startsWith('trg_place_leaves_'));
    expect(leaves.map(t => t.name).sort()).toEqual(triggers.map(suffix => `trg_place_leaves_${suffix}`).sort());
    const alone: string[] = [];
    for (const leaf of leaves) {
      const twins = declared.filter(t => t.name.startsWith('trg_place_regions_') && t.table === leaf.table
        && t.timing === leaf.timing && t.events.some(event => leaf.events.includes(event)));
      if (twins.length === 0) alone.push(leaf.name);
      for (const twin of twins) expect(leaf.name < twin.name, `${leaf.name} fires before ${twin.name}`).toBe(true);
    }
    expect(alone).toEqual(['trg_place_leaves_point_insert']);
  });

  it('follow every column of a point the region refresh follows', () => {
    const body = functionBody(schema, 'whole_leaves_follow_points');
    for (const column of ['experience_id', 'curation_state', 'refused_at', 'missing_since', 'existence', 'merged_into_id']) {
      expect(body).toContain(`o.${column}`);
      expect(body).toContain(`n.${column}`);
    }
  });

  it('are declared by their migration as the schema declares them, and backfilled once', () => {
    for (const name of ['place_ancestors', 'whole_leaves_expected', 'refresh_whole_leaves',
      'whole_leaves_follow_parts', 'whole_leaves_follow_points']) {
      expect(functionBody(leavesMigration, name)).toBe(functionBody(schema, name));
    }
    expect(leavesMigration).toContain('SELECT refresh_whole_leaves(NULL)');
  });
});
