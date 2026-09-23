import { describe, expect, it, vi } from 'vitest';

const latest = vi.fn();
vi.mock('../../db/index.js', () => ({
  pool: { query: async () => ({ rows: [{ id: 2, name: 'Wikivoyage Regions', source_type: 'wikivoyage_done' }] }) },
}));
vi.mock('../../services/wikivoyageExtract/index.js', () => ({
  startExtraction: vi.fn(),
  getLatestExtractionStatus: () => latest(),
  cancelExtraction: vi.fn(),
  findPendingQuestion: vi.fn(),
  listCaches: () => [{ name: 'wikivoyage-cache.json', sizeBytes: 5120000, modifiedAt: '2026-09-10T08:00:00.000Z' }],
  deleteCache: vi.fn(),
}));

import { getWikivoyageExtractionStatus } from './wikivoyageExtractController.js';

describe('the extraction status', () => {
  it('sends a pending question and its regions by their declared keys only', async () => {
    latest.mockReturnValue({
      opId: 'op-7',
      progress: {
        status: 'extracting', statusMessage: 'Reading Russia', regionsFetched: 120, estimatedTotal: 900,
        currentPage: 'Russia', apiRequests: 140, cacheHits: 20, createdRegions: 0, totalRegions: 0,
        countriesMatched: 0, totalCountries: 0, subdivisionsDrilled: 0, noCandidates: 0, worldViewId: null,
        startedAt: 1790000000000, aiApiCalls: 3, aiPromptTokens: 9000, aiCompletionTokens: 700, aiTotalCost: 0.02,
        pendingQuestions: [{
          id: 1, pageTitle: 'Saint Petersburg', sourceUrl: 'https://en.wikivoyage.org/wiki/Saint_Petersburg',
          resolved: false, rawQuestions: ['Are the districts regions?'],
          // What the service holds beside the answer's keys: a model's own key, and the callbacks.
          currentQuestion: {
            text: 'Split Saint Petersburg into its districts?',
            options: [{ label: 'Keep it a leaf', value: 'leaf', hint: 'cities are leaves' }],
            recommended: 0, confidence: 'high',
          },
          extractedRegions: [{ name: 'Central Saint Petersburg', isLink: true, children: [], score: 3 }],
          reExtract: vi.fn(), formulateNextQuestion: vi.fn(), processAnswer: vi.fn(),
        }],
      },
    });
    const json = vi.fn();

    await getWikivoyageExtractionStatus({} as never, { json, status: vi.fn().mockReturnThis() } as never);

    const [body] = json.mock.calls[0];
    expect(body.pendingQuestions).toEqual([{
      id: 1, pageTitle: 'Saint Petersburg', sourceUrl: 'https://en.wikivoyage.org/wiki/Saint_Petersburg',
      currentQuestion: {
        text: 'Split Saint Petersburg into its districts?',
        options: [{ label: 'Keep it a leaf', value: 'leaf' }],
        recommended: 0,
      },
      extractedRegions: [{ name: 'Central Saint Petersburg', isLink: true, children: [] }],
    }]);
    expect(body.importedWorldViews).toEqual([{ id: 2, name: 'Wikivoyage Regions', sourceType: 'wikivoyage_done', reviewComplete: true }]);
  });
});
