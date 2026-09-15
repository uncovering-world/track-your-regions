/**
 * The mirror door on a fake transport: what it sends, how it waits, and what it
 * refuses to fetch.
 *
 * The query text is asserted rather than the rows alone, because the WKT rule
 * is a rule about *what crosses the wire* — never a city's boundary — and a
 * reader that fetched it and threw it away would satisfy every row assertion
 * while breaking the policy the register record commits to.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  OSM_ENDPOINT, OSM_ENUMERATION_TIMEOUT_MS, OSM_TIMEOUT_MS, osmBatchQuery, osmDigsQueries, qleverOsmDoor, questionBudgetMs,
} from './qleverOsm.js';
import type { DigTags, KeepWkt } from './types.js';
import { WaitBudget } from '../sourceRetry.js';
import { userAgent } from '../../../config/userAgent.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const KEEP: KeepWkt = {
  historic: ['archaeological_site', 'ruins'],
  manMade: ['tell'],
  boundary: ['protected_area', 'national_park'],
};

describe('osmBatchQuery', () => {
  it('asks by the wikidata tag, as a literal, for every item of the batch', () => {
    const query = osmBatchQuery(['Q22647', 'Q1524'], KEEP);
    expect(query).toContain('VALUES ?q { "Q22647" "Q1524" }');
    expect(query).toContain('?s osmkey:wikidata ?q');
  });

  it('sends the WKT only for a ruin or a protected area, never for a city', () => {
    const query = osmBatchQuery(['Q1524'], KEEP);
    // The whole guard, spelled from the sets the caller handed in, rather than
    // its parts plus a couple of things it does not say. A `not.toContain` over
    // a spelling nothing would ever produce (`?place) IN`) cannot fail; the
    // expression is what decides what crosses the wire, so the expression is
    // what this asserts, and `place` cannot appear in it.
    expect(query).toContain(
      'BIND(IF(COALESCE(?historic, "") IN ("archaeological_site", "ruins")'
      + ' || BOUND(?ruins) || BOUND(?archaeological_site)'
      + ' || COALESCE(?man_made, "") IN ("tell")'
      + ' || COALESCE(?boundary, "") IN ("protected_area", "national_park")'
      + ', STR(?anyWkt), "") AS ?wkt)',
    );
    expect(query).not.toContain('administrative');
  });

  it('asks every tag the reader knows, and the geometry type of everything', () => {
    const query = osmBatchQuery(['Q22647'], KEEP);
    for (const key of ['historic', 'place', 'archaeological_site', 'ruins', 'heritage',
      'tourism', 'boundary', 'man_made', 'natural', 'name']) {
      expect(query).toContain(`OPTIONAL { ?s osmkey:${key} ?${key} }`);
    }
    expect(query).toContain('BIND(SUBSTR(STR(?anyWkt), 1, 12) AS ?geomType)');
  });

  it('refuses anything that is not a QID rather than splicing it into SPARQL', () => {
    expect(() => osmBatchQuery(['Q1; DROP TABLE'], KEEP)).toThrow(/not a Wikidata id/);
    expect(() => osmBatchQuery(['Q22647'], { ...KEEP, historic: ['a"b'] }))
      .toThrow(/not an OSM tag value/);
  });
});

describe('qleverOsmDoor', () => {
  afterEach(() => { vi.useRealTimers(); });

  const answer = (bindings: SparqlBinding[]) => ({
    ok: true,
    json: async () => ({ results: { bindings } }),
  }) as unknown as Response;

  /**
   * The backoff run on fake timers, so waiting out a 503 costs the suite
   * nothing — `wikipediaCategories.test.ts`'s shape, for its reason: the first
   * backoff is five seconds, which is the whole of vitest's default patience
   * for one test.
   */
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

  it('is the mirror by name, and phrases its question in SPARQL', () => {
    const door = qleverOsmDoor({ cancel: false, statusMessage: '' }, new WaitBudget(60000));
    expect(door.name).toBe('qlever');
    expect(door.question(['Q22647'], KEEP)).toBe(osmBatchQuery(['Q22647'], KEEP));
  });

  it('POSTs, says what it is, and asks for SPARQL JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => answer([]));
    const progress = { cancel: false, statusMessage: '' };
    const door = qleverOsmDoor(progress, new WaitBudget(60000), '[T]', { fetchImpl });
    await door.send('SELECT * WHERE {}');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OSM_ENDPOINT);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/sparql-results+json');
    // The project's own agent, with the bot marker a source run carries. Asked
    // of `userAgent()` rather than spelled here: the string has one home
    // (#864), and `userAgentOneSource.test.ts` is the grep that keeps it there.
    expect(headers['User-Agent']).toBe(userAgent({ bot: true }));
    expect(String(init.body)).toContain('query=SELECT');
  });

  it('waits out a 503 on the run\'s budget and says so on screen', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false, status: 503, headers: { get: () => null }, text: async () => 'busy',
        } as unknown as Response;
      }
      return answer([{ q: { value: 'Q1' } }]);
    });
    const progress = { cancel: false, statusMessage: '' };
    const budget = new WaitBudget(600000);
    const door = qleverOsmDoor(progress, budget, '[T]', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const rows = await runWithTimers(door.send('SELECT * WHERE {}'));

    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(progress.statusMessage).toContain('OpenStreetMap is not answering (OSM 503)');
    // Spent from the run's patience, not from a budget of its own.
    expect(budget.remainingMs).toBeLessThan(600000);
  });

  it('retries a body its own deadline cut, as a timeout rather than as not JSON', async () => {
    // The Overpass door learnt this on dry run 135 and the mirror's kept the
    // bare catch: a 66,417-row enumeration cut mid-stream at the budget is a
    // timeout, retried on the run's patience — not "not JSON" ending the run.
    vi.useFakeTimers();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); },
        } as unknown as Response;
      }
      return answer([{ q: { value: 'Q1' } }]);
    });
    const progress = { cancel: false, statusMessage: '' };
    const door = qleverOsmDoor(progress, new WaitBudget(600000), '[T]', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const rows = await runWithTimers(door.send('SELECT * WHERE {}'));

    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(progress.statusMessage).toContain('OSM timeout');
  });

  it('gives up loudly on a refusal it may not retry', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad query',
    }) as unknown as Response);
    const door = qleverOsmDoor({ cancel: false, statusMessage: '' }, new WaitBudget(60000), '[T]', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(door.send('SELECT * WHERE {}')).rejects.toThrow(/OpenStreetMap .*400/);
  });
});

