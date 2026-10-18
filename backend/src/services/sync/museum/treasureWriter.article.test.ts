import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A work's English article (#1608), as the treasure writer stores it: the URL
 * and a flag saying whether the run asked, resolved through the statement
 * rather than by position, as `treasureWriter.test.ts` resolves the gate.
 */

vi.mock('../../../db/index.js', () => {
  const query = vi.fn();
  return {
    pool: { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) },
    rollbackQuietly: vi.fn(),
  };
});
vi.mock('../curationDecay.js', () => ({ retirePassAfterNewContent: vi.fn() }));
vi.mock('./linkWithdrawal.js', () => ({ reconcileLinks: vi.fn().mockResolvedValue({ returned: [], withdrawn: [] }) }));

import { pool } from '../../../db/index.js';
import { upsertVenueTreasures } from './treasureWriter.js';
import type { ProcessedContent } from '../types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const MONA_LISA: ProcessedContent = {
  externalId: 'Q12418', name: 'Mona Lisa', treasureType: 'painting', artists: ['Leonardo da Vinci'],
  year: 1503, imageUrl: null, sitelinksCount: 140,
};

/** What the upsert of one work bound for the article: the URL, and whether the run asked. */
async function articleSent(offered: Partial<ProcessedContent>): Promise<{ url: unknown; asked: unknown; sql: string }> {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [] });
  mockedQuery.mockResolvedValueOnce({ rows: [] }); // the snapshot of what the works held
  mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Mona Lisa' }] }); // the upsert
  mockedQuery.mockResolvedValueOnce({ rows: [{ treasure_id: 900 }] }); // the link

  await upsertVenueTreasures(77, [{ ...MONA_LISA, ...offered }], { fetched: new Map(), stored: new Map() },
    { syncLogId: 1, withdrawalSkippedReason: null, sourceId: 2 }, []);

  const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
  const flag = Number(/wikipedia_read_at = CASE WHEN \$(\d+)::boolean/.exec(sql)![1]) - 1;
  const url = Number(/NOW\(\), NOW\(\),\s*\$(\d+),/.exec(sql)![1]) - 1;
  return { url: params[url], asked: params[flag], sql };
}

beforeEach(() => mockedQuery.mockReset());

describe("a work's English article", () => {
  it('is stored where the run read one', async () => {
    const sent = await articleSent({ wikipediaUrl: 'https://en.wikipedia.org/wiki/Mona_Lisa' });
    expect({ url: sent.url, asked: sent.asked }).toEqual({ url: 'https://en.wikipedia.org/wiki/Mona_Lisa', asked: true });
  });

  it('is stored as none where the run read the work and found none', async () => {
    const sent = await articleSent({ wikipediaUrl: null });
    expect({ url: sent.url, asked: sent.asked }).toEqual({ url: null, asked: true });
  });

  it("is left as the row holds it where the run did not ask", async () => {
    const sent = await articleSent({});
    expect(sent.asked).toBe(false);
    expect(sent.sql).toContain('ELSE treasures.wikipedia_url END');
    expect(sent.sql).toContain('ELSE treasures.wikipedia_read_at END');
  });
});
