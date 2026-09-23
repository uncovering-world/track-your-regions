/**
 * A model writes the JSON these services read, and nothing holds it to a shape:
 * each service reads it key by key into the answer its endpoint declares
 * (`api/responses/ai.ts`). These specs feed the services what a model has been
 * seen to write, and what it could, and hold the result to the declared schema.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawModelResult } from './openaiShared.js';

const invokeModel = vi.fn<() => Promise<RawModelResult>>();
const chatCompletion = vi.fn();

vi.mock('./openaiShared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./openaiShared.js')>()),
  getOpenAIClient: () => ({}),
  invokeModel: () => invokeModel(),
}));
vi.mock('./chatCompletion.js', () => ({ chatCompletion: (...args: unknown[]) => chatCompletion(...args) }));
vi.mock('./aiUsageLogger.js', () => ({ logAIUsage: () => Promise.resolve() }));
vi.spyOn(console, 'log').mockImplementation(() => {});

import {
  AIGeocodeResult,
  BatchSuggestions,
  GroupDescriptions,
  GroupSuggestion,
} from '../../api/responses/ai.js';
import { suggestGroupForRegion, suggestGroupsForMultipleRegions } from './openaiGroupSuggestion.js';
import { generateGroupDescriptions } from './openaiGroupDescriptions.js';
import { geocodeDescription } from './openaiService.js';

// Wikivoyage's split of Russia, which the AI assist sorts oblasts into.
const GROUPS = ['Central Russia', 'Volga Region', 'Siberia', 'Russian Far East'];

function answers(content: string) {
  invokeModel.mockResolvedValueOnce({
    content,
    promptTokens: 400,
    completionTokens: 60,
    totalTokens: 460,
    webSearchWasUsed: false,
  });
}

function suggest(escalationLevel: 'fast' | 'reasoning' = 'fast') {
  return suggestGroupForRegion(
    'Russia > Tatarstan', 'Tatarstan', GROUPS, 'Russia', undefined, false, undefined, escalationLevel,
  );
}

beforeEach(() => {
  invokeModel.mockReset();
  chatCompletion.mockReset();
});

describe('one region\'s suggestion', () => {
  it('answers what the model wrote, with the cost and the escalation it was asked at', async () => {
    answers('{"suggestedGroup": "Volga Region", "confidence": "high", "shouldSplit": false, "reasoning": "Kazan is on the Volga."}');
    const suggestion = GroupSuggestion.parse(await suggest());
    expect(suggestion).toMatchObject({
      suggestedGroup: 'Volga Region',
      confidence: 'high',
      escalationLevel: 'fast',
      needsEscalation: false,
      usage: { totalTokens: 460 },
    });
  });

  it('reads a word or a type of the model\'s own as the nearest thing the answer allows', async () => {
    answers(JSON.stringify({
      suggestedGroup: 'volga region',
      confidence: 'very high',
      shouldSplit: 'no',
      splitGroups: 'Volga Region',
      reasoning: 42,
      context: null,
      sources: ['https://en.wikivoyage.org/wiki/Tatarstan', 7],
      region: 'Tatarstan',
    }));
    const suggestion = GroupSuggestion.parse(await suggest());
    expect(suggestion).toMatchObject({
      suggestedGroup: 'Volga Region',
      confidence: 'low',
      shouldSplit: false,
      reasoning: '',
      sources: ['https://en.wikivoyage.org/wiki/Tatarstan'],
      needsEscalation: true,
    });
    expect(suggestion.splitGroups).toBeUndefined();
    expect(suggestion.context).toBeUndefined();
  });

  it('leaves no group and low confidence when the model was sure of a group not on offer', async () => {
    answers('{"suggestedGroup": "Ural", "confidence": "high", "shouldSplit": false, "reasoning": "It borders Bashkortostan."}');
    const suggestion = GroupSuggestion.parse(await suggest('reasoning'));
    expect(suggestion).toMatchObject({ suggestedGroup: null, confidence: 'low', needsEscalation: false });
  });

  it('keeps the model\'s own advice to escalate', async () => {
    answers('{"suggestedGroup": "Siberia", "confidence": "high", "shouldSplit": false, "reasoning": "", "needsEscalation": true}');
    expect(GroupSuggestion.parse(await suggest()).needsEscalation).toBe(true);
  });

  it('fails when the model answered with something other than an object', async () => {
    answers('["Volga Region"]');
    await expect(suggest()).rejects.toThrow('did not answer with a suggestion');
  });
});

describe('a batch of suggestions', () => {
  it('answers one entry per region the model answered for, and drops groups it invented', async () => {
    answers(JSON.stringify({
      'Tatarstan': { suggestedGroup: 'Volga Region', confidence: 'high', shouldSplit: false, reasoning: '' },
      'Sakha': { suggestedGroup: null, confidence: 'medium', shouldSplit: true, splitGroups: ['Siberia', 'Yakutia', 'Russian Far East'], reasoning: '' },
      'Moscow Oblast': 'Central Russia',
    }));
    const batch = BatchSuggestions.parse(await suggestGroupsForMultipleRegions(
      [{ path: '', name: 'Tatarstan' }, { path: '', name: 'Sakha' }, { path: '', name: 'Moscow Oblast' }],
      GROUPS,
      'Russia',
    ));
    expect(Object.keys(batch.suggestions)).toEqual(['Tatarstan', 'Sakha']);
    expect(batch.suggestions.Sakha.splitGroups).toEqual(['Siberia', 'Russian Far East']);
    expect(batch).toMatchObject({ apiRequestsCount: 1, usage: { totalTokens: 460 } });
  });

  it('counts and costs an answer it could not read, which suggests nothing', async () => {
    answers('not JSON at all');
    const batch = BatchSuggestions.parse(await suggestGroupsForMultipleRegions([{ path: '', name: 'Tatarstan' }], GROUPS, 'Russia'));
    expect(batch).toMatchObject({ suggestions: {}, apiRequestsCount: 1, usage: { totalTokens: 460 } });
  });

  it('counts no request that failed before any answer', async () => {
    invokeModel.mockRejectedValueOnce(new Error('socket hang up'));
    const batch = BatchSuggestions.parse(await suggestGroupsForMultipleRegions([{ path: '', name: 'Tatarstan' }], GROUPS, 'Russia'));
    expect(batch).toMatchObject({ suggestions: {}, apiRequestsCount: 0, usage: { totalTokens: 0 } });
  });
});

describe('the groups\' descriptions', () => {
  it('keeps the descriptions that are text', async () => {
    answers('{"Siberia": "East of the Urals to the Pacific watershed.", "Volga Region": ["Kazan", "Samara"]}');
    const result = GroupDescriptions.parse(await generateGroupDescriptions(GROUPS));
    expect(result.descriptions).toEqual({ Siberia: 'East of the Urals to the Pacific watershed.' });
  });
});

describe('a place from a description', () => {
  function modelWrites(content: string) {
    chatCompletion.mockResolvedValueOnce({ choices: [{ message: { content } }] });
  }

  it('answers the point, the name and the confidence', async () => {
    modelWrites('{"lat": 55.7887, "lng": 49.1221, "name": "Kazan Kremlin", "confidence": "high"}');
    expect(AIGeocodeResult.parse(await geocodeDescription('the white kremlin in Kazan')))
      .toEqual({ lat: 55.7887, lng: 49.1221, name: 'Kazan Kremlin', confidence: 'high' });
  });

  it('names the place by the description, and says low, when the model did not', async () => {
    modelWrites('```json\n{"lat": 55.7887, "lng": 49.1221, "confidence": "certain"}\n```');
    expect(AIGeocodeResult.parse(await geocodeDescription('the white kremlin in Kazan')))
      .toEqual({ lat: 55.7887, lng: 49.1221, name: 'the white kremlin in Kazan', confidence: 'low' });
  });

  it('fails when the point is not on the globe', async () => {
    modelWrites('{"lat": "55.7887", "lng": 49.1221, "name": "Kazan Kremlin", "confidence": "high"}');
    await expect(geocodeDescription('the white kremlin in Kazan')).rejects.toThrow('did not locate the place');
    modelWrites('{"lat": 155, "lng": 49.1221, "name": "Kazan Kremlin", "confidence": "high"}');
    await expect(geocodeDescription('the white kremlin in Kazan')).rejects.toThrow('did not locate the place');
  });
});
