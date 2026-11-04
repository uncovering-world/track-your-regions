/**
 * The one turn for the Wikimedia Action API (#2352): one request at a time
 * across every caller, a 5 s pause after a slow one, every caller held back by
 * a 429's Retry-After, the read-only promise on a POST and maxlag on unattended
 * work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_API_DEFAULT_HOLD_MS, ACTION_API_GAP_MS, ACTION_API_SLOW_PAUSE_MS, actionApiFetch, holdOf, resetActionApiTurn,
} from './wikimediaApi.js';

const API = 'https://www.wikidata.org/w/api.php';
const answer = (status = 200, headers: Record<string, string> = {}) => new Response('{}', { status, headers });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); resetActionApiTurn(); });
afterEach(() => { vi.useRealTimers(); });

describe('actionApiFetch', () => {
  it('sends one request at a time, whoever the callers are', async () => {
    let inFlight = 0;
    let most = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1; most = Math.max(most, inFlight);
      await new Promise((resolve) => { setTimeout(resolve, 100); });
      inFlight -= 1;
      return answer();
    }) as unknown as typeof fetch;
    const all = Promise.all([1, 2, 3].map(() => actionApiFetch(API, {}, { fetchImpl })));
    await vi.runAllTimersAsync();
    await all;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(most).toBe(1);
  });

  it('waits the short gap after a quick answer and 5 s after a slow one', async () => {
    const starts: number[] = [];
    let slow = true;
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      if (slow) { slow = false; await new Promise((resolve) => { setTimeout(resolve, 1500); }); }
      return answer();
    }) as unknown as typeof fetch;
    const all = Promise.all([1, 2, 3].map(() => actionApiFetch(API, {}, { fetchImpl })));
    await vi.runAllTimersAsync();
    await all;
    expect(starts[1] - starts[0]).toBe(1500 + ACTION_API_SLOW_PAUSE_MS);
    expect(starts[2] - starts[1]).toBe(ACTION_API_GAP_MS);
  });

  it('holds every caller back by a 429\'s Retry-After', async () => {
    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? answer(429, { 'Retry-After': '30' }) : answer();
    }) as unknown as typeof fetch;
    const all = Promise.all([1, 2].map(() => actionApiFetch(API, {}, { fetchImpl })));
    await vi.runAllTimersAsync();
    const [first] = await all;
    expect(first.status).toBe(429);
    expect(starts[1] - starts[0]).toBe(30_000);
  });

  it('promises a POST read writes nothing, and sends maxlag on unattended work only', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { seen.push({ url, init }); return answer(); }) as unknown as typeof fetch;
    const all = Promise.all([
      actionApiFetch(API, { method: 'POST', body: new URLSearchParams({ action: 'query' }) }, { fetchImpl, unattended: true }),
      actionApiFetch(`${API}?action=wbsearchentities`, {}, { fetchImpl }),
    ]);
    await vi.runAllTimersAsync();
    await all;
    expect(new Headers(seen[0].init.headers).get('Promise-Non-Write-API-Action')).toBe('true');
    expect((seen[0].init.body as URLSearchParams).get('maxlag')).toBe('5');
    expect(new Headers(seen[1].init.headers).get('Promise-Non-Write-API-Action')).toBeNull();
    expect(new URL(seen[1].url).searchParams.get('maxlag')).toBeNull();
  });

  it('holds the turn until a slow body has arrived, and counts it as a slow answer', async () => {
    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length > 1) return answer();
      // The headers at once, the body a second and a half later.
      return new Response(new ReadableStream({
        start(controller) {
          setTimeout(() => { controller.enqueue(new TextEncoder().encode('{"slow":true}')); controller.close(); }, 1500);
        },
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const all = Promise.all([1, 2].map(() => actionApiFetch(API, {}, { fetchImpl })));
    await vi.runAllTimersAsync();
    const [first] = await all;
    expect(await first.json()).toEqual({ slow: true });
    expect(starts[1] - starts[0]).toBe(1500 + ACTION_API_SLOW_PAUSE_MS);
  });

  it('stops waiting for the turn when the caller aborts, and sends nothing', async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 10_000); });
      return answer();
    }) as unknown as typeof fetch;
    const first = actionApiFetch(API, {}, { fetchImpl });
    const controller = new AbortController();
    const second = actionApiFetch(API, { signal: controller.signal }, { fetchImpl });
    const refused = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await refused;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await first;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not send a request whose caller was cancelled while it waited', async () => {
    const fetchImpl = vi.fn(async () => answer(429)) as unknown as typeof fetch;
    let cancelled = false;
    await actionApiFetch(API, {}, { fetchImpl });
    const second = actionApiFetch(API, {}, { fetchImpl, isCancelled: () => cancelled });
    const caught = second.catch((error: Error) => error.message);
    cancelled = true;
    await vi.runAllTimersAsync();
    expect(await caught).toBe('Sync cancelled');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('retryHeld', () => {
  it('asks once more after the hold a 429 asked for, for a caller with no retry of its own', async () => {
    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? answer(429, { 'Retry-After': '10' }) : answer();
    }) as unknown as typeof fetch;
    const done = actionApiFetch(API, {}, { fetchImpl, retryHeld: true });
    await vi.runAllTimersAsync();
    expect((await done).status).toBe(200);
    expect(starts[1] - starts[0]).toBe(10_000);
  });
});

describe('timeoutMs', () => {
  it('starts the timer when the turn is given, not while the request waits for it', async () => {
    const armedAt: number[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { armedAt.push(Date.now()); return new AbortController().signal; });
    const slow = vi.fn(async () => { await new Promise((resolve) => { setTimeout(resolve, 1500); }); return answer(); }) as unknown as typeof fetch;
    const quick = vi.fn(async () => answer()) as unknown as typeof fetch;
    // A slow first answer puts the next request 5 s behind its own ask, longer than its 2 s timeout.
    const all = Promise.all([
      actionApiFetch(API, {}, { fetchImpl: slow }),
      actionApiFetch(API, {}, { fetchImpl: quick, timeoutMs: 2000 }),
    ]);
    await vi.runAllTimersAsync();
    await all;
    expect(armedAt).toEqual([1500 + ACTION_API_SLOW_PAUSE_MS]);
    timeout.mockRestore();
  });
});

describe('holdOf', () => {
  it('reads Retry-After in seconds or as a date, and waits 5 s where a 429 names none', () => {
    expect(holdOf(answer(429, { 'Retry-After': '12' }))).toBe(12_000);
    expect(holdOf(answer(429, { 'Retry-After': new Date(60_000).toUTCString() }), 0)).toBe(60_000);
    expect(holdOf(answer(503))).toBe(ACTION_API_DEFAULT_HOLD_MS);
    expect(holdOf(answer(200))).toBe(0);
  });
});
