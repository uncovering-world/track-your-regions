import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hideLostSql, offeredLocationSql, publishedContentSql,
} from '../controllers/experience/experienceLifecycle.js';
import { placeOfferedSql, rowKindJoinSql } from './membership.js';

/**
 * A tile function that answers for one scope must be given that scope.
 *
 * Martin publishes every compatible function in the database on its own
 * unauthenticated port (`martin/config.yaml`, and see
 * `docs/security/SECURITY.md` § Known Gaps), so what a function answers to a
 * request the application never makes is reachable all the same. Twice now a
 * function has answered such a request with everything it could have scoped:
 * `tile_region_islands` filtered on `uses_hull` alone and drew the islands of
 * every hull region in the database over whichever world view was open (#660),
 * and the two world-view sources filtered on `p_world_view_id IS NULL OR …`,
 * so a request naming no world view answered for all of them at once (#662).
 *
 * Both were fixed in the SQL and neither was pinned by anything: the frontend
 * tests pin the URL builder, which is the layer that was never wrong. This
 * guard is the missing half, and it lives in the backend suite for the reason
 * `martinTileExposure.test.ts` gives — that suite is the one the pre-commit
 * gate runs, and `db/init/01-schema.sql` has no test runner of its own.
 * Asserting over the text of that file is the shape `columnBounds.test.ts` and
 * `schemaMigrationParity.test.ts` already use.
 *
 * What it holds is the contract below, not a pattern found in the file: every
 * tile function is listed with the parameters it takes and whether each is
 * required, so a new one — auto-published the moment it exists — has to say
 * which it is rather than inheriting silence.
 *
 * The requirement is then written down in three places, and this holds all
 * three to that one table: the function body, which enforces it; the
 * `COMMENT ON FUNCTION`, which is what `\df+` shows; and the parameter table in
 * `martin/README.md` § Function Sources, which is what someone building a tile
 * URL reads and which `docs/security/SECURITY.md` § Known Gaps cites as the
 * enumeration of what Martin publishes.
 */

const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8');

