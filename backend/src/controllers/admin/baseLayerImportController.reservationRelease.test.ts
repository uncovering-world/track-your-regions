import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for a Critical finding: startBaseLayerImport reserves its
// slot synchronously *before* awaiting buildBaseLayerTree — correct, that is
// what closes the race baseLayerImportController.concurrency.test.ts guards.
// But that await sat outside any try/catch. buildBaseLayerTree can reject
// (its own orphaned-parent invariant, the statement timeout a depth-3
// recursive CTE over hundreds of thousands of divisions can plausibly hit,
// any pool error) — and when it does, the reservation must not survive.
// Left behind, it sits in the service's in-memory map forever with status
// 'importing', so getLatestImportStatus() keeps reporting that phantom
// entry and the 409 guard in both startBaseLayerImportEndpoint and
// startWorldViewImport rejects every later import — base layer, Wikivoyage,
// and file uploads alike — until the process restarts.
//
// Deliberately does NOT mock '../../services/worldViewImport/index.js' —
// same reasoning as the concurrency test: the bug lives in the real
// interaction between the service's reservation bookkeeping and the
// controller's check-then-act guard. Only the slow leaves (tree build,
// import pipeline, DB) are mocked.
vi.mock('../../services/worldViewImport/baseLayerImporter.js', () => ({
  buildBaseLayerTree: vi.fn(),
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
import { startBaseLayerImport, getLatestImportStatus } from '../../services/worldViewImport/index.js';
import { buildBaseLayerTree } from '../../services/worldViewImport/baseLayerImporter.js';

const mockedBuild = buildBaseLayerTree as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

function makeReq(name: string) {
  return { body: { name, providerLabel: 'Dataset 1.0', maxDepth: 3 } } as never;
}

describe('startBaseLayerImport — tree build failure (regression)', () => {
  beforeEach(() => {
    mockedBuild.mockReset();
  });

  it('releases the reservation on a failed tree build, so a later import is not jammed forever', async () => {
    // First attempt: the tree build fails.
    mockedBuild.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));

    await expect(
      startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 3 }),
    ).rejects.toThrow('canceling statement due to statement timeout');

    // The reservation must not survive the failure — left behind, this
    // keeps reporting the phantom 'importing' entry forever.
    expect(getLatestImportStatus()).toBeNull();

    // The practical consequence: the real endpoint's 409 guard (which reads
    // getLatestImportStatus()) must not be jammed by the failed attempt —
    // a later request has to be able to start.
    mockedBuild.mockResolvedValueOnce({ name: 'World', children: [] });
    const res = makeRes();
    await startBaseLayerImportEndpoint(makeReq('Second'), res as never);

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ started: true }));
  });
});
