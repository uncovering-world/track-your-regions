/**
 * One definition of the rule the three union writers of `regions.geom` are held
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

/** The same pattern as a counting matcher, so the two never drift apart. */
const COARSENING_CALL_GLOBAL = new RegExp(NO_COARSENING_CALL.source, 'gi');

/**
 * The same pattern again, behind the `CASE WHEN $2` that makes one legitimate.
 * Built from the same source rather than spelled out, for the reason this whole
 * module exists: a third copy is the one that does not get widened. Deriving it
 * means adding a name above cannot leave the collect step's exemption behind.
 *
 * Two forms of one expression: the plain one answers "is the legitimate call
 * still there", the global one counts. Writing the first as a looser pattern —
 * `CASE WHEN $2 THEN st_` — is what an earlier revision did, and it matched any
 * PostGIS call at all, so an input-side guard rewritten to `ST_Buffer` would
 * have satisfied the anti-vacuity check while leaving both counts at zero.
 */
const GUARDED_COARSENING_CALL = new RegExp(
  String.raw`CASE\s+WHEN\s+\$2\s+THEN\s+` + NO_COARSENING_CALL.source,
  'i',
);
const GUARDED_COARSENING_CALL_GLOBAL = new RegExp(GUARDED_COARSENING_CALL.source, 'gi');

/**
 * Complexity counts that put a region on the union path rather than the
 * single-division fast path: one member and three children. Under 300,000
 * points, so the input-side timeout guard stays off and the region is pinned to
 * take no tolerance at all.
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
 * *replaces* the geometry the rest of the pipeline works on — all three writers
 * assign it back over `collectedGeom` — so it is upstream of the column by the
 * same argument as the union.
 *
 * The collect step is the one statement `NO_COARSENING_CALL` is not applied to
 * whole, because it carries a simplification legitimately: the input-side
 * timeout guard, under a `CASE WHEN $2`. Its exemption is exactly that wide and
 * no wider — see `unconditionalCoarseningCalls`, which is what holds it, since
 * the bound parameter alone says nothing about the statement's text.
 */
function unionStatements(calls: Array<[unknown, unknown[]?]>) {
  const find = (needle: string) => calls.find((c) => String(c[0]).includes(needle));
  const write = calls.find(
    (c) => String(c[0]).includes('UPDATE regions')
      && String(c[0]).includes('SET geom = validate_multipolygon($2)'),
  );
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
    /** The collect step, held by `unconditionalCoarseningCalls` rather than whole. */
    collectSql: String(collect?.[0] ?? ''),
    /** The geometry the write actually received. */
    written: write?.[1]?.[1],
    /** The `shouldSimplify` parameter the collect step was bound to. */
    simplifyInputs: collect?.[1]?.[1],
  };
}

/**
 * How many coarsening calls the collect statement makes that are *not* the
 * input-side timeout guard — which must be none.
 *
 * Asserting the bound parameter is `false` is not enough on its own, and this
 * is the gap it leaves: a tolerance written into the `ELSE` arm, or anywhere
 * else in the statement, is applied unconditionally, reaches the union, and is
 * stored — while `simplifyInputs` stays `false` and all four output-side
 * statements stay clean. With those four closed, the `ELSE` arm is the most
 * camouflaged place a tolerance could come back to, since a `0.0001` sitting
 * beside the legitimate `0.005` reads as belonging there.
 *
 * So the exemption is written as what it actually is: the statement's *only*
 * coarsening calls are the ones under `CASE WHEN $2`.
 */
function unconditionalCoarseningCalls(collectSql: string): number {
  const guarded = collectSql.match(GUARDED_COARSENING_CALL_GLOBAL) ?? [];
  const all = collectSql.match(COARSENING_CALL_GLOBAL) ?? [];
  return all.length - guarded.length;
}

/**
 * Every check the three union writers' guards make, in one place.
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

  // The collect step's narrower rule, and the anti-vacuity check under it: a
  // bare count comparison passes when neither pattern matches anything.
  if (!GUARDED_COARSENING_CALL.test(s.collectSql)) {
    problems.push('collect: no conditional input-side guard found');
  }
  if (unconditionalCoarseningCalls(s.collectSql) !== 0) {
    problems.push('collect: a coarsening call outside CASE WHEN $2');
  }

  if (s.written !== expected) problems.push('write: did not receive the cleaning step output');
  if (s.simplifyInputs !== false) problems.push('collect: input-side guard on below 300,000 points');
  return problems;
}
