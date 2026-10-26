import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

/** The declared route these specs answer through (ADR-0071). */
const geoshapeMatchRoute = routeAt(adminDeclaredRoutes, '/wv-import/matches/:worldViewId/geoshape-match', 'post');

const { mockGeoshapeMatch, mockPointMatch, mockSimilarity } = vi.hoisted(() => ({
  mockGeoshapeMatch: vi.fn(),
  mockPointMatch: vi.fn(),
  mockSimilarity: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../../services/worldViewImport/geoshapeCoverage.js', () => ({ geoshapeMatchRegion: mockGeoshapeMatch }));
vi.mock('../../services/worldViewImport/pointMatcher.js', () => ({ pointMatchRegion: mockPointMatch }));
vi.mock('../../services/worldViewImport/geoshapeCache.js', () => ({ computeGeoSimilarityIfNeeded: mockSimilarity }));

// Stub other heavy imports the controller pulls in but geoshapeMatch doesn't use.
vi.mock('openai', () => ({ default: class { } }));
vi.mock('../../services/worldViewImport/aiMatcher.js', () => ({
  startAIMatching: vi.fn(), getAIMatchProgress: vi.fn(), cancelAIMatch: vi.fn(),
  aiMatchSingleRegion: vi.fn(), dbSearchSingleRegion: vi.fn(), geocodeMatchRegion: vi.fn(),
}));
vi.mock('../../services/ai/openaiService.js', () => ({ isOpenAIAvailable: vi.fn(), getOpenAIClient: vi.fn() }));
vi.mock('../../services/ai/aiSettingsService.js', () => ({ getModelForFeature: vi.fn() }));
vi.mock('../../services/ai/pricingService.js', () => ({ calculateCost: vi.fn() }));
vi.mock('../../services/ai/chatCompletion.js', () => ({ chatCompletion: vi.fn() }));
vi.mock('../../services/ai/aiUsageLogger.js', () => ({ logAIUsage: vi.fn() }));
vi.mock('../../services/wikivoyageExtract/fetcher.js', () => ({ WikivoyageFetcher: class { } }));

function makeReq(): AuthenticatedRequest {
  return { params: { worldViewId: '5' }, body: { regionId: 6737 } } as unknown as AuthenticatedRequest;
}

function makeRes(): Response & { _status?: number; _body?: unknown } {
  const res = {} as Response & { _status?: number; _body?: unknown };
  res.status = vi.fn((code: number) => { res._status = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => { res._body = body; return res; }) as unknown as Response['json'];
  return res;
}

const cairo = { divisionId: 42, name: 'Cairo', path: 'Africa > Egypt > Cairo', score: 1000 };

describe('geoshapeMatch with no shape held (#2084)', () => {
  beforeEach(() => {
    mockGeoshapeMatch.mockReset();
    mockPointMatch.mockReset();
    mockSimilarity.mockReset();
  });

  it('matches the region by its markers and says the shape was unavailable', async () => {
    mockGeoshapeMatch.mockResolvedValueOnce({ found: 0, suggestions: [], geoshapeUnavailable: true });
    mockPointMatch.mockResolvedValueOnce({ found: 1, suggestions: [cairo] });

    const res = makeRes();
    await answerRoute(geoshapeMatchRoute, makeReq(), res);

    expect(mockPointMatch).toHaveBeenCalledWith(5, 6737, undefined);
    expect(res._body).toEqual({ found: 1, suggestions: [expect.objectContaining({ divisionId: 42 })], shapeUnavailable: true });
  });

  it('answers the shape match alone when a shape is held', async () => {
    mockGeoshapeMatch.mockResolvedValueOnce({ found: 1, suggestions: [cairo], totalCoverage: 0.97 });

    const res = makeRes();
    await answerRoute(geoshapeMatchRoute, makeReq(), res);

    expect(mockPointMatch).not.toHaveBeenCalled();
    expect(res._body).toEqual({ found: 1, suggestions: [expect.objectContaining({ divisionId: 42 })], totalCoverage: 0.97 });
  });
});
