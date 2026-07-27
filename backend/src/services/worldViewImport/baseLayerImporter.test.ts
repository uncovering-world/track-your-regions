import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { buildBaseLayerTree } from './baseLayerImporter.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('buildBaseLayerTree', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('builds a hierarchy from parent_id', async () => {
    mockedQuery.mockResolvedValue({
      rows: [
        { id: 1, name: 'Europe', parent_id: null, depth: 0 },
        { id: 2, name: 'Germany', parent_id: 1, depth: 1 },
        { id: 3, name: 'Bavaria', parent_id: 2, depth: 2 },
      ],
    });

    const tree = await buildBaseLayerTree({ maxDepth: 2 });

    expect(tree.name).toBe('World');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe('Europe');
    expect(tree.children[0].children[0].name).toBe('Germany');
    expect(tree.children[0].children[0].children[0].name).toBe('Bavaria');
  });

  it('emits nothing but names and children, so the matcher has to do the work', async () => {
    // The tree is generated FROM the divisions, so it would be trivial to tag
    // each node with the division it came from. That is exactly what must not
    // happen: resolving a name to a division is the matcher's job, and a tree
    // that carried the answer would skip the stage this import exists to test.
    mockedQuery.mockResolvedValue({
      rows: [
        { id: 1, name: 'Europe', parent_id: null, depth: 0 },
        { id: 2, name: 'Germany', parent_id: 1, depth: 1 },
      ],
    });

    const tree = await buildBaseLayerTree({ maxDepth: 1 });

    expect(Object.keys(tree.children[0]).sort()).toEqual(['children', 'name']);
    expect(Object.keys(tree.children[0].children[0]).sort()).toEqual(['children', 'name']);
    expect(JSON.stringify(tree)).not.toMatch(/divisionId|externalId|sourceId/i);
  });

  it('passes the depth limit to the recursive query', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });

    await buildBaseLayerTree({ maxDepth: 2 });

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WITH RECURSIVE/);
    expect(sql).toMatch(/administrative_divisions/);
    expect(sql).toMatch(/t\.depth < \$1/);
    expect(params).toEqual([2]);
  });

  it('refuses to silently drop a node whose parent is missing', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ id: 9, name: 'Orphan', parent_id: 404, depth: 1 }],
    });

    await expect(buildBaseLayerTree({ maxDepth: 2 })).rejects.toThrow(/parent 404/);
  });
});
