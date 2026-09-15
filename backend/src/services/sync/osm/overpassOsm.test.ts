/**
 * The Overpass door on a fake transport: the question it sends, what it
 * makes of the answer, and the manners the register record commits to — one
 * request at a time with a pause between, the policy's own waits on a 429
 * and a 504, a runtime error read as "ask again" and never as an empty map.
 *
 * The query text is asserted for the reason the mirror's is: the geometry
 * rule is a rule about what crosses the wire, and only the text shows it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  OVERPASS_ENDPOINT, OVERPASS_PAUSE_MS, OVERPASS_RATE_LIMIT_PAUSE_MS, OVERPASS_QUERY_MAXSIZE_B,
  OVERPASS_QUERY_TIMEOUT_S, OVERPASS_ENUMERATION_TIMEOUT_S, declaredTimeoutMs, overpassBatchQuery, overpassDigsQueries,
  overpassOsmDoor, rowsOf,
} from './overpassOsm.js';
import type { OverpassElement } from './overpassGeometry.js';
import { foldOsmRows, type DigTags, type KeepWkt, type OsmObject } from './types.js';
import { WaitBudget } from '../sourceRetry.js';
import { userAgent } from '../../../config/userAgent.js';

const KEEP: KeepWkt = {
  historic: ['archaeological_site', 'ruins'],
  manMade: ['tell'],
  boundary: ['protected_area', 'national_park'],
};

/** Troy's excavation and Athens' city node, as the answer of 2026-09-14 had them. */
const TROY_WAY: OverpassElement = {
  type: 'way', id: 423938794,
  tags: {
    wikidata: 'Q22647', historic: 'archaeological_site', archaeological_site: 'city',
    boundary: 'protected_area', heritage: '1', name: "Troya'nın Arkeolojik Alanı",
  },
  geometry: [
    { lat: 39.95, lon: 26.23 }, { lat: 39.95, lon: 26.24 }, { lat: 39.96, lon: 26.24 },
    { lat: 39.96, lon: 26.23 }, { lat: 39.95, lon: 26.23 },
  ],
};
const ATHENS_NODE: OverpassElement = {
  type: 'node', id: 441183, tags: { wikidata: 'Q1524', place: 'city', name: 'Αθήνα' },
};

describe('overpassBatchQuery', () => {
  it('asks by the wikidata tag, one exact match per item, and declares its run time and memory', () => {
    const query = overpassBatchQuery(['Q22647', 'Q1524'], KEEP);
    // Both halves of the instance's admission rule, so the server can plan
    // around what the question will cost rather than reserve the defaults.
    expect(query.startsWith(
      `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}][maxsize:${OVERPASS_QUERY_MAXSIZE_B}];`,
    )).toBe(true);
    expect(query).toContain('nwr["wikidata"="Q22647"];');
    expect(query).toContain('nwr["wikidata"="Q1524"];');
    expect(query).not.toContain('"wikidata"~');
  });

  it('sends the geometry only for a ruin or a protected area, never for a city', () => {
    const query = overpassBatchQuery(['Q1524'], KEEP);
    // The whole set that is answered with `out geom`, spelled from the values
    // the caller handed in — the mirror query's five clauses in this
    // language — and `place` cannot appear in it.
    expect(query).toContain(
      '(\n'
      + '  nwr.asked["historic"~"^(archaeological_site|ruins)$"];\n'
      + '  nwr.asked["ruins"]["ruins"!="no"];\n'
      + '  nwr.asked["archaeological_site"]["archaeological_site"!="no"];\n'
      + '  nwr.asked["man_made"~"^(tell)$"];\n'
      + '  nwr.asked["boundary"~"^(protected_area|national_park)$"];\n'
      + ')->.drawn;',
    );
    expect(query).toContain('(.asked; - .drawn;)->.rest;\n.rest out tags;\n.drawn out geom;');
    expect(query).not.toContain('administrative');
  });

  it('leaves out a clause whose list is empty rather than matching the empty value', () => {
    const query = overpassBatchQuery(['Q22647'], { ...KEEP, manMade: [] });
    expect(query).not.toContain('man_made');
  });

  it('refuses anything that is not a QID rather than splicing it into the query', () => {
    expect(() => overpassBatchQuery(['Q1"];out;'], KEEP)).toThrow(/not a Wikidata id/);
    expect(() => overpassBatchQuery(['Q22647'], { ...KEEP, historic: ['a"b'] }))
      .toThrow(/not an OSM tag value/);
  });
});

