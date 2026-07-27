import { describe, it, expect, vi, beforeEach } from 'vitest';

// Deliberately does NOT mock '../../services/worldViewImport/index.js' — the
// bug this guards against lives in the interaction between that module's
// startBaseLayerImport/getLatestImportStatus and this controller's
// check-then-act, so the test needs the real thing. Only the slow leaves
// (tree build, DB) are mocked, same as index.test.ts.
vi.mock('../../services/worldViewImport/baseLayerImporter.js', () => ({
  buildBaseLayerTree: vi.fn().mockResolvedValue({
    name: 'World',
    children: [{ name: 'Europe', children: [] }],
  }),
}));
vi.mock('../../services/worldViewImport/importer.js', () => ({
  importTree: vi.fn().mockResolvedValue(77),
}));
vi.mock('../../services/worldViewImport/matcher.js', () => ({
  matchCountryLevel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { startBaseLayerImportEndpoint } from './baseLayerImportController.js';
import { importTree } from '../../services/worldViewImport/importer.js';

const mockedImport = importTree as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

function makeReq(name: string) {
  return { body: { name, providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never;
}

describe('startBaseLayerImportEndpoint — concurrent starts (regression)', () => {
  beforeEach(() => {
    mockedImport.mockClear();
  });

  it('does not let a second request start while the first is still building its tree', async () => {
    const res1 = makeRes();
    const res2 = makeRes();

    // Not awaited between the two calls — this is what two nearly
    // simultaneous HTTP requests look like: the second is dispatched before
    // the first has resolved anything, including its tree build. Without the
    // fix, startBaseLayerImport doesn't register anything in runningImports
    // until after that tree build resolves, so this second call's
    // getLatestImportStatus() check sees nothing running and also proceeds —
    // two imports, one stray world view.
    const p1 = startBaseLayerImportEndpoint(makeReq('First'), res1 as never);
    const p2 = startBaseLayerImportEndpoint(makeReq('Second'), res2 as never);
    await Promise.all([p1, p2]);

    const rejected = [res1, res2].filter(
      (r) => (r.status as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    );
    const started = [res1, res2].filter(
      (r) => (r.status as ReturnType<typeof vi.fn>).mock.calls.length === 0,
    );

    expect(started).toHaveLength(1);
    expect(started[0].json).toHaveBeenCalledWith(expect.objectContaining({ started: true }));

    expect(rejected).toHaveLength(1);
    expect(rejected[0].status).toHaveBeenCalledWith(409);
    expect(rejected[0].json).toHaveBeenCalledWith({ error: 'An import is already running' });

    // And only one import pipeline actually ran, not two.
    await vi.waitFor(() => expect(mockedImport).toHaveBeenCalledTimes(1));
  });
});
