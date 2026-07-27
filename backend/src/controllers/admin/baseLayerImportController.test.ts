import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/worldViewImport/index.js', () => ({
  startBaseLayerImport: vi.fn().mockResolvedValue('wv-import-9'),
  getLatestImportStatus: vi.fn().mockReturnValue(null),
}));

import { startBaseLayerImport, getLatestImportStatus } from '../../services/worldViewImport/index.js';
import { startBaseLayerImportEndpoint } from './baseLayerImportController.js';

const mockedStart = startBaseLayerImport as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = getLatestImportStatus as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('startBaseLayerImportEndpoint', () => {
  beforeEach(() => {
    mockedStart.mockClear();
    mockedStatus.mockReturnValue(null);
  });

  it('starts an import and returns its operation id', async () => {
    const res = makeRes();
    await startBaseLayerImportEndpoint(
      { body: { name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(mockedStart).toHaveBeenCalledWith({
      name: 'Administrative',
      providerLabel: 'Dataset 1.0',
      maxDepth: 2,
    });
    expect(res.json).toHaveBeenCalledWith({ started: true, operationId: 'wv-import-9' });
  });

  it('refuses to start a second import while one is importing', async () => {
    mockedStatus.mockReturnValue({ opId: 'wv-import-8', progress: { status: 'importing' } });
    const res = makeRes();

    await startBaseLayerImportEndpoint(
      { body: { name: 'X', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('refuses to start a second import while one is matching', async () => {
    mockedStatus.mockReturnValue({ opId: 'wv-import-8', progress: { status: 'matching' } });
    const res = makeRes();

    await startBaseLayerImportEndpoint(
      { body: { name: 'X', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('starts when the previous import has finished', async () => {
    mockedStatus.mockReturnValue({ opId: 'wv-import-8', progress: { status: 'complete' } });
    const res = makeRes();

    await startBaseLayerImportEndpoint(
      { body: { name: 'X', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(mockedStart).toHaveBeenCalled();
  });
});
