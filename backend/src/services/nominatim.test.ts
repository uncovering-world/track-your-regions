/**
 * The one door to Nominatim holds its usage policy for the whole process:
 * one request a second whoever asks, an answer kept rather than asked for
 * again, and no retry after a refusal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Nominatim from './nominatim.js';

const fetchMock = vi.fn();
let searchNominatim: typeof Nominatim.searchNominatim;
let NominatimError: typeof Nominatim.NominatimError;

const KREMLIN = { display_name: 'Kazan Kremlin', lat: '55.7990218', lon: '49.1061691' };
const answer = (places: unknown[]) => ({ ok: true, status: 200, json: async () => places });
const options = { limit: 1, userAgent: 'nominatim-spec' };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // The queue and the cache are the process's: each spec loads them afresh.
  vi.resetModules();
  ({ searchNominatim, NominatimError } = await import('./nominatim.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('searchNominatim', () => {
  it('sends two callers\' searches one at a time, more than a second apart', async () => {
    const starts: number[] = [];
    fetchMock.mockImplementation(async () => { starts.push(Date.now()); return answer([KREMLIN]); });

    const both = Promise.all([
      searchNominatim('Kazan Kremlin', options),
      searchNominatim('Petra, Jordan', options),
    ]);
    await vi.runAllTimersAsync();
    await both;

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  });

  it('answers the same question again from its cache, folding case and spaces', async () => {
    fetchMock.mockResolvedValue(answer([KREMLIN]));

    const first = searchNominatim('Kazan Kremlin', options);
    await vi.runAllTimersAsync();
    await first;
    const again = await searchNominatim('  kazan   KREMLIN ', options);

    expect(again).toEqual([KREMLIN]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again once the cached answer is a day old', async () => {
    fetchMock.mockResolvedValue(answer([KREMLIN]));

    const first = searchNominatim('Kazan Kremlin', options);
    await vi.runAllTimersAsync();
    await first;
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    const again = searchNominatim('Kazan Kremlin', options);
    await vi.runAllTimersAsync();
    await again;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not ask again after a refusal, and caches nothing for it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => [] });

    const refused = searchNominatim('Kazan Kremlin', options).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(await refused).toBeInstanceOf(NominatimError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets a caller whose deadline passes while it queues give up at once, without the next starting early', async () => {
    const starts: number[] = [];
    fetchMock.mockImplementation(async () => {
      starts.push(Date.now());
      await new Promise((resolve) => { setTimeout(resolve, 8000); });
      return answer([KREMLIN]);
    });

    const first = searchNominatim('Kazan Kremlin', options);
    const deadline = new AbortController();
    setTimeout(() => deadline.abort(new Error('the curator gave up')), 2000);
    const second = searchNominatim('Petra, Jordan', { ...options, signal: deadline.signal }).catch((e: unknown) => e);
    const third = searchNominatim('Hampi, India', options);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await Promise.race([second, Promise.resolve('still queued')])).not.toBe('still queued');
    expect(starts).toHaveLength(1);

    await vi.runAllTimersAsync();
    await Promise.all([first, third]);
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(8000);
  });

  it('gives up a request Nominatim never answers, so it does not hold the queue', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));

    const stalled = searchNominatim('Kazan Kremlin', options).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(16_000);

    expect(await Promise.race([stalled, Promise.resolve('still waiting')])).not.toBe('still waiting');
  });

  it('takes no slot for a question the cache answers by the time its turn comes', async () => {
    const starts: number[] = [];
    fetchMock.mockImplementation(async () => { starts.push(Date.now()); return answer([KREMLIN]); });

    const all = Promise.all([
      searchNominatim('Kazan Kremlin', options),
      searchNominatim('Kazan Kremlin', options),
      searchNominatim('Petra, Jordan', options),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeLessThan(2 * 1100);
  });
});
