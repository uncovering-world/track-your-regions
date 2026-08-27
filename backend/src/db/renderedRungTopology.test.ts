import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Simplification makes an outline coarser. It does not add holes to it.
 *
 * `ST_SimplifyVW` moves every ring on its own, so a simplified outline crosses
 * itself and two parts that were disjoint come to overlap. The `ST_MakeValid`
 * every geometry write in this schema ends with then resolves the overlap the
 * only way it can — by carving it out as an interior ring. Every rung below full
 * resolution therefore carried holes the data does not have, and the rung the
 * map serves is one of them: 66 drawn over north-eastern Thailand where the data
 * has 8, and 1,933 across the eight root regions of the Administrative world
 * view where they hold 610 between them (#685).
 *
 * Nothing in the repository could see it. The rungs are written by SQL that has
 * no test runner of its own, and a hole in a continent is not a failure of any
 * predicate — it is a shape. So this guard reads the text of what queries, the
 * way `tileScopeGuards.test.ts` and `schemaMigrationParity.test.ts` read the
 * schema, and holds one rule: **every simplification that reaches a query
 * preserves topology**. Naming the two permitted calls rather than banning the
 * one that was wrong is what makes a third one arriving have to say which it is
 * (ADR-0036).
 *
 * It sweeps the backend's TypeScript as well as `db/`, because the rungs were
 * not the only place: two curator reads of a region's members simplified with
 * plain `ST_Simplify`, which lets an outline cross itself and returns NULL for a
 * member narrower than the tolerance.
 *
 * The row-level half of the same rule is a catalogue check —
 * `rung-unlike-its-source` in `regionGeometryAssertions.ts`, which asks the live
 * rows both of the ways that pass failed a shape: holes gained at any rung, and
 * pieces lost at the rungs of 5 km and finer. This one watches the code that
 * writes them.
 */

const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8');

const MIGRATION_PATH = fileURLToPath(
  new URL('../../../db/migrations/037-topology-preserving-rungs.sql', import.meta.url),
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const migration = readFileSync(MIGRATION_PATH, 'utf8');

/**
 * The simplification calls PostGIS offers that keep a geometry's topology.
 *
 * `ST_CoverageSimplify` is topology-preserving Visvalingam-Whyatt (GEOS
 * `TPVWSimplifier`), which is rule 13's algorithm with the guarantee; it also
 * keeps a border shared across the rows of one window, which is why the coverage
 * passes use it. `ST_SimplifyPreserveTopology` is the Douglas-Peucker variant
 * with the same guarantee for one row at a time.
 */
const TOPOLOGY_PRESERVING = ['ST_CoverageSimplify', 'ST_SimplifyPreserveTopology'];

/**
 * The source with its `--` comments removed — including the ones inside a SQL
 * template literal in TypeScript, which is where a commented-out query lives.
 *
 * Two things keep it from eating code. A `--` inside a string literal is not a
 * comment, and an odd number of quotes before it says the line is inside one.
 * And a comment opener is `--` followed by whitespace or another dash, which the
 * `i--` of an ordinary TypeScript loop is not; erring the other way would let a
 * call after one hide from the sweep.
 */
function withoutComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      let quotes = 0;
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "'") quotes += 1;
        const opener = line[i] === '-' && line[i + 1] === '-' && /^[-\s]?$/.test(line[i + 2] ?? '');
        if (opener && quotes % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** The body of one `CREATE OR REPLACE FUNCTION …` block, between `AS $$` and `$$;`. */
function functionBody(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION ${name}(`;
  const start = schema.indexOf(header);
  if (start === -1) throw new Error(`db/init/01-schema.sql declares no function ${name}`);
  const open = schema.indexOf('AS $$', start);
  const end = schema.indexOf('\n$$', open);
  if (open === -1 || end === -1) throw new Error(`unterminated body for ${name}`);
  return schema.slice(open + 'AS $$'.length, end);
}

/**
 * Every `ST_…Simplify…(` **call** in a piece of source, in order.
 *
 * The trailing parenthesis is what separates a call from prose about one, so a
 * comment explaining why `ST_SimplifyVW` is gone does not read as a use of it.
 */
function simplifiersIn(source: string): string[] {
  return [...withoutComments(source).matchAll(/ST_\w*Simplify\w*(?=\s*\()/gi)].map((m) => m[0]);
}

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Every file in the repository that can put a simplification into a query. */
function sourcesThatQuery(): string[] {
  const roots: [string, (name: string) => boolean][] = [
    ['backend/src', (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')],
    ['db', (name) => name.endsWith('.sql') || name.endsWith('.py')],
  ];

  return roots.flatMap(([root, wanted]) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- root is one of the two literals above, resolved against this module's own URL
    readdirSync(join(REPO, root), { recursive: true, encoding: 'utf8' })
      .filter(wanted)
      .map((name) => join(REPO, root, name)),
  );
}

describe('everything that queries simplifies only in ways that preserve topology', () => {
  it('makes no call anywhere that could break a shape', () => {
    // Discovered rather than listed: a column or an endpoint added tomorrow is
    // covered by existing. ST_SimplifyVW survived four columns unnoticed, and
    // plain ST_Simplify two curator reads beside them (#685).
    const offenders = sourcesThatQuery().flatMap((path) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from sourcesThatQuery(), which walks two literal roots
      simplifiersIn(readFileSync(path, 'utf8'))
        .filter((call) => !TOPOLOGY_PRESERVING.some((ok) => ok.toLowerCase() === call.toLowerCase()))
        .map((call) => `${relative(REPO, path)}: ${call}`),
    );
    expect(offenders).toEqual([]);
  });

  it('simplifies a rung with the coverage pass, which is Visvalingam-Whyatt with the guarantee', () => {
    // The parts of a valid MultiPolygon are a coverage by construction, so a row
    // goes through the pass as one element and its parts stop colliding with
    // each other. Rule 13's algorithm is kept; only its unsafe form is gone.
    expect(simplifiersIn(functionBody('simplify_for_zoom'))).toEqual(['ST_CoverageSimplify']);
  });

  it('keeps the cheap rungs on the topology-preserving pass they already used', () => {
    expect(simplifiersIn(functionBody('simplify_for_overview'))).toEqual([
      'ST_SimplifyPreserveTopology',
    ]);
  });

  it('leaves no fallback that exists because a simplifier could annihilate a ring', () => {
    // The VW version retried at a tolerance scaled to the largest part's width
    // when nothing survived. Coverage simplification keeps every polygon it is
    // given, so a second attempt would be dead code stating the opposite.
    const body = functionBody('simplify_for_zoom');
    expect(body).not.toContain('max_poly_width');
    expect(simplifiersIn(body)).toHaveLength(1);
  });
});

describe('the migration that rebuilds the rungs', () => {
  it('refuses to run against the definition it exists to replace', () => {
    // Every statement in it is a recompute through simplify_for_zoom(). Against
    // the old definition it would spend its whole runtime writing back the
    // shapes it is meant to replace, and report success.
    expect(migration).toContain('pg_get_functiondef');
    expect(migration).toContain("NOT LIKE '%ST_CoverageSimplify%'");
  });

  it('runs the per-row pass before the coverage pass, so a shared border survives', () => {
    // Only the coverage pass can move both sides of a border between two rows
    // the same way (rule 15). Per-row output overwriting it would put a white
    // sliver between every pair of neighbours.
    const perRow = migration.indexOf('geom_simplified_low = simplify_for_zoom(');
    const coverage = migration.indexOf('simplify_coverage_regions(p.id)');
    expect(perRow).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(perRow);
  });

  it('asks the rows what the file exists to establish before it commits', () => {
    expect(migration).toContain('a rung is still unlike the shape it was made from');
    // Both halves of the rule, since the pass it replaces failed both.
    expect(migration).toContain("rung.counted = 'holes' AND rung.drawn > rung.held");
    expect(migration).toContain("rung.counted = 'pieces' AND rung.drawn < rung.held");
    // The tiles are built from different geometry at the same URLs, so a cache
    // would go on serving the old shapes at cache speed.
    expect(migration).toContain('UPDATE world_views SET tile_version');
  });
});
