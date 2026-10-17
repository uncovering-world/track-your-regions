import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() } }));
let release!: () => void;
vi.mock('./importer.js', () => ({
  // Held while creating the regions, so the cancel lands on a running import.
  importTree: vi.fn(() => new Promise<number>((resolve) => { release = () => resolve(30); })),
}));

const { startImport, cancelImport, getLatestImportStatus } = await import('./index.js');

describe('cancelImport (#1356)', () => {
  it('says on the progress that the press was taken, before the run stops', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const opId = startImport({ name: 'World', children: [] } as never, 'Spatial pass measurement');

    expect(cancelImport(opId)).toBe(true);
    expect(getLatestImportStatus()?.progress.operation?.progress.cancelling).toBe(true);
    release();
  });
});
