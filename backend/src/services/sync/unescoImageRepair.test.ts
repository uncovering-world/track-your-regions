/**
 * Tests for the World Heritage picture repair — the half of ADR-0043 that
 * writes now rather than proposing.
 *
 * What is pinned is what the repair refuses to do: empty every row because
 * Wikidata did not answer, and write a file the product may not show.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('./unescoWikidata.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./unescoWikidata.js')>()),
  fetchWorldHeritageFacts: vi.fn(),
}));
vi.mock('./imageCredit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./imageCredit.js')>()),
  readStoredCredits: vi.fn(async () => new Map()),
  fetchCommonsCredits: vi.fn(async () => new Map()),
}));

import { pool } from '../../db/index.js';
import { fetchWorldHeritageFacts, indexWorldHeritageFacts } from './unescoWikidata.js';
import { runningSyncs } from './types.js';
import { fixUnescoImages, sitesNeedingAPicture } from './unescoImageRepair.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedFacts = fetchWorldHeritageFacts as unknown as ReturnType<typeof vi.fn>;

const PORTAL = 'https://whc.unesco.org/document/141884';
const ROWS = [
  { id: 311, external_id: '1501', name: 'Antequera Dolmens Site', image_url: PORTAL },
  { id: 126, external_id: '292', name: 'Cologne Cathedral', image_url: PORTAL },
];

/** The statements sent, after the read of the sites. */
const writes = () => mockedQuery.mock.calls.slice(1).map(([sql]) => String(sql));

describe('fixUnescoImages', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedFacts.mockReset();
    runningSyncs.clear();
    mockedQuery.mockResolvedValueOnce({ rows: ROWS });
    mockedQuery.mockResolvedValue({ rowCount: 1 });
  });

  it('stops, with the rows as they were, when Wikidata did not answer', async () => {
    // No answer is not "no pictures": read alike, a bad afternoon at the query
    // service would empty every selected row and report the work complete.
    mockedFacts.mockResolvedValueOnce(null);

    await expect(fixUnescoImages(null)).rejects.toThrow(/Wikidata did not answer/);

    expect(writes()).toEqual([]);
    expect(runningSyncs.get(1)?.status).toBe('failed');
  });

  it('takes a portal picture off a site Wikidata states none for', async () => {
    mockedFacts.mockResolvedValueOnce(indexWorldHeritageFacts([
      { whc: { value: '292' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Dom.jpg' } },
    ]));

    await fixUnescoImages(null);

    const sent = writes();
    expect(sent.filter(sql => sql.includes('image_url = $1'))).toHaveLength(1);
    expect(sent.filter(sql => sql.includes('image_url = NULL'))).toHaveLength(1);
    expect(runningSyncs.get(1)?.statusMessage).toMatch(/1 given a Commons picture, 1 left without one/);
  });

  it('treats a file the product may not show as no picture, not as one', async () => {
    // Wikidata's P18 can carry a PDF; written, the row would be re-selected
    // and re-written on every run.
    mockedFacts.mockResolvedValueOnce(indexWorldHeritageFacts([
      { whc: { value: '292' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Nomination.pdf' } },
    ]));

    await fixUnescoImages(null);

    expect(writes().filter(sql => sql.includes('image_url = $1'))).toHaveLength(0);
    expect(writes().filter(sql => sql.includes('image_url = NULL'))).toHaveLength(2);
  });
});

describe('sitesNeedingAPicture', () => {
  it('selects a row with no picture, or with one the product may not show', () => {
    const rows = [
      { id: 1, external_id: '1', name: 'a', image_url: null },
      { id: 2, external_id: '2', name: 'b', image_url: PORTAL },
      { id: 3, external_id: '3', name: 'c', image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/C.jpg' },
      { id: 4, external_id: '4', name: 'd', image_url: '/images/experiences/unesco/4.jpg' },
    ];

    expect(sitesNeedingAPicture(rows).map(r => r.id)).toEqual([1, 2]);
  });
});
