import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import {
  chatCompletion,
  ChatCompletionTimeoutError,
  DEFAULT_AI_TIMEOUT_MS,
} from './chatCompletion.js';

type CreateFn = OpenAI['chat']['completions']['create'];

function makeClient(create: CreateFn): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function makeResponse(model: string, totalTokens = 10): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: totalTokens },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

describe('chatCompletion — timeout enforcement (#365)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('passes through on success and logs timing (no timeout fired)', async () => {
    const create = vi.fn().mockResolvedValue(makeResponse('gpt-x'));
    const client = makeClient(create as unknown as CreateFn);

    const result = await chatCompletion(client, { model: 'gpt-x', messages: [] });
    expect(result.model).toBe('gpt-x');
    expect(create).toHaveBeenCalledTimes(1);

    // SDK is invoked WITH a signal (the auto-timeout) by default.
    const callArgs = create.mock.calls[0];
    expect(callArgs[1]?.signal).toBeDefined();
    expect(callArgs[1]?.signal?.aborted).toBe(false);
  });

  it('throws ChatCompletionTimeoutError when timeoutMs elapses before the SDK resolves', async () => {
    // Resolve the SDK call only when the signal aborts — simulates a hung server.
    const create = vi.fn().mockImplementation((_: unknown, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const err = new Error('Request was aborted') as Error & { name: string };
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const client = makeClient(create as unknown as CreateFn);

    // Attach .catch BEFORE advancing timers so the rejection is handled
    // synchronously when it occurs — avoids spurious unhandled-rejection
    // warnings from the test runner.
    const captured = chatCompletion(
      client,
      { model: 'gpt-x', messages: [] },
      { timeoutMs: 5_000 },
    ).catch(e => e);
    await vi.advanceTimersByTimeAsync(5_001);
    const err = await captured;

    expect(err).toBeInstanceOf(ChatCompletionTimeoutError);
    expect(err.timeoutMs).toBe(5_000);
    expect(err.model).toBe('gpt-x');
    expect(err.isTimeout).toBe(true);
    expect(err.elapsedMs).toBeGreaterThanOrEqual(5_000);
  });

  it('uses DEFAULT_AI_TIMEOUT_MS when timeoutMs is not specified', async () => {
    const create = vi.fn().mockImplementation((_: unknown, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted') as Error & { name: string };
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const client = makeClient(create as unknown as CreateFn);

    const captured = chatCompletion(client, { model: 'gpt-x', messages: [] }).catch(e => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_AI_TIMEOUT_MS + 1);
    const err = await captured;

    expect(err).toBeInstanceOf(ChatCompletionTimeoutError);
    expect((err as ChatCompletionTimeoutError).timeoutMs).toBe(DEFAULT_AI_TIMEOUT_MS);
  });

  it('does NOT install a timeout signal when timeoutMs is null (opt-out)', async () => {
    const create = vi.fn().mockResolvedValue(makeResponse('gpt-x'));
    const client = makeClient(create as unknown as CreateFn);

    await chatCompletion(client, { model: 'gpt-x', messages: [] }, { timeoutMs: null });
    // No external signal either → SDK called without { signal }.
    const callArgs = create.mock.calls[0];
    expect(callArgs[1]?.signal).toBeUndefined();
  });

  it('caller-cancelled abort does NOT surface as ChatCompletionTimeoutError', async () => {
    const externalCtl = new AbortController();
    const create = vi.fn().mockImplementation((_: unknown, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const err = new Error('Request was aborted by user') as Error & { name: string };
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const client = makeClient(create as unknown as CreateFn);

    const captured = chatCompletion(
      client,
      { model: 'gpt-x', messages: [] },
      { timeoutMs: 60_000, signal: externalCtl.signal },
    ).catch(e => e);

    // Cancel WELL BEFORE the timeout would fire.
    await vi.advanceTimersByTimeAsync(100);
    externalCtl.abort();
    const err = await captured;

    expect(err).not.toBeInstanceOf(ChatCompletionTimeoutError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('combines external signal with timeout signal', async () => {
    const externalCtl = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const create = vi.fn().mockImplementation((_: unknown, opts?: { signal?: AbortSignal }) => {
      capturedSignal = opts?.signal;
      return Promise.resolve(makeResponse('gpt-x'));
    });
    const client = makeClient(create as unknown as CreateFn);

    await chatCompletion(
      client,
      { model: 'gpt-x', messages: [] },
      { timeoutMs: 30_000, signal: externalCtl.signal },
    );

    // The SDK got SOME signal; not strictly the external one (we wrap with AbortSignal.any).
    expect(capturedSignal).toBeDefined();
  });

  it('timeout fired DURING retry surfaces as ChatCompletionTimeoutError, not AbortError', async () => {
    // Sequence: first call rejects fast with "Unsupported parameter" 400 →
    // retry fires → server hangs → timeout fires → retry rejects with
    // AbortError. Without the inner try/catch around retryWithoutParam, the
    // public contract ("timeout always surfaces as ChatCompletionTimeoutError")
    // would be broken on this code path.
    let attempt = 0;
    const create = vi.fn().mockImplementation((_: unknown, opts?: { signal?: AbortSignal }) => {
      attempt++;
      if (attempt === 1) {
        const err = Object.assign(new Error("Unsupported parameter: 'temperature'"), {
          status: 400,
        });
        return Promise.reject(err);
      }
      // Retry call: hang until aborted.
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const abort = new Error('Request was aborted') as Error & { name: string };
          abort.name = 'AbortError';
          reject(abort);
        });
      });
    });
    const client = makeClient(create as unknown as CreateFn);

    const captured = chatCompletion(
      client,
      { model: 'gpt-z', messages: [], temperature: 0.5 },
      { timeoutMs: 5_000 },
    ).catch(e => e);
    await vi.advanceTimersByTimeAsync(5_001);
    const err = await captured;

    expect(err).toBeInstanceOf(ChatCompletionTimeoutError);
    expect((err as ChatCompletionTimeoutError).timeoutMs).toBe(5_000);
    expect((err as Error).message).toMatch(/timed out/);
    // We DID fire the retry (so the assertion is meaningful):
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('still retries on Unsupported parameter 400 (retry path preserved)', async () => {
    let attempt = 0;
    const create = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        const err = Object.assign(new Error("Unsupported parameter: 'temperature'"), {
          status: 400,
        });
        return Promise.reject(err);
      }
      return Promise.resolve(makeResponse('gpt-z'));
    });
    const client = makeClient(create as unknown as CreateFn);

    const result = await chatCompletion(client, {
      model: 'gpt-z',
      messages: [],
      temperature: 0.5,
    });
    expect(result.model).toBe('gpt-z');
    expect(create).toHaveBeenCalledTimes(2);
    // Retry call should NOT have temperature
    const retryParams = create.mock.calls[1][0] as { temperature?: number };
    expect(retryParams.temperature).toBeUndefined();
  });

  it('rethrows non-timeout, non-retryable errors as-is', async () => {
    const networkErr = Object.assign(new Error('socket hangup'), { code: 'ECONNRESET' });
    const create = vi.fn().mockRejectedValue(networkErr);
    const client = makeClient(create as unknown as CreateFn);

    await expect(
      chatCompletion(client, { model: 'gpt-x', messages: [] }),
    ).rejects.toBe(networkErr);
  });
});
