/**
 * One definition of the rule the union writers of `regions.geom` are held
 * to, shared by their guards.
 *
 * `regions.geom` is the authoritative shape every derived column is made from
 * (rule 1 of `docs/tech/geometry-columns.md`), so nothing between the union and
 * the column may apply a tolerance: an error baked in there is inherited by
 * `geom_3857` and every `geom_simplified_*` column and can never be recovered
 * (#443).
 *
 * The rule lives here rather than once per guard because the assertion has
 * already been wrong once. It was narrowed to `/simplify\s*\(/i` — "a tolerance
 * is a call, told from prose by the parenthesis after it" — which matches none
 * of the calls that carry a suffix, and an injected
 * `ST_SimplifyPreserveTopology(` walked through a guard that had been proven.
 * Two copies of a pattern with that history is one copy that gets widened and
 * one that silently does not.
 */

/**
 * Any call that coarsens a geometry — that rewrites or discards vertices —
 * spanning the whole identifier, and told from prose about one by the
 * parenthesis after it, the way `renderedRungTopology.test.ts` tells them apart.
 *
 * The simplify family is only half of it. What this guard is about is the
 * *tolerance*, not the function name, and PostGIS offers the same effect under
 * several: `ST_SnapToGrid` is the standard way to shed vertices for storage and
 * is already in this repository's vocabulary (`01-schema.sql` uses it in
 * `geometry_focus`), `ST_ReducePrecision` is its modern equivalent, and
 * `ST_ChaikinSmoothing` rewrites every vertex it is given and sits in
 * `simplify_for_zoom`. Any of them dropped into a statement on the way to
 * `regions.geom` coarsens the column exactly as a simplify call would, so the
 * guard that claims a tolerance cannot come back under another name has to
 * cover the names that actually exist.
 *
 * `ST_Snap` is deliberately *not* here: it moves a vertex onto a neighbour's,
 * which is the union path's legitimate sliver-avoidance step, and the pattern
 * requires the parenthesis directly after the name so it cannot be caught by
 * the `ST_SnapToGrid` arm.
 */
const NO_COARSENING_CALL =
  /\bst_(?:[a-z_]*simplify[a-z_]*|snaptogrid|reduceprecision|chaikinsmoothing)\s*\(/i;

/**
 * Complexity counts that put a region on the union path rather than the
 * single-division fast path: one member and three children, pinned to take
 * no tolerance at all.
 */
export const UNION_SHAPE = {
  member_points: '5000',
  child_points: '900',
  child_count: '3',
  child_row_count: '3',
  member_count: '1',
} as const;

/**
 * Every statement of a union writer whose output can reach `regions.geom`,
 * picked out of a mocked client's calls by what the statement *is* rather than
 * by the order it was issued in.
 *
 * All four are returned, not only the cleaning step: a tolerance added to the
 * snap, the union, or the write itself would reach the column just as surely,
 * and a guard that reads one statement passes while the shape it is about is
 * simplified in the next one. The snap belongs in that list because its result
 * *replaces* the geometry the rest of the pipeline works on — every writer
 * assigns it back over `collectedGeom` — so it is upstream of the column by the
 * same argument as the union.
 *
 * The collect step is held the same way: a union is made of full-resolution
 * inputs, however many points they hold (#459).
 */
function unionStatements(calls: Array<[unknown, unknown[]?]>) {
  const find = (needle: string) => calls.find((c) => String(c[0]).includes(needle));
  // The write is told by its SET: this module reads statements rather than
  // issuing them, and the lint keeps a write's text to the writers (#1073).
  const write = calls.find((c) => /\bregions\b/.test(String(c[0]))
    && String(c[0]).includes('SET geom = validate_multipolygon($2)'));
  const collect = find('direct_member_geoms');
  return {
    /** The hole/sliver cleaning step, whose output is written to `geom`. */
    cleaningSql: String(find('holes_filtered')?.[0] ?? ''),
    /** The neighbour snap, whose output replaces the geometry the union reads. */
    snapSql: String(find('ST_Snap(')?.[0] ?? ''),
    /** The union itself, the cleaning step's input. */
    unionSql: String(find('ST_UnaryUnion')?.[0] ?? ''),
    /** The write, which must carry the cleaned geometry through untouched. */
    writeSql: String(write?.[0] ?? ''),
    /** The collect step, whose output the union is made of. */
    collectSql: String(collect?.[0] ?? ''),
    /** The geometry the write actually received. */
    written: write?.[1]?.[1],
  };
}

/**
 * Every check the union writers' guards make, in one place.
 *
 * The pattern was shared two rounds ago; this shares the *sequence*, which is
 * the thing that actually had to be widened twice — `snapSql` and then
 * `collectSql` each meant editing two copies of the same twenty lines in
 * lockstep, which is the module docstring's own argument one level up.
 *
 * Returns the problems rather than asserting them, so the rule stays in `src/`
 * without pulling a test framework in with it. A caller asserts the list is
 * empty, and each entry names the statement and what was wrong with it.
 *
 * `expected` is the geometry the cleaning step was mocked to return: the write
 * must have received that object, not merely something clean.
 */
export function coarseningProblems(
  calls: Array<[unknown, unknown[]?]>,
  expected: unknown,
): string[] {
  const s = unionStatements(calls);
  const problems: string[] = [];

  // Each statement is identified before it is judged, so a guard cannot pass
  // because the statement it is about was never issued.
  const holdClean = (name: string, sql: string, anchor: string) => {
    if (!sql.includes(anchor)) problems.push(`${name}: statement not found (no ${anchor})`);
    else if (NO_COARSENING_CALL.test(sql)) problems.push(`${name}: carries a coarsening call`);
  };
  holdClean('cleaning', s.cleaningSql, 'holes_filtered');
  holdClean('snap', s.snapSql, 'ST_Snap(');
  holdClean('union', s.unionSql, 'ST_UnaryUnion');
  holdClean('write', s.writeSql, 'SET geom = validate_multipolygon($2)');
  holdClean('collect', s.collectSql, 'direct_member_geoms');

  if (s.written !== expected) problems.push('write: did not receive the cleaning step output');
  return problems;
}
