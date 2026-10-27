import { describe, expect, it, vi } from 'vitest';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';
import { startExtraction } from '../../services/wikivoyageExtract/index.js';
import { startWikivoyageExtraction } from './wikivoyageExtractController.js';

/** The declared routes these specs answer through (ADR-0071). */
const getWikivoyageExtractionStatusRoute = routeAt(adminDeclaredRoutes, '/wv-extract/status', 'get');

const latest = vi.fn();
const pages = vi.hoisted(() => vi.fn());
vi.mock('../../db/index.js', () => ({
  pool: { query: async () => ({ rows: [{ id: 2, name: 'Wikivoyage Regions', source_type: 'wikivoyage_done' }] }) },
}));
vi.mock('../../services/wikivoyageExtract/index.js', () => ({
  startExtraction: vi.fn(),
  getLatestExtractionStatus: () => latest(),
  cancelExtraction: vi.fn(),
  findPendingQuestion: vi.fn(),
}));
vi.mock('../../services/dumps/wikivoyage/pageTables.js', () => ({ latestPages: pages }));


describe('starting an extraction (#2089)', () => {
  it('is refused while no copy of English Wikivoyage is kept, since it reads nothing else', async () => {
    latest.mockReturnValue(null);
    pages.mockResolvedValue(null);
    await expect(startWikivoyageExtraction({ body: { name: 'Wikivoyage Regions' } }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Public Dumps') });
    expect(startExtraction).not.toHaveBeenCalled();
  });
});

describe('the extraction status', () => {
  it('names the copy the next extraction reads, and null while none is kept', async () => {
    latest.mockReturnValue(null);
    for (const [kept, copy] of [[{ dumpDate: '2026-10-01', swappedAt: new Date(), needs: 'nothing' }, { dumpDate: '2026-10-01' }], [null, null]] as const) {
      pages.mockResolvedValue(kept);
      const json = vi.fn();
      await answerRoute(getWikivoyageExtractionStatusRoute, {} as never, { json, status: vi.fn().mockReturnThis() } as never);
      expect(json.mock.calls[0][0]).toMatchObject({ running: false, copy });
    }
  });

  it('sends a pending question and its regions by their declared keys only', async () => {
    latest.mockReturnValue({
      opId: 'op-7',
      progress: {
        status: 'extracting', statusMessage: 'Reading Russia', regionsFetched: 120, estimatedTotal: 900,
        currentPage: 'Russia', createdRegions: 0, totalRegions: 0,
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
    pages.mockResolvedValue(null);
    const json = vi.fn();

    await answerRoute(getWikivoyageExtractionStatusRoute, {} as never, { json, status: vi.fn().mockReturnThis() } as never);

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
