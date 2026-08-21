/**
 * Tests for the Wikidata SPARQL client's failure handling.
 *
 * The retry classification is the whole of it. A museum run spends fifteen
 * minutes in this function across a few hundred requests, so which failures it
 * rides out and which it gives up on decides whether a run finishes — and the
 * failure that motivated these tests, a body that arrived and would not parse,
 * was in the give-up branch by omission rather than by decision.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sparqlQuery, WaitBudget } from './wikidataUtils.js';

const GOOD_BODY = JSON.stringify({
  results: { bindings: [{ w: { type: 'uri', value: 'http://www.wikidata.org/entity/Q19675' } }] },
});

/**
 * What run 51 received: a raw control character inside a string literal.
 *
 * Deliberately non-ASCII around it. A SPARQL answer is mostly labels in eight
 * languages, so its byte count and its code-unit count are never the same
 * number — and the size in the error message is only useful if it is the one
 * that matches what the server sent.
 */
const MALFORMED_BODY =
  '{"results": {"bindings": [{"label": {"value": "Mus\u00e9e\u0007 du Louvre / \u6771\u4eac\u56fd\u7acb\u535a\u7269\u9928"}}]}}';

function ok(body: string): Response {
  return { ok: true, status: 200, text: async () => body, headers: new Headers() } as unknown as Response;
}

function httpError(status: number): Response {
  return {
    ok: false, status, text: async () => 'upstream said no', headers: new Headers(),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // The backoff is 5s and up. Faking timers keeps the retry paths instant
  // without weakening what they assert.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the query with every pending backoff released as it is scheduled. */
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if (outcome.error !== undefined) throw outcome.error;
  return outcome.value as T;
}

describe('sparqlQuery', () => {
  it('returns the bindings of a good answer without retrying', async () => {
    fetchMock.mockResolvedValue(ok(GOOD_BODY));

    const rows = await runWithTimers(sparqlQuery('SELECT * {}', '[Test]'));

    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a body that will not parse, and succeeds when the next one does', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(MALFORMED_BODY))
      .mockResolvedValueOnce(ok(GOOD_BODY));

    const rows = await runWithTimers(sparqlQuery('SELECT * {}', '[Test]'));

    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on a body that never parses, quoting what arrived', async () => {
    fetchMock.mockResolvedValue(ok(MALFORMED_BODY));

    // Not repaired, and not swallowed: if Wikidata really serves this every
    // time, the run must stop and the message must show the bytes.
    await expect(runWithTimers(sparqlQuery('SELECT * {}', '[Test]', { retries: 1 })))
      .rejects.toThrow(/Mus\u00e9e/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('names the size of the body it could not parse, in bytes and not code units', async () => {
    fetchMock.mockResolvedValue(ok(MALFORMED_BODY));

    // The fixture's two counts differ, which is the point: `String.length` would
    // under-report a body full of non-Latin labels, and the number exists to be
    // compared against what the server said it sent.
    const bytes = Buffer.byteLength(MALFORMED_BODY, 'utf8');
    expect(bytes).toBeGreaterThan(MALFORMED_BODY.length);

    // A plain substring, not a built RegExp: the length interpolates cleanly and
    // a constructed pattern trips the security lint for no benefit here.
    await expect(runWithTimers(sparqlQuery('SELECT * {}', '[Test]', { retries: 0 })))
      .rejects.toThrow(`${bytes} bytes`);
  });

  it('still retries a 502, which is the case the malformed one was modelled on', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(502))
      .mockResolvedValueOnce(ok(GOOD_BODY));

    const rows = await runWithTimers(sparqlQuery('SELECT * {}', '[Test]'));

    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400, which no amount of waiting will fix', async () => {
    fetchMock.mockResolvedValue(httpError(400));

    await expect(runWithTimers(sparqlQuery('SELECT bad {}', '[Test]')))
      .rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks for a deadline the service can honour, not one it clamps', async () => {
    fetchMock.mockResolvedValue(ok(GOOD_BODY));

    await runWithTimers(sparqlQuery('SELECT * {}', '[Test]'));

    // Their hard deadline is 60s and asking above it moves nothing: the query
    // still dies there, but as a *gateway* error that says nothing about what
    // went wrong. Under the ceiling the query engine answers instead.
    const body = String((fetchMock.mock.calls[0][1] as { body: string }).body);
    const asked = Number(/timeout=(\d+)/.exec(body)?.[1]);
    expect(asked).toBeLessThan(60000);
  });

  it('tells a caller it is waiting, so a screen can say so', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(504))
      .mockResolvedValueOnce(ok(GOOD_BODY));
    const waits: Array<{ reason: string; attempt: number; backoffMs: number }> = [];

    await runWithTimers(sparqlQuery('SELECT * {}', '[Test]', { onWait: w => waits.push(w) }));

    // Run 61 spent over a minute in here and the only witness was a container
    // log: from the panel a waiting run and a hung run looked identical.
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ attempt: 1 });
    expect(waits[0].reason).toMatch(/504/);
    expect(waits[0].backoffMs).toBeGreaterThan(0);
  });

  it('stops waiting when the budget is spent, rather than on a fixed count', async () => {
    fetchMock.mockResolvedValue(httpError(503));

    // The distinction the budget exists for: "busy for a minute" is worth
    // riding out, "down" is not, and a count of retries cannot tell them apart
    // because the pauses grow.
    await expect(runWithTimers(sparqlQuery('SELECT * {}', '[Test]')))
      .rejects.toThrow(/min of waiting is spent/);
  });
});

describe('a run that is stopped while it waits', () => {
  it('wakes out of a backoff instead of sleeping through the cancel', async () => {
    fetchMock.mockResolvedValue(httpError(503));
    let cancelled = false;

    const query = sparqlQuery('SELECT * {}', '[Test]', {
      isCancelled: () => cancelled,
      // The first wait is the one under test: a backoff is minutes long now, and
      // a Cancel honoured only when it ends is a button that does nothing for as
      // long as the person is still watching the screen.
      onWait: () => { cancelled = true; },
    });

    await expect(runWithTimers(query)).rejects.toThrow(/cancelled/i);
    // One attempt: the wait was abandoned rather than ridden out, so the service
    // was never asked a second time by a run that had already been stopped.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('spends one budget across the whole run, not one per query', async () => {
    fetchMock.mockResolvedValue(httpError(503));
    const budget = new WaitBudget(20000);

    // Two questions, one patience. Per query, a collection sending a few hundred
    // of them would wait for hours before anything said the source was down.
    await expect(runWithTimers(sparqlQuery('SELECT 1 {}', '[Test]', { budget })))
      .rejects.toThrow(/min of waiting is spent/);
    const first = fetchMock.mock.calls.length;

    await expect(runWithTimers(sparqlQuery('SELECT 2 {}', '[Test]', { budget })))
      .rejects.toThrow(/min of waiting is spent/);
    // The second question inherits what the first left, so it gives up sooner.
    // With a budget of its own it would have retried exactly as long again.
    expect(fetchMock.mock.calls.length - first).toBeLessThan(first);
  });
});
