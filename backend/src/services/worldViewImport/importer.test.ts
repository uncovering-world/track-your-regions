import { describe, it, expect, vi } from 'vitest';
import { insertRegion } from './importer.js';
import type { ImportProgress, ImportTreeNode } from './types.js';

/** Minimal ImportProgress for exercising insertRegion in isolation. */
function makeProgress(): ImportProgress {
  return { createdRegions: 0, totalRegions: 0, cancel: false } as unknown as ImportProgress;
}

describe('insertRegion duplicate-sibling resilience', () => {
  it('uses ON CONFLICT find-or-reuse and records import state for fresh regions', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('INSERT INTO regions')
        ? { rows: [{ id: 10, inserted: true }] }
        : { rows: [] },
    );
    const progress = makeProgress();
    const tree: ImportTreeNode = { name: 'A', children: [{ name: 'B', children: [] }] };

    await insertRegion({ query } as never, tree, 1, null, 99, progress);

    const sqls = query.mock.calls.map((c) => String(c[0]));
    // The region INSERT must be a find-or-reuse against the partial unique index.
    expect(
      sqls.some(
        (s) =>
          s.includes('INSERT INTO regions') &&
          s.includes('ON CONFLICT') &&
          s.includes('parent_region_id IS NOT NULL'),
      ),
    ).toBe(true);
    // Fresh regions get an import-state row and are counted.
    expect(sqls.filter((s) => s.includes('region_import_state')).length).toBe(2);
    expect(progress.createdRegions).toBe(2);
  });

  it('reuses a duplicate sibling without re-inserting import state, still merging its subtree', async () => {
    let firstRegionInsert = true;
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('INSERT INTO regions')) {
        if (firstRegionInsert) {
          firstRegionInsert = false;
          return { rows: [{ id: 10, inserted: false }] }; // duplicate sibling → reused
        }
        return { rows: [{ id: 11, inserted: true }] }; // its child → fresh
      }
      return { rows: [] };
    });
    const progress = makeProgress();
    const tree: ImportTreeNode = {
      name: 'Eastern Andino',
      children: [{ name: 'Child', children: [] }],
    };

    await insertRegion({ query } as never, tree, 2, 3120, 99, progress);

    const sqls = query.mock.calls.map((c) => String(c[0]));
    // The reused parent must NOT get a duplicate import-state INSERT; only the fresh child does.
    expect(sqls.filter((s) => s.includes('INSERT INTO region_import_state')).length).toBe(1);
    // But its warnings are merged into the existing row (it's a grouping node) via UPDATE.
    const mergeCall = query.mock.calls.find(
      (c) => String(c[0]).includes('UPDATE region_import_state') && String(c[0]).includes('hierarchy_warnings'),
    );
    expect(mergeCall).toBeDefined();
    expect((mergeCall![1] as unknown[])[0]).toBe(10); // the reused parent's region id
    expect((mergeCall![1] as unknown[])[1]).toContain('Grouping: no source page (parsed from item list)');
    // Only the fresh child is counted, not the reused parent.
    expect(progress.createdRegions).toBe(1);
    // The child INSERT still ran (subtree merged under the reused region).
    expect(sqls.filter((s) => s.includes('INSERT INTO regions')).length).toBe(2);
  });
});

describe('insertRegion hierarchy warnings', () => {
  /** Run insertRegion and return the hierarchy_warnings param for each region_import_state insert, keyed by region id. */
  async function warningsByRegion(tree: ImportTreeNode): Promise<Map<number, string[]>> {
    let nextId = 10;
    const query = vi.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('INSERT INTO regions')
        ? { rows: [{ id: nextId++, inserted: true }] }
        : { rows: [] },
    );
    await insertRegion({ query } as never, tree, 1, null, 99, makeProgress());

    const map = new Map<number, string[]>();
    for (const [sql, params] of query.mock.calls) {
      if (String(sql).includes('INSERT INTO region_import_state')) {
        const p = params as unknown[];
        map.set(p[0] as number, p[5] as string[]);
      }
    }
    return map;
  }

  it('flags grouping nodes (no source page, has children) with a hierarchy warning', async () => {
    // Parent has no sourceUrl but has a child → grouping node; the leaf child is not.
    const warnings = await warningsByRegion({ name: 'Grouping', children: [{ name: 'Leaf', children: [] }] });
    expect(warnings.get(10)).toContain('Grouping: no source page (parsed from item list)');
    expect(warnings.get(11)).toEqual([]);
  });

  it('does not flag nodes that have a source URL', async () => {
    const warnings = await warningsByRegion({
      name: 'HasPage',
      sourceUrl: 'https://en.wikivoyage.org/wiki/HasPage',
      children: [{ name: 'Leaf', children: [] }],
    });
    expect(warnings.get(10)).toEqual([]);
  });

  it('preserves extractor-supplied node warnings', async () => {
    const warnings = await warningsByRegion({
      name: 'Sourced',
      sourceUrl: 'https://en.wikivoyage.org/wiki/Sourced',
      warnings: ['Extractor flagged something'],
      children: [],
    });
    expect(warnings.get(10)).toEqual(['Extractor flagged something']);
  });
});
