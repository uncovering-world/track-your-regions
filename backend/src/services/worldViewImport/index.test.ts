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
}));
vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { startBaseLayerImport } from './index.js';
import { buildBaseLayerTree } from './baseLayerImporter.js';
import { importTree } from './importer.js';
import { matchCountryLevel } from './matcher.js';

const mockedBuild = buildBaseLayerTree as unknown as ReturnType<typeof vi.fn>;
const mockedImport = importTree as unknown as ReturnType<typeof vi.fn>;
const mockedMatch = matchCountryLevel as unknown as ReturnType<typeof vi.fn>;

describe('startBaseLayerImport', () => {
  beforeEach(() => {
    mockedBuild.mockClear();
    mockedImport.mockClear();
    mockedMatch.mockClear();
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

  it('runs the normal matcher rather than resolving divisions itself', async () => {
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });
    await vi.waitFor(() => expect(mockedMatch).toHaveBeenCalledWith(77, expect.anything()));
  });

  it('returns an operation id the existing status endpoint can poll', async () => {
    const opId = await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });

    expect(opId).toMatch(/^wv-import-\d+$/);
  });
});
