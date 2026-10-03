/**
 * Tests for the count every fame line reads (ADR-0082): Wikipedia language
 * editions, not every site linking an item.
 *
 * The numbers are the catalogue's own, read on 2026-10-03: *Saint Elizabeth of
 * Portugal* by Zurbarán (Q15943274) has ten sitelinks — eight Wikipedias, a
 * Commons category and an Indonesian Wikiquote page — and entered the works pool
 * at its floor of ten on the strength of the last two.
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchWikipediaEditions, inWikipediaEditions, WIKIPEDIA_EDITIONS_BATCH, type SparqlFn } from './wikidataQueries.js';
import { wikipediaEditionsRows } from './wikipediaEditionsFixture.js';

const ZURBARAN = 'Q15943274';
const SPINARIO = 'Q1187500';
const EDITIONS: Record<string, number> = { [ZURBARAN]: 8, [SPINARIO]: 17 };

const door = (): ReturnType<typeof vi.fn<SparqlFn>> =>
  vi.fn<SparqlFn>(async (query) => wikipediaEditionsRows(query, (qid) => EDITIONS[qid]));

describe('fetchWikipediaEditions', () => {
  it('asks for Wikipedia editions, never every site', async () => {
    const sparql = door();
    await fetchWikipediaEditions(sparql, [ZURBARAN]);

    const query = String(sparql.mock.calls[0][0]);
    expect(query).toContain('wikibase:wikiGroup "wikipedia"');
    expect(query).not.toContain('wikibase:sitelinks');
    // Counted over an OPTIONAL, so an item no Wikipedia writes about is 0, not missing.
    expect(query).toMatch(/OPTIONAL \{[\s\S]*schema:about \?e/);
  });

  it('asks a batch at a time, each id once, and none that is not an id', async () => {
    const sparql = door();
    const qids = Array.from({ length: WIKIPEDIA_EDITIONS_BATCH + 1 }, (_, i) => `Q${i + 1}`);

    await fetchWikipediaEditions(sparql, [...qids, 'Q1', 'not-an-id']);

    expect(sparql).toHaveBeenCalledTimes(2);
  });

  it('steps before every question, where a cancelled run stops', async () => {
    const before = vi.fn(async () => {});
    const qids = Array.from({ length: WIKIPEDIA_EDITIONS_BATCH + 1 }, (_, i) => `Q${i + 1}`);

    await fetchWikipediaEditions(door(), qids, before);

    expect(before).toHaveBeenCalledTimes(2);
  });
});

describe('inWikipediaEditions', () => {
  it('holds a work to the floor by its Wikipedia editions, whatever else links it', async () => {
    // Ten sites, eight Wikipedias: at the works pool's floor of ten it is out.
    const pool = [
      { qid: ZURBARAN, sitelinks: 10 },
      { qid: SPINARIO, sitelinks: 19 },
    ];

    const kept = await inWikipediaEditions(door(), pool, { floor: 10 });

    expect(kept).toEqual([{ qid: SPINARIO, sitelinks: 17 }]);
  });

  it('reads the item a row names where that is not its qid', async () => {
    const holdings = [{ work: SPINARIO, venue: 'Q333906', sitelinks: 19 }];

    const kept = await inWikipediaEditions(door(), holdings, { floor: 10, qidOf: (h) => h.work });

    expect(kept).toEqual([{ work: SPINARIO, venue: 'Q333906', sitelinks: 17 }]);
  });

  it('reads an item the count did not answer for as 0, and asks nothing for no items', async () => {
    const sparql = vi.fn<SparqlFn>(async () => []);
    expect(await inWikipediaEditions(sparql, [{ qid: 'Q1', sitelinks: 40 }])).toEqual([{ qid: 'Q1', sitelinks: 0 }]);

    const idle = vi.fn<SparqlFn>(async () => []);
    expect(await inWikipediaEditions(idle, [])).toEqual([]);
    expect(idle).not.toHaveBeenCalled();
  });
});
