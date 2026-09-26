import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/ai/openaiService.js', () => ({
  suggestGroupForRegion: vi.fn(),
  suggestGroupsForMultipleRegions: vi.fn(),
  generateGroupDescriptions: vi.fn(),
  geocodeDescription: vi.fn(),
  isOpenAIAvailable: vi.fn(),
  fetchAvailableModelsFromAPI: vi.fn(),
  getModel: vi.fn(),
  setModel: vi.fn(),
  getWebSearchModel: vi.fn(),
  setWebSearchModel: vi.fn(),
  getWebSearchCapableModels: vi.fn(),
}));

import { isOpenAIAvailable, suggestGroupForRegion } from '../services/ai/openaiService.js';
import { answer, routeAt } from '../api/routeTesting.js';
import { aiRoutes } from '../routes/aiRoutes.js';

const mockedAvailable = isOpenAIAvailable as unknown as ReturnType<typeof vi.fn>;
const mockedSuggest = suggestGroupForRegion as unknown as ReturnType<typeof vi.fn>;

/** The AI routes these specs answer through (ADR-0071). */
const postSuggestGroup = routeAt(aiRoutes, '/suggest-group', 'post');
const postSuggestGroupsBatch = routeAt(aiRoutes, '/suggest-groups-batch', 'post');

const ADMIN = { id: 1, role: 'admin' } as Express.User;
const REQUEST = { regionPath: 'Europe > Russia', regionName: 'Tatarstan', availableGroups: ['Volga'], parentRegion: 'Russia' };

function makeRes() {
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  mockedAvailable.mockReset().mockReturnValue(true);
  mockedSuggest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('asking the model for a group', () => {
  it('refuses an empty region name the schema lets through', async () => {
    const res = makeRes();
    await answer(postSuggestGroup, { body: { ...REQUEST, regionName: '' }, user: ADMIN }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'regionName is required and must be a string' });
    expect(mockedSuggest).not.toHaveBeenCalled();
  });

  it('answers 503 with its sentence when no key is configured', async () => {
    mockedAvailable.mockReturnValue(false);
    const res = makeRes();
    await answer(postSuggestGroup, { body: REQUEST, user: ADMIN }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'AI features are not available' });
  });

  it('names a spent quota by its code, for the client to say so', async () => {
    mockedSuggest.mockRejectedValue(Object.assign(new Error('You exceeded your current quota'), { status: 429 }));
    const res = makeRes();
    await answer(postSuggestGroup, { body: REQUEST, user: ADMIN }, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'AI quota exceeded', code: 'quota_exceeded' });
  });

  it('answers its own sentence for any other failure, never the SDK text', async () => {
    mockedSuggest.mockRejectedValue(new Error('Request failed: https://api.openai.com/v1 500'));
    const res = makeRes();
    await answer(postSuggestGroup, { body: REQUEST, user: ADMIN }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get AI suggestion' });
  });
});

describe('asking for a batch', () => {
  it('leaves an empty list of regions to the schema', async () => {
    await expect(answer(postSuggestGroupsBatch, { body: { ...REQUEST, regions: [] }, user: ADMIN }, makeRes()))
      .rejects.toThrow();
  });
});
