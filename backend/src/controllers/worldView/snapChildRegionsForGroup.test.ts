/**
 * What the snap step hands back, and what it costs to hand back.
 *
 * The statement returns a row per child, because the log line names each one
 * and how many vertices it gained. The collected geometry is not per child: it
 * is the statement's single payload, and a scalar subquery repeated in the
 * select list lands in **every** DataRow the driver buffers even though
 * Postgres computes it once. The regions worth snapping are the ones with the
 * most children — 153 under New South Wales, 28 under North America — so the
 * verbose shape sends a continent's union across the wire once per child.
 *
 * The three writers unified on this statement, and the bulk one — the writer
 * that walks every region of a world view — previously used an aggregate that
 * returned exactly one row. Nothing about the geometry it stores would change
 * if the payload went back to being repeated, which is why the shape is pinned
 * here rather than left to be noticed on a continent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

import { snapChildRegionsForGroup } from './snapChildRegionsForGroup.js';

const MEMBERS = { sentinel: 'members-only' };
const SNAPPED = { sentinel: 'snapped-children-and-members' };
const COLLECTED = { sentinel: 'collect-step-output' };

/** A child row as the statement returns one, carrying the payload or not. */
function childRow(name: string, collectedGeom: unknown) {
  return {
    id: 7, name, neighbor_count: '2',
    original_points: '100', new_points: '104', added_points: '4',
    collected_geom: collectedGeom, total_snapped_points: '720',
  };
}

const query = vi.fn();
const client = { query } as unknown as PoolClient;

describe('the snap step', () => {
  beforeEach(() => query.mockReset());

  it('emits the collected geometry on one row, not on every child', async () => {
    // The break this catches is invisible in the stored geometry and shows up
    // only as bytes: dropping the ROW_NUMBER gate puts the whole union in
    // every row again. Read off the statement, since a mocked driver cannot
    // tell how large a real answer would have been.
    query.mockResolvedValue({ rows: [childRow('Canillo', SNAPPED)] });

    await snapChildRegionsForGroup(client, 42, COLLECTED, MEMBERS);

    const [sql] = query.mock.calls[0] as [string];
    const alias = sql.indexOf('as collected_geom');
    const payloadColumn = alias < 0 ? '' : sql.slice(sql.lastIndexOf(',', alias) + 1, alias);
    expect(payloadColumn).toContain('ROW_NUMBER()');
  });

  it('takes the geometry from whichever row carries it', async () => {
    // The window that picks the carrying row and the ORDER BY that returns the
    // rows are two orderings; reading row zero would be right only while no
    // two children of one region share a name.
    query.mockResolvedValue({
      rows: [childRow('Andorra la Vella', null), childRow('Canillo', SNAPPED), childRow('Encamp', null)],
    });

    const snap = await snapChildRegionsForGroup(client, 42, COLLECTED, MEMBERS);

    expect(snap.collectedGeom).toBe(SNAPPED);
    expect(snap.snappedPoints).toBe(720);
    expect(snap.totalAdded).toBe(12);
  });

  it('hands back the geometry it was given when no child has one to snap', async () => {
    query.mockResolvedValue({ rows: [] });

    const snap = await snapChildRegionsForGroup(client, 42, COLLECTED, MEMBERS);

    expect(snap.collectedGeom).toBe(COLLECTED);
    expect(snap.rowCount).toBe(0);
  });

  it('asks the statement for the region and the members it must keep', async () => {
    query.mockResolvedValue({ rows: [childRow('Canillo', SNAPPED)] });

    await snapChildRegionsForGroup(client, 42, COLLECTED, MEMBERS);

    expect(query.mock.calls[0][1]).toEqual([42, MEMBERS]);
  });
});
