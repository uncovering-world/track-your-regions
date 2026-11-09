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

describe('several questions in one call (#1272)', () => {
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

  const questions = {
    p31: { instructions: 'Is the fort the component?', criteria: { same: 'the same place', other: 'another place' } },
    p32: { instructions: 'Is the tower the component?', criteria: { same: 'the same place', other: 'another place' } },
  };

  it('sends every question in one request and reads each answer under its own key, refusing one outside its options', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: {
        p31: { type: 'choice', choice: 'same', probabilities: { same: 0.93, other: 0.07 }, confidence: 0.93 },
        p32: { type: 'choice', choice: 'elsewhere', probabilities: {}, confidence: 0.5 },
      },
      usage: { input_tokens: 812, output_tokens: 20 },
    }), { status: 200 }));

    const { askJevChoices } = await import('./jevClient.js');
    const answer = await askJevChoices({ site: 'Dacia' }, questions);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(Object.keys(sent.questions)).toEqual(['p31', 'p32']);
    expect(sent.questions.p32).toEqual({ type: 'choice', ...questions.p32 });
    expect(answer).toEqual({
      model: 'jev-1.13.0', inputTokens: 812,
      answers: { p31: { choice: 'same', probabilities: { same: 0.93, other: 0.07 }, confidence: 0.93 }, p32: { refused: true } },
    });
  });

  describe("within Jev's context (#2398)", () => {
    /** A question about 18k tokens long by the estimate: two fill a call, a third starts the next. */
    const long = (n: number) => ({ instructions: `Hint ${n}: ${'x'.repeat(54_000)}`, criteria: { here: 'it is here', other: 'another place' } });
    /** Jev answering whatever a call asked, `here` to every question, at 1000 tokens a call. */
    const answeringEach = () => fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const asked = JSON.parse(init.body) as { questions: Record<string, unknown> };
      return new Response(JSON.stringify({
        model: 'jev-1.14.0',
        answers: Object.fromEntries(Object.keys(asked.questions).map(id => [id, { choice: 'here', probabilities: { here: 0.8, other: 0.2 }, confidence: 0.8 }])),
        usage: { input_tokens: 1000 },
      }), { status: 200 });
    });

    it('asks a decision too long for one call in several, in order, each with the state, and answers every question under its key', async () => {
      answeringEach();
      const { askJevChoices } = await import('./jevClient.js');
      const many = Object.fromEntries([1, 2, 3, 4, 5].map(n => [`h${n}`, long(n)]));

      const answer = await askJevChoices({ site: 'Rock Art of the Mediterranean Basin' }, many);

      const sent = fetchMock.mock.calls.map(call => JSON.parse(call[1].body as string) as { state: unknown; questions: object });
      expect(sent.map(call => Object.keys(call.questions))).toEqual([['h1', 'h2'], ['h3', 'h4'], ['h5']]);
      expect(sent.every(call => JSON.stringify(call.state) === JSON.stringify({ site: 'Rock Art of the Mediterranean Basin' }))).toBe(true);
      expect(Object.keys(answer.answers)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
      expect(answer.answers.h5).toEqual({ choice: 'here', probabilities: { here: 0.8, other: 0.2 }, confidence: 0.8 });
      // What the calls cost, added up: what the callers share out over the questions.
      expect(answer).toMatchObject({ model: 'jev-1.14.0', inputTokens: 3000 });
    });

    it('keeps the questions of a decision that fits in one call', async () => {
      answeringEach();
      const { askJevChoices } = await import('./jevClient.js');
      await askJevChoices({ site: 'Dacia' }, Object.fromEntries(Array.from({ length: 50 }, (_, n) => [`h${n}`, questions.p31])));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('asks a question too long for any call alone, so Jev refuses that one and no other', async () => {
      answeringEach();
      const { callsFor } = await import('./jevClient.js');
      const huge = { instructions: 'x'.repeat(200_000), criteria: { here: 'it is here', other: 'another place' } };
      expect(callsFor({ site: 'Qhapaq Ñan' }, { h1: questions.p31, h2: huge, h3: questions.p32 }).map(Object.keys))
        .toEqual([['h1'], ['h2'], ['h3']]);
    });

    it('asks nothing after a call that fails, and fails, so nothing is stored and the next opening asks again', async () => {
      answeringEach();
      fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 200 }))
        .mockImplementationOnce(async () => new Response('{"error":"max_tokens_exceeded"}', { status: 400 }));
      const { askJevChoices } = await import('./jevClient.js');
      const many = Object.fromEntries([1, 2, 3, 4, 5].map(n => [`h${n}`, long(n)]));

      await expect(askJevChoices({ site: 'Rock Art' }, many)).rejects.toThrow('Jev answered 400');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('backs off once on a 429, for the delay the service names, and then asks again', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }))
        .mockResolvedValueOnce(answer({ type: 'choice', choice: 'view379', probabilities: {}, confidence: 0.9 }));
      const { askJevChoice } = await import('./jevClient.js');
      const asked = askJevChoice(QUESTION);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await asked).choice).toBe('view379');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the one retry a refusal gets', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(new Response('slow down', { status: 429 }));
      const { askJevChoice } = await import('./jevClient.js');
      const asked = askJevChoice(QUESTION).catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await asked).toBe('Jev answered 429');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a refusal naming a long delay', () => {
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

  it('gets no retry, so a curator\'s request is not held for it', async () => {
    fetchMock.mockResolvedValue(new Response('slow down', { status: 429, headers: { 'retry-after': '3600' } }));
    const { askJevChoice } = await import('./jevClient.js');
    await expect(askJevChoice(QUESTION)).rejects.toThrow('Jev answered 429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