describe('rowsOf', () => {
  it('answers the rows the mirror would have, which fold to the same objects', () => {
    const into = new Map<string, OsmObject[]>([['Q22647', []], ['Q1524', []]]);
    foldOsmRows(rowsOf([TROY_WAY, ATHENS_NODE]), into);

    const [troy] = into.get('Q22647') as OsmObject[];
    expect(troy.ref).toBe('way/423938794');
    expect(troy.kind).toBe('way');
    expect(troy.tags).toEqual({
      historic: 'archaeological_site', archaeological_site: 'city',
      boundary: 'protected_area', heritage: '1', name: "Troya'nın Arkeolojik Alanı",
    });
    expect(troy.geometryType).toBe('POLYGON');
    expect(troy.wkt).toBe('POLYGON((26.23 39.95,26.24 39.95,26.24 39.96,26.23 39.96,26.23 39.95))');

    const [athens] = into.get('Q1524') as OsmObject[];
    expect(athens.ref).toBe('node/441183');
    expect(athens.tags.place).toBe('city');
    // Tags only: the query's own rule kept the geometry off the wire, and the
    // row says "no geometry" the way the mirror's does — while still saying
    // what the object *is*, as the mirror's `geomType` does for every object
    // whose WKT it does not send. A node is a point whether or not its
    // coordinate came along.
    expect(athens.wkt).toBeNull();
    expect(athens.geometryType).toBe('POINT');
  });

  it('files nothing under an item nobody asked about', () => {
    const into = new Map<string, OsmObject[]>([['Q22647', []]]);
    foldOsmRows(rowsOf([ATHENS_NODE]), into);
    expect(into.size).toBe(1);
    expect(into.get('Q22647')).toEqual([]);
  });
});

describe('overpassOsmDoor', () => {
  afterEach(() => { vi.useRealTimers(); });

  const answer = (elements: OverpassElement[], remark?: string) => ({
    ok: true,
    json: async () => ({ elements, ...(remark ? { remark } : {}) }),
  }) as unknown as Response;

  const refusal = (status: number, retryAfter: string | null = null) => ({
    ok: false, status, headers: { get: () => retryAfter }, text: async () => 'no',
  }) as unknown as Response;

  const progress = () => ({ cancel: false, statusMessage: '' });

  /** The waits on fake timers — `qleverOsm.test.ts`'s shape, for its reason. */
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

  it('is Overpass by name, and phrases its question in Overpass QL', () => {
    const door = overpassOsmDoor(progress(), new WaitBudget(60000));
    expect(door.name).toBe('overpass');
    expect(door.question(['Q22647'], KEEP)).toBe(overpassBatchQuery(['Q22647'], KEEP));
  });

  it('POSTs the query as data, says what it is, and asks for JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => answer([TROY_WAY]));
    const door = overpassOsmDoor(progress(), new WaitBudget(60000), '[T]', { fetchImpl });
    const rows = await door.send('[out:json];out;');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OVERPASS_ENDPOINT);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    // The project's own agent with the bot marker, asked of `userAgent()`
    // rather than spelled here (#864).
    expect(headers['User-Agent']).toBe(userAgent({ bot: true }));
    expect(String(init.body)).toBe('data=%5Bout%3Ajson%5D%3Bout%3B');
    expect(rows).toHaveLength(1);
    expect(rows[0].q?.value).toBe('Q22647');
  });

  it('waits the pause between two questions, measured from the end of the last answer', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => answer([]));
    const door = overpassOsmDoor(progress(), new WaitBudget(60000), '[T]', { fetchImpl });

    await door.send('first');
    // The second question is not sent until the pause has passed.
    const second = door.send('second');
    await vi.advanceTimersByTimeAsync(OVERPASS_PAUSE_MS - 1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await second;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never sends a second question while the first is in flight', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise((resolve) => {
      release = () => resolve(answer([]));
    }));
    const door = overpassOsmDoor(progress(), new WaitBudget(60000), '[T]', { fetchImpl });

    const first = door.send('first');
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    (release as () => void)();
    await first;
    // The pause is counted from the answer, which only just arrived.
    const second = door.send('second');
    await vi.advanceTimersByTimeAsync(OVERPASS_PAUSE_MS - 1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    (release as () => void)();
    await second;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('waits the thirty seconds the policy asks for after a 429 that names no Retry-After', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1 ? refusal(429) : answer([ATHENS_NODE]);
    });
    const budget = new WaitBudget(600000);
    const door = overpassOsmDoor(progress(), budget, '[T]', { fetchImpl });

    const rows = await runWithTimers(door.send('q'));

    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.remainingMs).toBe(600000 - OVERPASS_RATE_LIMIT_PAUSE_MS);
  });

  it('waits what Retry-After says where the server names it', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1 ? refusal(429, '7') : answer([]);
    });
    const budget = new WaitBudget(600000);
    const door = overpassOsmDoor(progress(), budget, '[T]', { fetchImpl });
    await runWithTimers(door.send('q'));
    expect(budget.remainingMs).toBe(600000 - 7000);
  });

  it('waits out a 504 on the run\'s budget and says so on screen', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1 ? refusal(504) : answer([]);
    });
    const shown = progress();
    const budget = new WaitBudget(600000);
    const door = overpassOsmDoor(shown, budget, '[T]', { fetchImpl });

    await runWithTimers(door.send('q'));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(shown.statusMessage).toContain('OpenStreetMap is not answering (Overpass 504)');
    expect(budget.remainingMs).toBeLessThan(600000);
  });

  it('reads a runtime error in a 200 as "ask again", never as an empty map', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1
        ? answer([], 'runtime error: Query timed out in "query" at line 3 after 120 seconds.')
        : answer([TROY_WAY]);
    });
    const door = overpassOsmDoor(progress(), new WaitBudget(600000), '[T]', { fetchImpl });

    const rows = await runWithTimers(door.send('q'));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
  });

  it('gives up loudly on a refusal it may not retry', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => refusal(400));
    const door = overpassOsmDoor(progress(), new WaitBudget(60000), '[T]', { fetchImpl });
    await expect(door.send('q')).rejects.toThrow(/OpenStreetMap .*400/);
  });

  it('gives up loudly on an answer with no elements in it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({
      ok: true, json: async () => ({ version: 0.6 }),
    }) as unknown as Response);
    const door = overpassOsmDoor(progress(), new WaitBudget(60000), '[T]', { fetchImpl });
    await expect(door.send('q')).rejects.toThrow(/without any elements/);
  });
});

