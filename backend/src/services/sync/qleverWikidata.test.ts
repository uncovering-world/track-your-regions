/**
 * Wikidata on QLever is asked with the manners its usage page asks of a
 * client with no published limit: one question at a time, each held back as
 * long as the last took, a refusal never asked again (#1272).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Qlever from './qleverWikidata.js';
import type * as WikidataUtils from './wikidataUtils.js';

const fetchMock = vi.fn();
let qleverWikidataQuery: typeof Qlever.qleverWikidataQuery;
let SparqlUnanswered: typeof WikidataUtils.SparqlUnanswered;

const answer = (bindings: unknown[]) => ({ ok: true, status: 200, json: async () => ({ results: { bindings } }) });
const status = (code: number) => ({ ok: false, status: code, text: async () => 'no', json: async () => ({}) });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // The turn is the process's: each spec loads it afresh.
  vi.resetModules();
  ({ qleverWikidataQuery } = await import('./qleverWikidata.js'));
  ({ SparqlUnanswered } = await import('./wikidataUtils.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('qleverWikidataQuery', () => {
  it('asks one question at a time, the next after a pause as long as the last took', async () => {
    const starts: number[] = [];
    fetchMock.mockImplementation(async () => {
      starts.push(Date.now());
      await new Promise((resolve) => { setTimeout(resolve, 3000); });
      return answer([]);
    });

    const both = Promise.all([qleverWikidataQuery('SELECT 1 {}'), qleverWikidataQuery('SELECT 2 {}')]);
    await vi.runAllTimersAsync();
    await both;

    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(6000);
  });

  it('asks once more after a 5xx, then names the question unanswered', async () => {
    fetchMock.mockResolvedValue(status(503));

    const outcome = qleverWikidataQuery('SELECT * {}').catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(await outcome).toBeInstanceOf(SparqlUnanswered);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never asks again after a refusal', async () => {
    fetchMock.mockResolvedValue(status(429));

    const outcome = qleverWikidataQuery('SELECT * {}').catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SparqlUnanswered);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
