import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../db/index.js', () => ({ pool: { query } }));
vi.mock('./kit.js', () => ({
  subsetClassTree: vi.fn(async () => new Set(['Q33506', 'Q207694'])),
  subsetSubclasses: vi.fn(async () => []),
  subsetWikipediaEditions: vi.fn(async () => new Map()),
}));

import { compareCached, SHAPES } from './parity.js';

/** The parity harness recognises the cached questions it can ask the subset again (#1458), on query texts the runs cached. */

const shape = (name: string) => SHAPES.find(candidate => candidate.name === name)!;

describe('the questions the parity harness reads back (#1458)', () => {
  it('reads the root of a class tree', () => {
    expect(shape('class tree').asked('SELECT ?c WHERE { ?c wdt:P279* wd:Q33506 }')).toEqual(['Q33506']);
  });

  it('reads the frontier of a subclasses question, and nothing of a class tree', () => {
    expect(shape('subclasses').asked('SELECT DISTINCT ?c WHERE { VALUES ?p { wd:Q113044206 wd:Q860861 } ?c wdt:P279 ?p }'))
      .toEqual(['Q113044206', 'Q860861']);
    expect(shape('subclasses').asked('SELECT ?c WHERE { ?c wdt:P279* wd:Q33506 }')).toBeNull();
  });

  it('reads the items of a Wikipedia editions count, and not of another question over the same items', () => {
    const editions = `SELECT ?e (COUNT(DISTINCT ?article) AS ?editions) WHERE {
        VALUES ?e { wd:Q12418 wd:Q19675 }
        OPTIONAL { ?article schema:about ?e ; schema:isPartOf ?wiki . ?wiki wikibase:wikiGroup "wikipedia" . }
      } GROUP BY ?e`;
    expect(shape('Wikipedia editions').asked(editions)).toEqual(['Q12418', 'Q19675']);
    expect(shape('Wikipedia editions').asked('SELECT ?e ?cls WHERE { VALUES ?e { wd:Q12418 } ?e wdt:P31 ?cls }')).toBeNull();
  });

  it('reads the live answer of a count as one key per item', () => {
    const rows = [{ e: { value: 'http://www.wikidata.org/entity/Q12418' }, editions: { value: '3' } }];
    expect([...shape('Wikipedia editions').live(rows)]).toEqual(['Q12418=3']);
  });
});

describe('the parity comparison (#1458)', () => {
  it('compares the newest questions of a shape up to the limit, reads each answer alone, and counts the rest', async () => {
    const entity = (qid: string) => ({ c: { value: `http://www.wikidata.org/entity/${qid}` } });
    query.mockReset();
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/SELECT id, query_text/.test(sql)) {
        return { rows: [
          { id: 3, query_text: 'SELECT ?c WHERE { ?c wdt:P279* wd:Q33506 }', fetched_at: new Date('2026-10-02T10:00:00Z'), expired: true },
          { id: 2, query_text: 'SELECT ?c WHERE { ?c wdt:P279* wd:Q33506 }', fetched_at: new Date('2026-09-20T10:00:00Z'), expired: true },
          { id: 1, query_text: 'SELECT ?c WHERE { ?c wdt:P279* wd:Q33506 }', fetched_at: new Date('2026-09-01T10:00:00Z'), expired: true },
          { id: 9, query_text: 'SELECT ?x WHERE { ?x wdt:P17 wd:Q213 }', fetched_at: new Date('2026-10-14T10:00:00Z'), expired: false },
        ] };
      }
      const id = (params ?? [])[0];
      return { rows: [{ result: id === 3 ? [entity('Q33506'), entity('Q207694')] : [entity('Q33506')] }] };
    });

    const { reports, notCompared } = await compareCached(2);
    const tree = reports.find(report => report.shape === 'class tree')!;
    expect(tree).toMatchObject({ questions: 2, agreeing: 1, skipped: 1, onlyLive: 0, onlySubset: 1 });
    // Expired answers are compared, and the report says when they were fetched.
    expect(tree).toMatchObject({
      expired: 2, fetchedFrom: new Date('2026-09-20T10:00:00Z'), fetchedTo: new Date('2026-10-02T10:00:00Z'),
    });
    const listing = query.mock.calls.find(([sql]) => /SELECT id, query_text/.test(sql))![0];
    expect(listing).not.toMatch(/expires_at > NOW\(\)/);
    expect(notCompared).toBe(1);
    // The answers of the two compared questions, and of no other.
    const answerReads = query.mock.calls.filter(([sql]) => /WHERE id = \$1/.test(sql)).map(([, params]) => params);
    expect(answerReads).toEqual([[3], [2]]);
  });
});