describe('osmDigsQueries', () => {
  const DIGS: DigTags = { historic: ['archaeological_site', 'ruins'], keys: ['archaeological_site', 'ruins'] };

  it('asks for every object tagged as a dig or as ruins that names an item or an article, in one question', () => {
    const queries = osmDigsQueries(DIGS);
    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query).toContain('osmkey:historic ?historic');
    expect(query).toContain('"archaeological_site", "ruins"');
    expect(query).toContain('osmkey:archaeological_site ?archaeological_site');
    expect(query).toContain('osmkey:ruins ?ruins');
    // A mapper's `no` is the opposite statement and is left out, as the
    // Overpass form leaves it out (`["ruins"!="no"]`): one rule, both doors.
    expect(query).toContain('FILTER(?ruins != "no")');
    expect(query).toContain('FILTER(?archaeological_site != "no")');
    expect(query).toContain('OPTIONAL { ?s osmkey:wikidata ?q }');
    expect(query).toContain('OPTIONAL { ?s osmkey:wikipedia ?wp }');
    expect(query).toContain('FILTER(BOUND(?q) || BOUND(?wp))');
  });

  it('never asks for a geometry: the enumeration is names, not outlines', () => {
    const [query] = osmDigsQueries(DIGS);
    expect(query).not.toContain('geo:asWKT');
    expect(query).not.toContain('?wkt');
  });

  it('refuses a tag value that could mean something to the parser', () => {
    expect(() => osmDigsQueries({ historic: ['ruins"'], keys: [] })).toThrow(/not an OSM tag value/);
  });
});

describe('questionBudgetMs', () => {
  it('gives the enumeration its own budget, declared in the question, and a batch the batch\'s', () => {
    // The heaviest question the mirror is asked — 66,417 rows, minutes on a
    // slow afternoon (2026-09-15) — under the batch's two minutes would be cut
    // and the run ended; this door gives it nine minutes, inside the mirror's
    // own ten so the cut stays ours (Overpass declares 600 s to its instance),
    // in a comment the mirror ignores.
    const DIGS: DigTags = { historic: ['ruins'], keys: ['ruins'] };
    expect(questionBudgetMs(osmDigsQueries(DIGS)[0])).toBe(OSM_ENUMERATION_TIMEOUT_MS);
    expect(questionBudgetMs(osmBatchQuery(['Q22647'], KEEP))).toBe(OSM_TIMEOUT_MS);
    expect(OSM_ENUMERATION_TIMEOUT_MS).toBeGreaterThan(OSM_TIMEOUT_MS);
  });
});
