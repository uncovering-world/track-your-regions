/**
 * One definition of the second rule the three union writers of `regions.geom`
 * are held to, shared by their guards: **the union sees every input the collect
 * step gathered.**
 *
 * The collect step deliberately gathers two kinds of shape — the region's own
 * `direct_member_geoms` and its `child_group_geoms` — and the complexity gate
 * sums both. The neighbour snap that may run between the collect and the union
 * reads the children alone, and its result is assigned back over the collected
 * geometry, so on a region that has direct members as well their territory
 * never reached the union (#736). Measured on the dev database when it was
 * found: Andorra stored 439.3 km² of its member division's 451.1, and North
 * America's member held 9,843,418 km² — Canada — that no child of it held,
 * because Canada's own region row had no geometry yet.
 *
 * Snapping aligns the children's shared borders; it does not decide which
 * inputs the union is made of. So the members are carried into the snap and
 * collected back out with the snapped children, rather than the snap being
 * given a say over them.
 *
 * The rule lives here rather than once per guard for the reason
 * `unionGeomToleranceGuard.ts` gives one file over: this defect existed in
 * three copies of the same statement, and three copies of a check are two that
 * get widened and one that silently does not.
 */

/**
 * The body of one named CTE, read by matching parentheses from its opening one.
 *
 * Asking whether the *statement* mentions the member parameter is not the same
 * question and was proven not to be: a snap that bound the members, counted
 * their points in its `totals` CTE for the log line, and collected the children
 * alone satisfied that check while dropping exactly the territory this guard
 * exists for. The question is which CTE reads it, so the answer has to be read
 * from that CTE.
 */
function cteBody(sql: string, name: string): string {
  // Searched for as a literal, on the statement with its whitespace collapsed,
  // rather than by a pattern built around the name: a RegExp assembled from an
  // argument is the ReDoS shape Semgrep blocks, and there is nothing here a
  // pattern would buy. A CTE the statement spells some other way reads as
  // absent, which this guard reports rather than passes over.
  const flat = sql.replace(/\s+/g, ' ');
  const opening = `${name} AS (`;
  const at = flat.toLowerCase().indexOf(opening.toLowerCase());
  if (at < 0) return '';
  let depth = 1;
  const from = at + opening.length;
  for (let i = from; i < flat.length; i++) {
    if (flat[i] === '(') depth++;
    else if (flat[i] === ')' && --depth === 0) return flat.slice(from, i);
  }
  return '';
}

/**
 * The part of a CTE that produces the geometry it returns: its `geom` column
 * and the rows that column is computed over, with every other selected column
 * dropped.
 *
 * Asking whether the CTE mentions the parameter is not the same question
 * either, and this is the second time that distinction has mattered. The first
 * narrowing was from the statement to this CTE, after a snap that counted the
 * members' points in a sibling CTE walked through. The same shape fits inside
 * one CTE: `SELECT ST_Collect(geom) as geom, ST_NPoints($2) as member_pts FROM
 * with_new_points` reads the parameter and collects the children alone. So what
 * is asked is whether the members reach the geometry, and the columns that are
 * not the geometry are taken out of the question first.
 */
function geometryProducingPart(cte: string, column: string): string {
  const lower = cte.toLowerCase();
  const selectAt = lower.indexOf('select ');
  if (selectAt < 0) return '';

  // The FROM that belongs to this SELECT, not one inside a subquery.
  const listFrom = selectAt + 'select '.length;
  let depth = 0;
  let listEnd = cte.length;
  for (let i = listFrom; i < cte.length; i++) {
    if (cte[i] === '(') depth++;
    else if (cte[i] === ')') depth--;
    else if (depth === 0 && lower.startsWith(' from ', i - 1)) { listEnd = i - 1; break; }
  }

  // Top-level commas separate the selected columns; the geometry is the one
  // aliased to the column the caller reads back.
  const columns: string[] = [];
  let start = listFrom;
  depth = 0;
  for (let i = listFrom; i <= listEnd; i++) {
    if (i === listEnd || (depth === 0 && cte[i] === ',')) {
      columns.push(cte.slice(start, i));
      start = i + 1;
    } else if (cte[i] === '(') depth++;
    else if (cte[i] === ')') depth--;
  }
  const geometry = columns.filter(c => c.toLowerCase().includes(`as ${column.toLowerCase()}`));
  if (geometry.length === 0) return '';

  return geometry.join(' ') + cte.slice(listEnd);
}

/**
 * The statements of a snapping run whose chain carries the collected geometry
 * to the union, picked out of a mocked client's calls by what each statement
 * *is* rather than by the order it was issued in.
 */
function chainStatements(calls: Array<[unknown, unknown[]?]>) {
  const find = (needle: string) => calls.find((c) => String(c[0]).includes(needle));
  const snap = find('ST_Snap(');
  const union = find('ST_UnaryUnion');
  return {
    collectSql: String(find('direct_member_geoms')?.[0] ?? ''),
    snapSql: String(snap?.[0] ?? ''),
    /** What the snap statement was bound to, after the region id. */
    snapParams: snap?.[1] ?? [],
    unionSql: String(union?.[0] ?? ''),
    /** The geometry the union actually received. */
    unioned: union?.[1]?.[0],
  };
}

/**
 * Every check the three union writers' guards make on a run that snaps, in one
 * place. Returns the problems rather than asserting them, so the rule stays in
 * `src/` without pulling a test framework in with it.
 *
 * `memberGeom` is the members-only geometry the collect step was mocked to
 * return, and `snappedGeom` the snap step's own output: distinct sentinels, so
 * a writer that carries the wrong one forward is told apart from one that
 * carries the right one.
 */
export function droppedMemberProblems(
  calls: Array<[unknown, unknown[]?]>,
  expected: { memberGeom: unknown; snappedGeom: unknown },
): string[] {
  const s = chainStatements(calls);
  const problems: string[] = [];

  // Each statement is identified before it is judged, so a check cannot pass
  // because the statement it is about was never issued.
  if (!s.collectSql.includes('direct_member_geoms')) {
    problems.push('collect: statement not found (no direct_member_geoms)');
  }
  if (!s.snapSql.includes('ST_Snap(')) {
    problems.push('snap: statement not found (no ST_Snap()');
  }
  if (!s.unionSql.includes('ST_UnaryUnion')) {
    problems.push('union: statement not found (no ST_UnaryUnion)');
  }
  if (problems.length > 0) return problems;

  // The members reach the snap, and the CTE whose geometry the snap hands back
  // is the one that reads them. Binding alone is not enough, and neither is the
  // statement mentioning the parameter somewhere: a snap that counts the
  // members' points for its log line and collects the children alone passes
  // both of those while dropping the territory.
  if (s.snapParams[1] !== expected.memberGeom) {
    problems.push('snap: was not given the members the collect step gathered');
  }
  const collectedCte = cteBody(s.snapSql, 'collected');
  const producesGeometry = geometryProducingPart(collectedCte, 'geom');
  if (!collectedCte) {
    problems.push('snap: has no collected CTE to hand a geometry back from');
  } else if (!producesGeometry) {
    problems.push('snap: its collected CTE returns no geom column');
  } else if (!producesGeometry.includes('$2')) {
    problems.push('snap: collects the children alone, without the members it was given');
  }

  // And what the snap hands back is what the union reads, so the members
  // cannot be collected into a geometry the writer then drops on the floor.
  if (s.unioned !== expected.snappedGeom) {
    problems.push('union: did not receive the snap step output');
  }
  return problems;
}
