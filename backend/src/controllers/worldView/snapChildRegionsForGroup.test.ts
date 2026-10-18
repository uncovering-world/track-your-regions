/**
 * What the snap step keeps in the database and what it answers (#459).
 *
 * The statement returns a row per child, because the log line names each one
 * and how many vertices it gained. The snapped geometry is not in the answer
 * at all: it replaces the union's input in the region's `union_work` row,
 * since a continent's union handed back to Node is text past V8's longest
 * string, and the driver dies parsing it where nothing can catch it
 * (`unionWork.ts`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

import { snapChildRegionsForGroup } from './snapChildRegionsForGroup.js';

/** A child row as the statement returns one. */
function childRow(name: string) {
  return {
    id: 7, name, neighbor_count: '2',
    original_points: '100', new_points: '104', added_points: '4',
    total_snapped_points: '720', kept: '1',
  };
}

const query = vi.fn();
const client = { query } as unknown as PoolClient;
const flat = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the snap step', () => {
  beforeEach(() => query.mockReset());

  it("returns no geometry to Node, and writes the snapped input back into the region's row", async () => {
    query.mockResolvedValue({ rows: [childRow('Canillo')] });

    await snapChildRegionsForGroup(client, 42);

    const sql = flat(query.mock.calls[0][0] as string);
    expect(sql).not.toContain('collected_geom');
    expect(sql).toContain('UPDATE union_work SET collected = (SELECT geom FROM collected) WHERE region_id = $1 AND EXISTS (SELECT 1 FROM with_new_points)');
    expect(query.mock.calls[0][1]).toEqual([42]);
  });

  it('collects the members it reads from the row back in with the snapped children (#736)', async () => {
    query.mockResolvedValue({ rows: [childRow('Canillo')] });

    await snapChildRegionsForGroup(client, 42);

    const sql = flat(query.mock.calls[0][0] as string);
    expect(sql).toContain('members AS ( SELECT members AS geom FROM union_work WHERE region_id = $1 )');
    expect(sql).toContain('SELECT geom FROM with_new_points UNION ALL SELECT geom FROM members');
  });

  it('answers the counts its log line and its caller read', async () => {
    query.mockResolvedValue({ rows: [childRow('Andorra la Vella'), childRow('Canillo'), childRow('Encamp')] });

    const snap = await snapChildRegionsForGroup(client, 42);

    expect(snap).toEqual({ totalAdded: 12, snappedPoints: 720, rowCount: 3 });
  });

  it('answers nothing snapped for a region none of whose children has geometry', async () => {
    query.mockResolvedValue({ rows: [] });

    expect(await snapChildRegionsForGroup(client, 42)).toEqual({ totalAdded: 0, snappedPoints: 0, rowCount: 0 });
  });
});
