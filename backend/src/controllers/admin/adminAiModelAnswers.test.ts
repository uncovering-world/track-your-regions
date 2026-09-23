/**
 * The admin AI tools read what a model wrote key by key into the answers
 * `api/responses/adminAi.ts` declares. These specs feed a rule review and a
 * hierarchy review what a model could write, and hold the answer each endpoint
 * sends to its schema: `respond()` parses it in this lane.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompletion = vi.fn();
const poolQuery = vi.fn();

vi.mock('../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));
vi.mock('../../services/ai/chatCompletion.js', () => ({ chatCompletion: (...args: unknown[]) => chatCompletion(...args) }));
vi.mock('../../services/ai/openaiShared.js', () => ({ getOpenAIClient: () => ({}), isOpenAIAvailable: () => true }));
vi.mock('../../services/ai/aiSettingsService.js', () => ({ getModelForFeature: async () => 'gpt-4.1' }));
vi.mock('../../services/ai/aiUsageLogger.js', () => ({ logAIUsage: () => Promise.resolve() }));
vi.mock('../../services/ai/learnedRulesService.js', () => ({
  PREDEFINED_RULES: [{ code: 'extraction.6', feature: 'extraction', ruleText: 'Cities are always leaf nodes.' }],
  getAllRules: async () => [
    { id: 41, feature: 'extraction', ruleText: 'Do not split a city into districts.', context: null, createdAt: '2026-09-01T10:00:00.000Z' },
    { id: 42, feature: 'extraction', ruleText: 'Cities have no subregions.', context: null, createdAt: '2026-09-02T10:00:00.000Z' },
  ],
}));
vi.spyOn(console, 'warn').mockImplementation(() => {});

import { reviewLearnedRules } from './aiController.js';
import { hierarchyReview } from './aiHierarchyReviewController.js';

function modelWrites(content: string) {
  chatCompletion.mockResolvedValueOnce({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 120 } });
}

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

beforeEach(() => {
  chatCompletion.mockReset();
  poolQuery.mockReset();
});

describe('a rule review', () => {
  it('maps the prompt\'s numbering back to rule ids, and reads the rest as the answer allows', async () => {
    // Built-in rule is #1 in the prompt, so the two learned ones are #2 and #3.
    modelWrites(JSON.stringify({
      suggestions: [
        { type: 'duplicate', description: 'Both say cities are leaves', deleteIds: [3, 1, 'x', 9], keepId: 2, replacementText: 7 },
        { type: 'obsolete', description: 'Names a rule that is not there', deleteIds: [], keepId: 12 },
      ],
      summary: 42,
      consolidatedCount: 1.5,
    }));
    const res = makeRes();
    await reviewLearnedRules({} as never, res as never);

    expect(res.json).toHaveBeenCalledWith({
      suggestions: [
        { type: 'merge', description: 'Both say cities are leaves', deleteIds: [42], keepId: 41, replacementText: null },
      ],
      summary: 'Found 1 suggestion(s).',
      consolidatedCount: 1,
    });
  });
});

describe('a hierarchy review of one branch', () => {
  it('reads each action key by key: an unknown type is other, a missing id takes its place', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [
      { id: 7001, name: 'Northwestern Russia', depth: 0, parent_id: null, child_count: 1, match_status: 'children_matched' },
      { id: 7002, name: 'Karelia', depth: 1, parent_id: 7001, child_count: 0, match_status: 'matched' },
    ] });
    modelWrites(JSON.stringify({
      report: '## Northwestern Russia\n- Saint Petersburg is missing.',
      actions: [
        { type: 'add_child', regionId: 7001, regionName: 'Northwestern Russia', description: 'Add "Saint Petersburg" as child of "Northwestern Russia"', params: { childName: 'Saint Petersburg' }, note: 'extra' },
        { id: 'fix-karelia', type: 'split', regionId: '7002', regionName: 'Karelia', description: 'Split Karelia', choices: [{ label: 'North', value: 'n' }, { label: 3 }] },
        'not an action',
      ],
    }));
    const res = makeRes();
    await hierarchyReview({ params: { worldViewId: '5' }, body: { regionId: 7001 } } as never, res as never);

    const [body] = res.json.mock.calls[0];
    expect(body.actions).toEqual([
      { id: 'action-1', type: 'add_child', regionId: 7001, regionName: 'Northwestern Russia', description: 'Add "Saint Petersburg" as child of "Northwestern Russia"', params: { childName: 'Saint Petersburg' } },
      { id: 'fix-karelia', type: 'other', regionId: null, regionName: 'Karelia', description: 'Split Karelia', choices: [{ label: 'North', value: 'n' }] },
    ]);
    expect(body.stats).toMatchObject({ passes: 1, inputTokens: 900, outputTokens: 120 });
  });

  it('answers the model\'s text as the report when it is not JSON', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [
      { id: 7001, name: 'Northwestern Russia', depth: 0, parent_id: null, child_count: 0, match_status: 'matched' },
    ] });
    modelWrites('The branch looks fine.');
    const res = makeRes();
    await hierarchyReview({ params: { worldViewId: '5' }, body: { regionId: 7001 } } as never, res as never);

    expect(res.json.mock.calls[0][0]).toMatchObject({ report: 'The branch looks fine.', actions: [] });
  });
});
