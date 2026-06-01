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
    const query = vi.fn(async (sql: string) => {
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
    // The reused parent must NOT get a duplicate import-state row; only the fresh child does.
    expect(sqls.filter((s) => s.includes('region_import_state')).length).toBe(1);
    // Only the fresh child is counted, not the reused parent.
    expect(progress.createdRegions).toBe(1);
    // The child INSERT still ran (subtree merged under the reused region).
    expect(sqls.filter((s) => s.includes('INSERT INTO regions')).length).toBe(2);
  });
});
