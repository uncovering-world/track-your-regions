/**
 * The two models that read a dedication from a lead (#2472): what each is
 * sent, how its answer is read, and that a deployment without either key asks
 * neither. No model is called: each client is a stand-in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./openaiShared.js', () => ({ getOpenAIClient: vi.fn(() => null) }));
vi.mock('./aiSettingsService.js', () => ({ getModelForFeature: vi.fn(async () => 'gpt-5-mini') }));
vi.mock('./aiUsageLogger.js', () => ({ logAIUsage: vi.fn(async () => 1) }));

import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { logAIUsage } from './aiUsageLogger.js';
import { getOpenAIClient } from './openaiShared.js';
import { claudeModel, CLAUDE_LEAD_MODEL, leadDedicationModels, openaiModel, type StructuredQuestion } from './leadDedicationModels.js';

const QUESTION: StructuredQuestion = {
  system: 'instructions',
  user: 'Place: <<<Shaheed Minar>>>\n\nLead:\n<<<…>>>',
  name: 'dedication',
  schema: { type: 'object', properties: { link: { type: 'string', enum: ['Bengali language movement', 'none'] } } },
};
const ANSWER = { stated: true, link: 'Bengali language movement', subject_text: '', year: '1952', evidence: '' };

function claudeClient(message: Partial<Anthropic.Message>) {
  const create = vi.fn(async () => ({ usage: { input_tokens: 1400, output_tokens: 400 }, ...message }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

function openaiClient(content: string | null, finish = 'stop') {
  const create = vi.fn(async () => ({
    choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 800, completion_tokens: 800, total_tokens: 1600 },
  }));
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

beforeEach(() => vi.clearAllMocks());

describe('Claude', () => {
  it('is asked for the answer in its JSON shape, and its text read as that JSON', async () => {
    const { client, create } = claudeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(ANSWER) }] as Anthropic.ContentBlock[] });
    expect(await claudeModel(client).ask(QUESTION)).toEqual(ANSWER);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: CLAUDE_LEAD_MODEL,
      system: 'instructions',
      messages: [{ role: 'user', content: QUESTION.user }],
      output_config: { format: { type: 'json_schema', schema: QUESTION.schema } },
    }));
  });

  it('gives no answer for a refusal', async () => {
    const { client } = claudeClient({ stop_reason: 'refusal', content: [] });
    expect(await claudeModel(client).ask(QUESTION)).toBeNull();
  });

  it('logs its calls once, priced at its own rate, and nothing after', async () => {
    const { client } = claudeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] as Anthropic.ContentBlock[] });
    const claude = claudeModel(client);
    await claude.ask(QUESTION);
    await claude.ask(QUESTION);
    await claude.logUsage('Dedications read from 2 leads');
    await claude.logUsage('Dedications read from 2 leads');
    expect(logAIUsage).toHaveBeenCalledTimes(1);
    expect(logAIUsage).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'lead_dedication', model: CLAUDE_LEAD_MODEL, apiCalls: 2, promptTokens: 2800, completionTokens: 800,
      totalCost: expect.closeTo((2800 * 0.1 + 800 * 0.5) / 1_000_000, 12),
    }));
  });
});

describe('OpenAI', () => {
  it('is asked with a strict JSON schema, and its message read as that JSON', async () => {
    const { client, create } = openaiClient(JSON.stringify(ANSWER));
    expect(await openaiModel(client, 'gpt-5-mini').ask(QUESTION)).toEqual(ANSWER);
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
      model: 'gpt-5-mini',
      messages: [{ role: 'system', content: 'instructions' }, { role: 'user', content: QUESTION.user }],
      response_format: { type: 'json_schema', json_schema: { name: 'dedication', strict: true, schema: QUESTION.schema } },
      max_completion_tokens: 8000,
    });
  });

  it('gives no answer for one cut at its length or not JSON', async () => {
    expect(await openaiModel(openaiClient('{"stated": tr', 'length').client, 'gpt-5-mini').ask(QUESTION)).toBeNull();
    expect(await openaiModel(openaiClient('not json').client, 'gpt-5-mini').ask(QUESTION)).toBeNull();
  });
});

describe('the pair a deployment has', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it('is none without the Anthropic key, whatever OpenAI has', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.mocked(getOpenAIClient).mockReturnValue(openaiClient('{}').client);
    expect(await leadDedicationModels()).toBeNull();
  });

  it('is none without the OpenAI key', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.mocked(getOpenAIClient).mockReturnValue(null);
    expect(await leadDedicationModels()).toBeNull();
  });

  it('is Claude and the OpenAI model AI Settings names where both keys are set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.mocked(getOpenAIClient).mockReturnValue(openaiClient('{}').client);
    expect((await leadDedicationModels())?.map((model) => model.model)).toEqual([CLAUDE_LEAD_MODEL, 'gpt-5-mini']);
  });
});
