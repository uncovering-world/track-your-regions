/**
 * The OSM door on a fake transport: what it sends, how it waits, and what it
 * refuses to fetch.
 *
 * The query text is asserted rather than the rows alone, because the WKT rule
 * is a rule about *what crosses the wire* — never a city's boundary — and a
 * reader that fetched it and threw it away would satisfy every row assertion
 * while breaking the policy the register record commits to.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  OSM_BATCH, OSM_ENDPOINT, osmBatchQuery, qleverOsmDoor, readOsmObjects, type KeepWkt,
} from './qleverOsm.js';
import type { OsmObject } from './types.js';
import { WaitBudget } from '../sourceRetry.js';
import { userAgent } from '../../../config/userAgent.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const KEEP: KeepWkt = {
  historic: ['archaeological_site', 'ruins'],
  manMade: ['tell'],
  boundary: ['protected_area', 'national_park'],
};

const runner = () => {
  const phases: string[] = [];
  let steps = 0;
  return {
    run: { phase: (m: string) => { phases.push(m); }, step: async () => { steps += 1; } },
    phases,
    stepCount: () => steps,
  };
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

describe('readOsmObjects', () => {
  it('asks in batches of a hundred, pausing before each, and reports the batch', async () => {
    const asked: string[][] = [];
    const send = vi.fn<SparqlFn>(async (query: string) => {
      asked.push([...query.matchAll(/"(Q\d+)"/g)].map((m) => m[1]));
      return [] as SparqlBinding[];
    });
    const qids = Array.from({ length: OSM_BATCH + 5 }, (_, i) => `Q${i + 1}`);
    const { run, phases, stepCount } = runner();

    const answer = await readOsmObjects(send, qids, KEEP, run);

    expect(send).toHaveBeenCalledTimes(2);
    expect(asked[0]).toHaveLength(OSM_BATCH);
    expect(asked[1]).toHaveLength(5);
    expect(stepCount()).toBe(2);
    expect(phases).toEqual([
      'Asking OpenStreetMap what it maps at each site (batch 1/2)...',
      'Asking OpenStreetMap what it maps at each site (batch 2/2)...',
    ]);
    // Every item asked about has an entry: an empty list is "OSM maps nothing
    // carrying this item", and absence would be "nobody asked".
    expect(answer.size).toBe(OSM_BATCH + 5);
    expect(answer.get('Q1')).toEqual([]);
  });

  it('files the answer under the cache kind of its own, with a label a person reads', async () => {
    const send = vi.fn<SparqlFn>(async () => [] as SparqlBinding[]);
    const { run } = runner();
    await readOsmObjects(send, ['Q22647'], KEEP, run);
    expect(send.mock.calls[0][1]).toEqual({
      kind: 'osm', label: 'OSM objects of 1 item',
    });
  });

  it('groups what came back under the item that was asked about', async () => {
    const send = async (): Promise<SparqlBinding[]> => [{
      q: { value: 'Q22647' },
      s: { value: 'https://www.openstreetmap.org/way/423938794' },
      type: { value: 'https://www.openstreetmap.org/way' },
      geomType: { value: 'POLYGON((26.' },
      wkt: { value: 'POLYGON((26.2 39.9,26.3 39.9,26.3 40.0,26.2 39.9))' },
      historic: { value: 'archaeological_site' },
    }];
    const { run } = runner();
    const answer = await readOsmObjects(send, ['Q22647', 'Q1524'], KEEP, run);
    const troy = answer.get('Q22647') as OsmObject[];
    expect(troy[0].ref).toBe('way/423938794');
    expect(troy[0].tags.historic).toBe('archaeological_site');
    expect(answer.get('Q1524')).toEqual([]);
  });

  it('asks nothing at all where the caller has no items', async () => {
    const send = vi.fn<SparqlFn>(async () => [] as SparqlBinding[]);
    const { run } = runner();
    expect(await readOsmObjects(send, [], KEEP, run)).toEqual(new Map());
    expect(send).not.toHaveBeenCalled();
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

  it('POSTs, says what it is, and asks for SPARQL JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => answer([]));
    const progress = { cancel: false, statusMessage: '' };
    const door = qleverOsmDoor(progress, new WaitBudget(60000), '[T]', { fetchImpl });
    await door('SELECT * WHERE {}');

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

    const rows = await runWithTimers(door('SELECT * WHERE {}'));

    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(progress.statusMessage).toContain('OpenStreetMap is not answering (OSM 503)');
    // Spent from the run's patience, not from a budget of its own.
    expect(budget.remainingMs).toBeLessThan(600000);
  });

  it('gives up loudly on a refusal it may not retry', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad query',
    }) as unknown as Response);
    const door = qleverOsmDoor({ cancel: false, statusMessage: '' }, new WaitBudget(60000), '[T]', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(door('SELECT * WHERE {}')).rejects.toThrow(/OpenStreetMap .*400/);
  });
});
