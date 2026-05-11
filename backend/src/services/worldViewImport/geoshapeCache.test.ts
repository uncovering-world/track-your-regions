import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the DB pool — the rate-limiter helper doesn't touch it, but the module
// imports it at top level.
vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

const FETCH_DELAY_MS = 1500;

async function freshAcquireFetchSlot(): Promise<() => Promise<void>> {
  // Reset module state so each test sees a cold rate limiter.
  vi.resetModules();
  const mod = await import('./geoshapeCache.js');
  return mod.acquireFetchSlot;
}

describe('acquireFetchSlot — concurrency-safe rate limiter (#346)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first slot is acquired immediately (no cold-start delay)', async () => {
    const acquire = await freshAcquireFetchSlot();
    const start = Date.now();
    await acquire();
    expect(Date.now() - start).toBeLessThan(50); // microtask only, no setTimeout
  });

  it('two concurrent calls serialise: second waits FETCH_DELAY_MS after first', async () => {
    const acquire = await freshAcquireFetchSlot();
    const order: number[] = [];

    const p1 = acquire().then(() => order.push(1));
    const p2 = acquire().then(() => order.push(2));

    // Flush microtasks so the first IIFE runs to completion.
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1]);

    // Without advancing time past the delay, second call must NOT have fired.
    // (The race the previous bare-variable form had: both would fire here.)
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS - 1);
    expect(order).toEqual([1]);

    // Cross the delay boundary — second call resolves.
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('N concurrent calls each serialise FETCH_DELAY_MS apart', async () => {
    const acquire = await freshAcquireFetchSlot();
    const order: number[] = [];
    const ps = [1, 2, 3, 4].map(i => acquire().then(() => order.push(i)));

    // First fires on microtask
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1]);

    // Each subsequent call needs an additional FETCH_DELAY_MS
    for (let i = 2; i <= 4; i++) {
      await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
      expect(order).toEqual(Array.from({ length: i }, (_, k) => k + 1));
    }

    await Promise.all(ps);
  });

  it('a call made well after the previous fetch fires immediately (no needless delay)', async () => {
    const acquire = await freshAcquireFetchSlot();
    await acquire();

    // Real-time analogue: a long gap between fetches.
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS * 5);

    // Next call should fire on a microtask, not wait an extra delay.
    let resolved = false;
    const p = acquire().then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    await p;
  });
});
