import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./baseLayerImporter.js', () => ({
  buildBaseLayerTree: vi.fn().mockResolvedValue({
    name: 'World',
    children: [{ name: 'Europe', children: [] }],
  }),
}));
vi.mock('./importer.js', () => ({
  importTree: vi.fn().mockResolvedValue(77),
}));
vi.mock('./matcher.js', () => ({
  matchCountryLevel: vi.fn().mockResolvedValue(undefined),
  matchHierarchical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('./spatialPass.js', () => ({
  runSpatialPass: vi.fn().mockResolvedValue({ considered: 0, seeded: 0, accepted: 0, stoppedAfter: null }),
  spatialSentence: vi.fn().mockReturnValue(''),
}));

import { startBaseLayerImport } from './index.js';
import { buildBaseLayerTree } from './baseLayerImporter.js';
import { importTree } from './importer.js';
import { matchCountryLevel, matchHierarchical } from './matcher.js';
import { pool } from '../../db/index.js';
import { runSpatialPass } from './spatialPass.js';
import { createInitialProgress } from './types.js';
import { runMatchingPolicy } from './index.js';
import { Operation } from '../operationProgress.js';

const mockedBuild = buildBaseLayerTree as unknown as ReturnType<typeof vi.fn>;
const mockedImport = importTree as unknown as ReturnType<typeof vi.fn>;
const mockedCountryMatch = matchCountryLevel as unknown as ReturnType<typeof vi.fn>;
const mockedHierarchicalMatch = matchHierarchical as unknown as ReturnType<typeof vi.fn>;

describe('startBaseLayerImport', () => {
  beforeEach(() => {
    mockedBuild.mockClear();
    mockedImport.mockClear();
    mockedCountryMatch.mockClear();
    mockedHierarchicalMatch.mockClear();
  });

  it('builds the tree at the requested depth', async () => {
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });

    expect(mockedBuild).toHaveBeenCalledWith({ maxDepth: 2 });
  });

  it('imports it as a base_layer source carrying the provider label', async () => {
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });
    // startImport runs the pipeline in the background; let it reach importTree.
    await vi.waitFor(() => expect(mockedImport).toHaveBeenCalled());

    const [, name, , options] = mockedImport.mock.calls[0];
    expect(name).toBe('Administrative');
    expect(options).toMatchObject({ sourceType: 'base_layer', source: 'Dataset 1.0' });
  });

  it('runs a matcher over the tree rather than resolving divisions itself', async () => {
    // ADR-0018's premise: the base layer gets no privileged path. It is still
    // matched, not handed the answer — the importer never carries the division a
    // node was read from. ADR-0019 only changed *which* policy does the matching.
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });
    await vi.waitFor(() => expect(mockedHierarchicalMatch).toHaveBeenCalledWith(77, expect.anything()));
  });

  it('matches it under the hierarchical policy, not the country-anchored one', async () => {
    // A mirror is one node per division, so the descent resolves it; the
    // country-anchored policy left 1459 of 3831 regions unresolved (ADR-0019).
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });
    await vi.waitFor(() => expect(mockedHierarchicalMatch).toHaveBeenCalled());

    expect(mockedCountryMatch).not.toHaveBeenCalled();
  });

  it('returns an operation id the existing status endpoint can poll', async () => {
    const opId = await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });

    expect(opId).toMatch(/^wv-import-\d+$/);
  });
});

/**
 * A cancel during the spatial pass (#622) stops the scoring and nothing else: the
 * policy's results are written by then, so the run finishes and the import is
 * marked ready for review rather than left in 'matching'.
 */
describe('a cancel during the spatial pass', () => {
  it('finishes the match phase rather than cancelling it', async () => {
    const progress = createInitialProgress();
    (runSpatialPass as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      progress.cancel = true;
      return { considered: 3, seeded: 0, accepted: 0, stoppedAfter: 1 };
    });

    const outcome = await runMatchingPolicy('hierarchical', 77, progress);

    expect(outcome.cancelled).toBe(false);
    expect(outcome.spatial?.stoppedAfter).toBe(1);
  });

  it('keeps a cancel the policy saw as a cancel, and runs no pass after it', async () => {
    const progress = createInitialProgress();
    mockedHierarchicalMatch.mockImplementationOnce(async () => { progress.cancel = true; });
    (runSpatialPass as unknown as ReturnType<typeof vi.fn>).mockClear();

    const outcome = await runMatchingPolicy('hierarchical', 77, progress);

    expect(outcome).toEqual({ cancelled: true, spatial: null });
    expect(runSpatialPass).not.toHaveBeenCalled();
  });

  it("puts the policy's own message back once the pass has used the line", async () => {
    const progress = createInitialProgress();
    mockedHierarchicalMatch.mockImplementationOnce(async () => { progress.statusMessage = 'Hierarchical match complete: 41 matched'; });
    (runSpatialPass as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      progress.statusMessage = 'Spatial pass: 3 of 3 leaves with a Wikidata id';
      return { considered: 3, seeded: 0, accepted: 0, stoppedAfter: null };
    });

    await runMatchingPolicy('hierarchical', 77, progress);

    expect(progress.statusMessage).toBe('Hierarchical match complete: 41 matched');
  });

  it('marks an import ready for review after a cancel during the pass', async () => {
    const query = pool.query as unknown as ReturnType<typeof vi.fn>;
    query.mockClear();
    (runSpatialPass as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_id: number, progress: { cancel: boolean }) => {
      progress.cancel = true;
      return { considered: 3, seeded: 0, accepted: 0, stoppedAfter: 1 };
    });

    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });

    await vi.waitFor(() => expect(query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'reviewing'"))).toBe(true));
  });
});

describe('the steps the match phase reports (#1356)', () => {
  it("counts as the caller's own steps: 2 and 3 of an import, 5 and 6 of an extraction", async () => {
    const lines: string[] = [];
    const progress = createInitialProgress();
    progress.operation = new Operation('[WV Extract] wv-extract-1:', 6, line => lines.push(line));

    await runMatchingPolicy('country-based', 77, progress, { names: 5, spatial: 6 });

    expect(lines.some(line => line.includes('Step 5 of 6: Matching the countries to GADM by name'))).toBe(true);
    expect(lines.some(line => line.includes('Step 6 of 6: Scoring the leaves'))).toBe(true);
  });
});