describe('overpassDigsQueries', () => {
  const DIGS: DigTags = { historic: ['archaeological_site', 'ruins'], keys: ['archaeological_site', 'ruins'] };

  it('asks one exact-match question per selector, tags only, under the enumeration\'s own budget', () => {
    // A regular expression over `historic` is a scan of every historic
    // object on the planet and timed out at line 4 (2026-09-15); an exact
    // value is an index read. And one selector alone — 26,767 objects,
    // 9.6 MB of tags — ran past the batch budget of 120 s in its print
    // phase, so the enumeration declares a budget of its own and is asked
    // one selector at a time.
    const queries = overpassDigsQueries(DIGS);
    expect(queries).toHaveLength(8);
    for (const query of queries) {
      expect(query).toContain(`[timeout:${OVERPASS_ENUMERATION_TIMEOUT_S}][maxsize:${OVERPASS_QUERY_MAXSIZE_B}]`);
      expect(query).toContain('out tags;');
      expect(query).not.toContain('out geom');
      expect(query).not.toContain('~');
    }
    expect(queries[0]).toContain('nwr["historic"="archaeological_site"]["wikidata"];');
    expect(queries[1]).toContain('nwr["historic"="ruins"]["wikidata"];');
    // A key's presence names a dig or ruins, except where the mapper wrote
    // the opposite: `ruins=no` is left out, as the mirror's form leaves it out.
    expect(queries[2]).toContain('nwr["archaeological_site"]["archaeological_site"!="no"]["wikidata"];');
    expect(queries[3]).toContain('nwr["ruins"]["ruins"!="no"]["wikidata"];');
    expect(queries[4]).toContain('nwr["historic"="archaeological_site"]["wikipedia"][!"wikidata"];');
    expect(queries[7]).toContain('nwr["ruins"]["ruins"!="no"]["wikipedia"][!"wikidata"];');
  });
});

describe('rowsOf, for an object carrying only an article', () => {
  it('carries the article so the enumeration can file the object under it', () => {
    const tumulus: OverpassElement = {
      type: 'way', id: 1069114387, tags: { historic: 'archaeological_site', wikipedia: 'tr:Nemrut Dağı' },
    };
    const [row] = rowsOf([tumulus]);
    expect(row.q).toBeUndefined();
    expect(row.wp?.value).toBe('tr:Nemrut Dağı');
  });
});

describe('declaredTimeoutMs', () => {
  it('waits as long as the question itself declares, plus the door\'s margin', () => {
    // Dry run 135 (2026-09-15): the enumeration declares 600 s and answers in
    // about two minutes, and a door that hung up at the batch's 130 s cut the
    // 9.6 MB body mid-stream — which parsed as "not JSON".
    expect(declaredTimeoutMs(overpassDigsQueries({ historic: ['ruins'], keys: [] })[0]))
      .toBe((OVERPASS_ENUMERATION_TIMEOUT_S + 10) * 1000);
    expect(declaredTimeoutMs(overpassBatchQuery(['Q22647'], KEEP)))
      .toBe((OVERPASS_QUERY_TIMEOUT_S + 10) * 1000);
  });

  it('falls back to the batch budget for a question that declares none', () => {
    expect(declaredTimeoutMs('[out:json];nwr["wikidata"="Q1"];out tags;')).toBe((OVERPASS_QUERY_TIMEOUT_S + 10) * 1000);
  });
});
