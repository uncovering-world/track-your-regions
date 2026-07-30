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

import { startBaseLayerImport } from './index.js';
import { buildBaseLayerTree } from './baseLayerImporter.js';
import { importTree } from './importer.js';
import { matchCountryLevel, matchHierarchical } from './matcher.js';

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