const README_PATH = fileURLToPath(new URL('../../../martin/README.md', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const readme = readFileSync(README_PATH, 'utf8');

/**
 * Every tile source, with the parameters it reads out of `query_params`.
 *
 * `required` means the function refuses a request that omits it — an empty
 * tile, which Martin answers as HTTP 204 — rather than dropping the filter and
 * answering for everything. `optional` means the answer is meaningful without
 * it and it narrows what comes back: `parent_id` on the island source, where
 * the world view is already named and a parent id belongs to one world view.
 *
 * `filters` is the predicate that has to *apply* each of them. Refusing a
 * request that names no scope and then ignoring the scope it was given are two
 * different failures with one outcome — every world view's rows in one tile —
 * and #662 was the second of them wearing the first's clothes, so declaring the
 * guard without declaring the filter would pin half the fix.
 */
interface TileSource {
  required: string[];
  optional: string[];
  filters: Record<string, string>;
}

const TILE_SOURCES: Record<string, TileSource> = {
  tile_world_view_root_regions: {
    required: ['world_view_id'],
    optional: [],
    filters: { world_view_id: 'r.world_view_id = p_world_view_id' },
  },
  tile_world_view_all_leaf_regions: {
    required: ['world_view_id'],
    optional: [],
    filters: { world_view_id: 'r.world_view_id = p_world_view_id' },
  },
  tile_region_subregions: {
    required: ['parent_id'],
    optional: [],
    filters: { parent_id: 'r.parent_region_id = p_parent_id' },
  },
  tile_gadm_root_divisions: { required: [], optional: [], filters: {} },
  tile_gadm_subdivisions: {
    required: ['parent_id'],
    optional: [],
    filters: { parent_id: 'd.parent_id = p_parent_id' },
  },
  tile_region_islands: {
    required: ['world_view_id'],
    optional: ['parent_id'],
    filters: {
      world_view_id: 'r.world_view_id = p_world_view_id',
      // Optional, so its predicate is the one that may admit NULL — that is
      // what makes the parameter narrow the answer rather than gate it.
      parent_id: 'p_parent_id IS NULL OR r.parent_region_id = p_parent_id',
    },
  },
  // The one source that answers about the catalogue rather than about a world
  // view's shapes (#910), and the only one with nothing to scope: a place
  // belongs to the catalogue, not to a lens, so naming no kind is the world of
  // every kind rather than a missing scope. What bounds it instead is the four
  // reader-facing predicates, held below.
  tile_experience_points: {
    required: [],
    optional: ['kind_id'],
    filters: { kind_id: 'p_kind_id IS NULL OR m.kind_id = p_kind_id' },
  },
};

/**
 * The reader-facing predicates `tile_experience_points` has to carry, composed
 * from the fragments the REST reads compose rather than written out here.
 *
 * Martin serves that function on an unauthenticated port, so a predicate
 * dropped from it is a publication rather than a rendering bug: a point a
 * source has withdrawn, a point or an arrival no curator has passed, a
 * demolished site, an object every kind's rule turned down. The REST reads ask
 * those four questions through `experienceLifecycle.ts` and `membership.ts`;
 * raw SQL in the schema file cannot import them, and this is what keeps the
 * second spelling equal to the first.
 *
 * `rowKindJoinSql` is taken up to its second join: the tile carries the kind's
 * id and not its name, so only the half that decides *which* membership is the
 * row's own applies — and that half is what makes `kind_id` mean on the map
 * what it means in a region's list.
 */
const READER_PREDICATES: Record<string, string> = {
  'the source still offers the point, and it still stands': offeredLocationSql('el'),
  'a curator has passed the point': publishedContentSql('el'),
  'the object still stands': hideLostSql('e'),
  'some membership of the object is admitted and passed': placeOfferedSql('e'),
  "the kind is the row's own": rowKindJoinSql('e', 'm', 'k')
    .split('LEFT JOIN experience_kinds')[0]
    .trim(),
};

/** The body of one `CREATE OR REPLACE FUNCTION …` block, between `AS $$` and `$$;`. */
function functionBody(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION ${name}(`;
  const start = schema.indexOf(header);
  if (start === -1) throw new Error(`db/init/01-schema.sql declares no function ${name}`);
  const open = schema.indexOf('AS $$', start);
  const end = schema.indexOf('\n$$;', open);
  if (open === -1 || end === -1) throw new Error(`unterminated body for ${name}`);
  return schema.slice(open + 'AS $$'.length, end);
}

/**
 * The parameters a body reads, by the name they carry in the request, mapped
 * to the variable each is read into. The two are held to the `p_<name>`
 * convention every one of these functions follows, so the guard assertions
 * below can name the variable without a second lookup.
 */
function parametersRead(name: string, body: string): Map<string, string> {
  const params = new Map<string, string>();
  const READ = "(query_params->>'";

  for (const line of body.split('\n')) {
    const at = line.indexOf(READ);
    if (at === -1) continue;

    const quoted = line.slice(at + READ.length);
    const param = quoted.slice(0, quoted.indexOf("'"));
    const variable = line.slice(0, at).split(':=')[0].trim();

    expect(variable, `${name} reads ${param} into "${variable}", not p_${param}`).toBe(
      `p_${param}`,
    );
    params.set(param, variable);
  }
  return params;
}

/** Every `tile_*` function the schema declares, discovered rather than listed. */
function declaredTileFunctions(): string[] {
  const names = schema.matchAll(/CREATE OR REPLACE FUNCTION (tile_\w+)\(/g);
  return [...new Set([...names].map((m) => m[1]))].sort();
}

/**
 * The Parameters cell of each row in `martin/README.md` § Function Sources, by
 * source name. That table is the reference for the HTTP surface — what someone
 * building a tile URL reads — and it is the third place the same requirement is
 * written down, after the function body and its `COMMENT`.
 */
function readmeParameterCells(): Map<string, string> {
  const cells = new Map<string, string>();

  for (const line of readme.split('\n')) {
    if (!line.startsWith('| `/tile_')) continue;
    const columns = line.split('|').map((column) => column.trim());
    const endpoint = columns[1];
    const start = endpoint.indexOf('/tile_') + 1;
    cells.set(endpoint.slice(start, endpoint.indexOf('/{', start)), columns[2]);
  }
  return cells;
}

/** The `COMMENT ON FUNCTION` string a source carries, which is what `\df+` shows. */
function functionComment(name: string): string {
  const header = `COMMENT ON FUNCTION ${name} IS '`;
  const start = schema.indexOf(header);
  if (start === -1) throw new Error(`db/init/01-schema.sql comments no function ${name}`);
  const body = schema.slice(start + header.length);
  return body.slice(0, body.indexOf("'"));
}

describe('tile function scope guards', () => {
  it('covers every tile function the schema declares', () => {
    // A function is published by existing — `auto_publish.functions` is on and
    // discovers whatever is compatible — so a new one arriving without a line
    // in TILE_SOURCES is the case this catches.
    expect(declaredTileFunctions()).toEqual(Object.keys(TILE_SOURCES).sort());
  });

  it.each(Object.entries(TILE_SOURCES))(
    '%s reads exactly the parameters it declares',
    (name, { required, optional }) => {
      const params = parametersRead(name, functionBody(name));
      expect([...params.keys()].sort()).toEqual([...required, ...optional].sort());
    },
  );

  it.each(Object.entries(TILE_SOURCES))(
    '%s declares the filter that applies each parameter it takes',
    (name, { required, optional, filters }) => {
      // The other columns are each pinned against something outside this
      // table — what the body reads, the COMMENT, the README row — so a
      // parameter cannot be declared without the file agreeing. `filters` has
      // no such counterpart, and the assertion that reads it iterates the
      // entries that exist: a source given a parameter and no filter entry
      // would skip that check rather than fail it, and apply its scope to
      // nothing.
      expect(
        Object.keys(filters).sort(),
        `${name} declares a parameter it filters on nothing with`,
      ).toEqual([...required, ...optional].sort());
    },
  );

  it.each(Object.entries(TILE_SOURCES))(
    '%s says in its own comment which parameters it requires',
    (name, { required, optional }) => {
      // `COMMENT ON FUNCTION` is what `\df+` shows someone reading the database
      // rather than this file, and a guard added without the marker moving
      // reads as optional there.
      const comment = functionComment(name);
      for (const param of required) expect(comment).toContain(`${param} (required)`);
      for (const param of optional) expect(comment).toContain(`${param} (optional)`);
      if (required.length === 0 && optional.length === 0) {
        expect(comment).not.toContain('Query params');
      }
    },
  );

  it('is listed for every source in the Martin parameter table', () => {
    // `SECURITY.md` § Known Gaps cites that table as the enumeration of what
    // Martin publishes, so a source missing from it makes a security claim
    // stale, not just a reference page.
    expect([...readmeParameterCells().keys()].sort()).toEqual(Object.keys(TILE_SOURCES).sort());
  });

  it.each(Object.entries(TILE_SOURCES))(
    '%s is marked the same way in the Martin parameter table',
    (name, { required, optional }) => {
      // The third statement of the same fact, and the one furthest from the
      // code: a reader building a tile URL reads this and never opens the
      // schema. Held to `TILE_SOURCES` for the reason the `COMMENT` markers
      // are — a correction that is not pinned drifts back.
      // The table writes each name as inline code, which the markers sit
      // outside of: `world_view_id` (required).
      const cell = readmeParameterCells().get(name);
      for (const param of required) expect(cell).toContain(`\`${param}\` (required)`);
      for (const param of optional) expect(cell).toContain(`\`${param}\` (optional)`);
      if (required.length === 0 && optional.length === 0) expect(cell).toBe('-');
    },
  );

  it.each(Object.entries(TILE_SOURCES).filter(([, p]) => p.required.length > 0))(
    '%s refuses a request that names no scope',
    (name, { required }) => {
      const body = functionBody(name);
      const params = parametersRead(name, body);
      // The first ST_AsMVT is where the answer starts being built; a guard
      // after it would refuse nothing.
      const answer = body.indexOf('ST_AsMVT');

      for (const param of required) {
        const variable = params.get(param);
        const guard = body.indexOf(`IF ${variable} IS NULL THEN`);
        expect(guard, `${name} does not refuse a request without ${param}`).toBeGreaterThan(-1);
        expect(guard, `${name} checks ${param} after building the tile`).toBeLessThan(answer);
        expect(body.slice(guard, answer)).toContain("RETURN '';");

        // The #662 shape: a guard can be added and the predicate left
        // admitting NULL, which reads as scoped and is not. Both halves have
        // to move for the function to actually require the parameter.
        expect(body, `${name} still admits a NULL ${param} in its filter`).not.toContain(
          `${variable} IS NULL OR`,
        );
      }
    },
  );

  it.each(Object.entries(TILE_SOURCES).filter(([, p]) => p.optional.length > 0))(
    '%s leaves its optional parameters optional',
    (name, { optional }) => {
      const body = functionBody(name);
      const params = parametersRead(name, body);

      for (const param of optional) {
        // Declared optional and refused anyway would make this table a
        // description of nothing.
        expect(
          body,
          `${name} refuses a request without ${param}, which is declared optional`,
        ).not.toContain(`IF ${params.get(param)} IS NULL THEN`);
      }
    },
  );

  it.each(Object.entries(TILE_SOURCES).filter(([, p]) => Object.keys(p.filters).length > 0))(
    '%s filters on every parameter it takes',
    (name, { filters }) => {
      const body = functionBody(name);
      // Refusing a scopeless request and then not applying the scope it was
      // given end in the same tile — every world view's rows — and the guard
      // assertions above cannot tell the difference: a function that reads the
      // parameter, refuses without it and then drops the WHERE clause passes
      // every one of them. This is the assertion that reads the filter.
      for (const [param, filter] of Object.entries(filters)) {
        expect(body, `${name} does not apply ${param} to anything`).toContain(filter);
      }
    },
  );
});

/** A body with its comments gone and its whitespace flattened, so the fragments match as text. */
function flattened(name: string): string {
  return functionBody(name).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
}

describe('the catalogue points source publishes only what a reader may see', () => {
  it.each(Object.entries(READER_PREDICATES))('asks that %s', (_question, fragment) => {
    expect(flattened('tile_experience_points')).toContain(fragment.replace(/\s+/g, ' '));
  });

  it('carries the place\u2019s id where the drawing side looks for it', () => {
    // The six region sources pass `'id'` to `ST_AsMVT` as the feature id, and
    // PostGIS then strips that column from the properties. This one does not:
    // it carries `locationId` as an ordinary property, because a point needs no
    // feature state and a second copy of the id is bytes on the densest tile.
    //
    // Which makes the two halves a contract. Written with the feature id and
    // read off `feature.id`, the reader got `undefined` for every pin and fell
    // back to keying the hover by the *object* — so the ring and the popup
    // stayed on the first of the Rock Art of the Mediterranean Basin's 734
    // shelters while the pointer crossed the rest, which is the exact failure
    // `useMarkerInteractions` records for a region's markers.
    const body = flattened('tile_experience_points');
    expect(body, 'the tile emits the place id as a property').toContain('AS "locationId"');
    expect(body, 'and passes no feature_id_name, which would strip it')
      .toContain("ST_AsMVT(tile, 'points', 4096, 'geom')");

    // Comments stripped before the second assertion: the note next to that
    // line says "a property, not `feature.id`", and a guard that read its own
    // explanation as the thing it forbids would fail on the fix.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
    const reader = readFileSync(
      fileURLToPath(new URL(
        '../../../frontend/src/components/experienceMarkers/useWorldPointInteractions.ts',
        import.meta.url)),
      'utf8',
    );
    const code = reader.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code, 'the drawing side reads it off the properties')
      .toContain('feature.properties?.locationId');
    expect(code, 'and never off a feature id this source does not set')
      .not.toMatch(/\bfeatures?\[\d*\]?\.id\b|\bfeature\.id\b/);
  });

  it('carries a pin only where the drawing side can use one', () => {
    // A feature carries its name, its kind and its fold above this zoom and
    // nothing but a point and that fold below it, which is 112 kB against
    // 583 kB on the tile that holds the whole world. The threshold is not free to choose: markers
    // fade in from MARKER_FADE_START, and MapLibre serves a fractional zoom
    // from the integer tile below it, so a threshold above that band's floor
    // fades in pins with no colour and no name. Read from the drawing side
    // rather than restated, the way `urlSafety.test.ts` reads the hosts a
    // picture may come from: no import crosses the boundary, and only this
    // test tree can read files.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
    const layers = readFileSync(
      fileURLToPath(new URL(
        '../../../frontend/src/components/experienceMarkers/layers.ts', import.meta.url)),
      'utf8',
    );
    const maxZoom = /const HEATMAP_MAX_ZOOM = ([\d.]+);/.exec(layers);
    const fadeBand = /const MARKER_FADE_START = HEATMAP_MAX_ZOOM - ([\d.]+);/.exec(layers);
    expect(maxZoom, 'the drawing side declares HEATMAP_MAX_ZOOM').not.toBeNull();
    expect(fadeBand, 'the drawing side derives MARKER_FADE_START from it').not.toBeNull();

    const firstLabelled = Math.floor(Number(maxZoom![1]) - Number(fadeBand![1]));
    expect(flattened('tile_experience_points')).toContain(`labelled := z >= ${firstLabelled};`);
  });

  it('answers a value that is not a kind id with an empty tile, not an error', () => {
    // Martin serves this on its own port, so the parameter is whatever a
    // stranger typed, and what the cast raises comes back as a 500 carrying the
    // Postgres message. Both of the cast's classes are named, because they are
    // different values of wrong and only one is obvious: `abc`, `1.5` and the
    // empty string raise 22P02, while `99999999999` — a perfectly good integer
    // that does not fit — raises 22003 from `pg_strtoint32_safe`. The first
    // version of this guard caught only 22P02 and left that one answering 500.
    //
    // Named rather than `WHEN others`, which would answer an empty tile for a
    // cancelled query too, so this holds the conditions rather than the shape.
    const body = flattened('tile_experience_points');
    expect(body, 'the cast is guarded at all').toContain('EXCEPTION WHEN');
    for (const condition of ['invalid_text_representation', 'numeric_value_out_of_range']) {
      expect(body, `${condition} is not caught`).toContain(condition);
    }
    expect(body, 'a blanket handler would swallow more than a bad parameter')
      .not.toContain('WHEN others');
    // And what the handler *does*, not only what it catches: a handler that
    // re-raised would leave every assertion above green while the endpoint went
    // back to answering 500, which is the whole of what this guard is for.
    expect(body, 'the handler answers with an empty tile')
      .toMatch(/EXCEPTION WHEN [^;]*THEN RETURN '';/);
  });
});
