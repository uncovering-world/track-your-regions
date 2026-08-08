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
import { sparqlQuery } from './wikidataUtils.js';

const GOOD_BODY = JSON.stringify({
  results: { bindings: [{ w: { type: 'uri', value: 'http://www.wikidata.org/entity/Q19675' } }] },
});

/** What run 51 received: a raw control character inside a string literal. */
const MALFORMED_BODY = '{"results": {"bindings": [{"label": {"value": "Musee\u0007 du Louvre"}}]}}';

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
    await expect(runWithTimers(sparqlQuery('SELECT * {}', '[Test]', 1)))
      .rejects.toThrow(/Musee/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('names the size of the body it could not parse', async () => {
    fetchMock.mockResolvedValue(ok(MALFORMED_BODY));

    // A plain substring, not a built RegExp: the length interpolates cleanly and
    // a constructed pattern trips the security lint for no benefit here.
    await expect(runWithTimers(sparqlQuery('SELECT * {}', '[Test]', 0)))
      .rejects.toThrow(`${MALFORMED_BODY.length} bytes`);
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
});
