/**
 * The Jev client (#1260): asks nothing without a key, sends one `choice` with
 * the outbound User-Agent, and takes an answer only among the options it gave.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askJevChoice, jevConfigured, JevAnswerRefused } from './jevClient.js';
import { userAgent } from '../../config/userAgent.js';

const QUESTION = {
  state: { place: 'Rila Monastery', countries: ['Bulgaria'] },
  instructions: 'Which name should a traveller see?',
  criteria: { view379: '"Rila Monastery"', view3045: '"Monastery of Saint John of Rila"' },
};

const answer = (pick: Record<string, unknown>) => new Response(JSON.stringify({
  model: 'jev-1.13.0', answers: { pick }, usage: { input_tokens: 428, output_tokens: 12 },
}), { status: 200 });

describe('the Jev client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.stubEnv('JEV_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is off without a key, and asks nothing', async () => {
    vi.stubEnv('JEV_API_KEY', '');
    expect(jevConfigured()).toBe(false);
    await expect(askJevChoice(QUESTION)).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks one choice and reads the option, its confidence and what it cost', async () => {
    fetchMock.mockResolvedValue(answer({ type: 'choice', choice: 'view379', probabilities: { view379: 0.98, view3045: 0.02 }, confidence: 0.96 }));

    const result = await askJevChoice(QUESTION);

    expect(result).toEqual({
      choice: 'view379', probabilities: { view379: 0.98, view3045: 0.02 }, confidence: 0.96, model: 'jev-1.13.0', inputTokens: 428,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['User-Agent']).toBe(userAgent());
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'jev-latest', state: QUESTION.state,
      questions: { pick: { type: 'choice', instructions: QUESTION.instructions, criteria: QUESTION.criteria } },
    });
  });

  it('refuses an answer outside the options it was given, carrying what the call cost', async () => {
    fetchMock.mockResolvedValue(answer({ type: 'choice', choice: 'view9', probabilities: {}, confidence: 0.5 }));
    const refused = await askJevChoice(QUESTION).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(JevAnswerRefused);
    expect(refused).toMatchObject({ inputTokens: 428, model: 'jev-1.13.0' });
  });

  it('refuses a confidence that is not a probability, and an option inherited from no one', async () => {
    fetchMock.mockResolvedValue(answer({ type: 'choice', choice: 'view379', probabilities: {}, confidence: 1.4 }));
    await expect(askJevChoice(QUESTION)).rejects.toThrow('outside the options');
    fetchMock.mockResolvedValue(answer({ type: 'choice', choice: 'toString', probabilities: {}, confidence: 0.9 }));
    await expect(askJevChoice(QUESTION)).rejects.toThrow('outside the options');
  });

  it('refuses a failed call', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(askJevChoice(QUESTION)).rejects.toThrow('429');
  });
});
