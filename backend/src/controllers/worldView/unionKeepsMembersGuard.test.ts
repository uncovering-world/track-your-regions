/**
 * The guard's own blind spots, asked of it directly.
 *
 * The three writers' tests hold it against the real statements, which answers
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

const MEMBERS = { sentinel: 'members-only' };
const SNAPPED = { sentinel: 'snapped-children-and-members' };

/** The `collected` CTE as the shipped snap statement writes it. */
const KEEPS_MEMBERS = `
    collected AS (
      SELECT ST_Collect(geom) as geom
      FROM (
        SELECT geom FROM with_new_points
        UNION ALL
        SELECT $2::geometry
      ) union_inputs
      WHERE geom IS NOT NULL
    ),`;

/** A snap statement carrying the given `collected` CTE, and nothing else that matters. */
function snapWith(collectedCte: string): string {
  return `
    WITH child_regions AS (
      SELECT id, geom FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL
    ),
    snapped AS (
      SELECT ST_MakeValid(ST_Snap(w.geom, w.neighbor_geom, 0.001)) as geom FROM with_neighbors w
    ),
    with_new_points AS (
      SELECT *, ST_NPoints(geom) as new_points FROM snapped
    ),${collectedCte}
    totals AS (
      SELECT SUM(new_points) + COALESCE(ST_NPoints($2::geometry), 0) as total_points
      FROM with_new_points
    )
    SELECT (SELECT geom FROM collected) as collected_geom FROM with_new_points`;
}

/** The calls a writer makes, with the snap's collected CTE swapped for a mutation. */
function callsWith(collectedCte: string): Array<[unknown, unknown[]?]> {
  return [
    ['WITH direct_member_geoms AS (...) SELECT ST_Collect(geom)', [42, false]],
    [snapWith(collectedCte), [42, MEMBERS]],
    ['SELECT ST_UnaryUnion($1::geometry) as union_geom', [SNAPPED]],
  ];
}

const expected = { memberGeom: MEMBERS, snappedGeom: SNAPPED };

describe('the guard notices when the members stop reaching the union', () => {
  it('passes the statement the pipeline actually sends', () => {
    // Anti-vacuity: every mutation below is a change to a shape that passes.
    expect(droppedMemberProblems(callsWith(KEEPS_MEMBERS), expected)).toEqual([]);
  });

  it('reports a collected CTE that reads the members only for a sibling column', () => {
    // The mutation the review named: `$2` is in the CTE, and in the CTE the
    // geometry comes from -- but not in the geometry. A count beside the
    // collect reads exactly like the log line the last narrowing was about.
    const problems = droppedMemberProblems(callsWith(`
    collected AS (
      SELECT ST_Collect(geom) as geom, ST_NPoints($2::geometry) as member_points
      FROM with_new_points
      WHERE geom IS NOT NULL
    ),`), expected);

    expect(problems).toContain(
      'snap: collects the children alone, without the members it was given',
    );
  });

  it('reports a collected CTE with no mention of the members at all', () => {
    const problems = droppedMemberProblems(callsWith(`
    collected AS (
      SELECT ST_Collect(geom) as geom FROM with_new_points WHERE geom IS NOT NULL
    ),`), expected);

    expect(problems).toContain(
      'snap: collects the children alone, without the members it was given',
    );
  });

  it('reports a collected CTE that returns no geometry column to read', () => {
    // Not the same failure and worth telling apart: a CTE renamed out from
    // under the guard would otherwise read as one that dropped the members.
    const problems = droppedMemberProblems(callsWith(`
    collected AS (
      SELECT ST_Collect(shape) as outline FROM with_new_points
    ),`), expected);

    expect(problems).toContain('snap: its collected CTE returns no geom column');
  });

  it('reports a snap that was never given the members', () => {
    const calls = callsWith(KEEPS_MEMBERS);
    calls[1] = [snapWith(KEEPS_MEMBERS), [42, null]];

    expect(droppedMemberProblems(calls, expected)).toContain(
      'snap: was not given the members the collect step gathered',
    );
  });

  it('reports a union handed something other than what the snap produced', () => {
    const calls = callsWith(KEEPS_MEMBERS);
    calls[2] = ['SELECT ST_UnaryUnion($1::geometry) as union_geom', [{ sentinel: 'children-only' }]];

    expect(droppedMemberProblems(calls, expected)).toContain(
      'union: did not receive the snap step output',
    );
  });

  it('names the statement it could not find rather than passing without it', () => {
    const withoutSnap = callsWith(KEEPS_MEMBERS).filter((c) => !String(c[0]).includes('ST_Snap('));

    expect(droppedMemberProblems(withoutSnap, expected)).toContain(
      'snap: statement not found (no ST_Snap()',
    );
  });
});
