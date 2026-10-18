/**
 * The guard's own blind spots, asked of it directly.
 *
 * The writers' tests hold it against the real statements, which answers
 * "does the pipeline keep the members" but not "would this guard notice if it
 * stopped". The distinction has already cost two narrowings: from the statement
 * to the `collected` CTE, after a snap that counted the members' points in a
 * sibling CTE walked through; and from that CTE to the expression that produces
 * its geometry, after the same shape turned out to fit inside one CTE.
 *
 * So the mutations live here, on statements written to be wrong in one named
 * way each. A statement is fed to the guard as a mocked client's call, which is
 * the shape the writers hand it.
 */

import { describe, it, expect } from 'vitest';
import { droppedMemberProblems } from './unionKeepsMembersGuard.js';

/** The `collected` CTE as the shipped snap statement writes it. */
const KEEPS_MEMBERS = `
    collected AS (
      SELECT ST_Collect(geom) as geom
      FROM (
        SELECT geom FROM with_new_points
        UNION ALL
        SELECT geom FROM members
      ) union_inputs
      WHERE geom IS NOT NULL
    ),`;

const READS_MEMBERS = `
    members AS (
      SELECT members AS geom FROM union_work WHERE region_id = $1
    ),`;

const WRITES_BACK = `
    kept AS (
      UPDATE union_work SET collected = (SELECT geom FROM collected)
       WHERE region_id = $1 AND EXISTS (SELECT 1 FROM with_new_points)
      RETURNING 1
    )`;

/** A snap statement carrying the given CTEs, and nothing else that matters. */
function snapWith(collectedCte: string, membersCte = READS_MEMBERS, keptCte = WRITES_BACK): string {
  return `
    WITH child_regions AS (
      SELECT id, geom FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL
    ),
    snapped AS (
      SELECT ST_MakeValid(ST_Snap(w.geom, w.neighbor_geom, 0.001)) as geom FROM with_neighbors w
    ),
    with_new_points AS (
      SELECT *, ST_NPoints(geom) as new_points FROM snapped
    ),${membersCte}${collectedCte}
    totals AS (
      SELECT SUM(new_points) + COALESCE((SELECT ST_NPoints(geom) FROM members), 0) as total_points
      FROM with_new_points
    ),${keptCte}
    SELECT (SELECT COUNT(*) FROM kept) as kept FROM with_new_points`;
}

const COLLECT = `WITH direct_member_geoms AS (...), child_group_geoms AS (...)
  INSERT INTO union_work (region_id, collected, members, geom_count)
  SELECT $1, ST_Collect(geom), ST_Collect(geom) FILTER (WHERE is_member), COUNT(*) FROM all_geoms`;

const UNION = 'UPDATE union_work SET collected = ST_UnaryUnion(ST_MakeValid(collected)) WHERE region_id = $1';

/** The calls a writer makes, with the snap's statement swapped for a mutation. */
function callsWith(snapSql: string): Array<[unknown, unknown[]?]> {
  return [
    [COLLECT, [42]],
    [snapSql, [42]],
    [UNION, [42]],
  ];
}

describe('the guard notices when the members stop reaching the union', () => {
  it('passes the statements the pipeline actually sends', () => {
    // Anti-vacuity: every mutation below is a change to a shape that passes.
    expect(droppedMemberProblems(callsWith(snapWith(KEEPS_MEMBERS)))).toEqual([]);
  });

  it('reports a collected CTE that reads the members only for a sibling column', () => {
    // The mutation this exists to catch: the members are in the CTE, and in
    // the CTE the geometry comes from -- but not in the geometry. A count
    // beside the collect reads exactly like the log line an earlier narrowing
    // was about.
    const problems = droppedMemberProblems(callsWith(snapWith(`
    collected AS (
      SELECT ST_Collect(geom) as geom, (SELECT ST_NPoints(geom) FROM members) as member_points
      FROM with_new_points
      WHERE geom IS NOT NULL
    ),`)));

    expect(problems).toContain(
      'snap: collects the children alone, without the members the collect step kept',
    );
  });

  it('reports a collected CTE with no mention of the members at all', () => {
    const problems = droppedMemberProblems(callsWith(snapWith(`
    collected AS (
      SELECT ST_Collect(geom) as geom FROM with_new_points WHERE geom IS NOT NULL
    ),`)));

    expect(problems).toContain(
      'snap: collects the children alone, without the members the collect step kept',
    );
  });

  it('reports a collected CTE that returns no geometry column to read', () => {
    // Not the same failure and worth telling apart: a CTE renamed out from
    // under the guard would otherwise read as one that dropped the members.
    const problems = droppedMemberProblems(callsWith(snapWith(`
    collected AS (
      SELECT ST_Collect(shape) as outline FROM with_new_points
    ),`)));

    expect(problems).toContain('snap: its collected CTE returns no geom column');
  });

  it('reports a snap whose members come from somewhere other than the collect step', () => {
    const problems = droppedMemberProblems(callsWith(snapWith(KEEPS_MEMBERS, `
    members AS (
      SELECT ST_Collect(d.geom) AS geom FROM region_members rm JOIN administrative_divisions d ON d.id = rm.division_id
    ),`)));

    expect(problems).toContain('snap: does not read the members the collect step kept');
  });

  it('reports a collect step that keeps no members apart', () => {
    const calls = callsWith(snapWith(KEEPS_MEMBERS));
    calls[0] = [COLLECT.replace(' FILTER (WHERE is_member)', ''), [42]];

    expect(droppedMemberProblems(calls)).toContain('collect: keeps no members apart for the snap');
  });

  it('reports a snap that computes its result and never writes it back', () => {
    const problems = droppedMemberProblems(callsWith(snapWith(KEEPS_MEMBERS, READS_MEMBERS, `
    kept AS (
      SELECT 1
    )`)));

    expect(problems).toContain('snap: does not write its result back into the union_work row');
  });

  it('reports a union that does not read the row the snap rewrote', () => {
    const calls = callsWith(snapWith(KEEPS_MEMBERS));
    calls[2] = ['SELECT ST_UnaryUnion($1::geometry) as union_geom', [42]];

    expect(droppedMemberProblems(calls)).toContain(
      'union: does not read the union_work row the snap rewrote',
    );
  });

  it('names the statement it could not find rather than passing without it', () => {
    const withoutSnap = callsWith(snapWith(KEEPS_MEMBERS)).filter((c) => !String(c[0]).includes('ST_Snap('));

    expect(droppedMemberProblems(withoutSnap)).toContain(
      'snap: statement not found (no ST_Snap()',
    );
  });
});
