/**
 * The Wikivoyage articles behind a guide's yes (#2520), read for Mantineia
 * (Q1160195), which German and Italian Wikivoyage use, with the pool stood in.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { MOST_GUIDE_ARTICLES } from './guideArticlesController.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceEvidenceRoutes } from '../../routes/experienceEvidenceRoutes.js';

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const MANTINEIA = 'Q1160195';
const CURATOR = { id: 7, role: 'curator' } as Express.User;

/** The pool's answers: the membership's item (none where not shown), whether articles are kept, and the list. */
function poolAnswers({ item, kept = true, articles = [] }: {
  item?: string | null; kept?: boolean; articles?: Array<{ site: string; title: string }>;
}) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('external_id')) return item === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ item }] };
    if (sql.includes('EXISTS (SELECT 1 FROM wikivoyage_articles)')) return { rows: [{ kept }] };
    return { rows: articles };
  });
}

const getGuideArticlesRoute = routeAt(experienceEvidenceRoutes, '/review/guide-articles/:membershipId');

/** The answer on the declared route, the id as the wire sends it: its status and its body. */
async function read(membershipId: unknown = '41') {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await answer(getGuideArticlesRoute, { params: { membershipId }, user: CURATOR }, res);
  return { status: res.status.mock.calls.at(-1)?.[0] ?? 200, body: res.json.mock.calls.at(-1)?.[0] };
}

beforeEach(() => {
  query.mockReset();
});

describe('getGuideArticles', () => {
  it("lists the articles that use the membership's item, each with its edition's language and its own address", async () => {
    poolAnswers({ item: MANTINEIA, articles: [{ site: 'dewikivoyage', title: 'Mantineia' }, { site: 'itwikivoyage', title: 'Mantinea' }] });
    expect(await read()).toEqual({ status: 200, body: {
      item: MANTINEIA,
      articlesKept: true,
      articles: [
        { site: 'dewikivoyage', language: 'de', title: 'Mantineia', url: 'https://de.wikivoyage.org/wiki/Mantineia' },
        { site: 'itwikivoyage', language: 'it', title: 'Mantinea', url: 'https://it.wikivoyage.org/wiki/Mantinea' },
      ],
      truncated: false,
    } });
    const listing = query.mock.calls.find(([sql]) => (sql as string).includes('WHERE item = $1'))!;
    expect(listing[0]).toMatch(/ORDER BY site, title, page_id/);
    expect(listing[1]).toEqual([MANTINEIA, MOST_GUIDE_ARTICLES + 1]);
  });

  it('asks for the membership as the caller may be shown it: offered to readers or in their scope', async () => {
    poolAnswers({ item: MANTINEIA });
    await read('41');
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE m\.id = \$2 AND/);
    expect(sql).toMatch(/curator_assignments/);
    expect(params).toEqual([CURATOR.id, 41, false]);
  });

  it('answers not found for a membership the caller may not be shown, and reads no article', async () => {
    poolAnswers({});
    expect(await read()).toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('says a copy built before the articles were kept apart from one where no article uses the item', async () => {
    poolAnswers({ item: MANTINEIA, kept: false });
    expect(await read()).toMatchObject({ status: 200, body: { articlesKept: false, articles: [] } });
    poolAnswers({ item: MANTINEIA, kept: true });
    expect(await read()).toMatchObject({ status: 200, body: { articlesKept: true, articles: [] } });
  });

  it('lists nothing for a membership whose source knows the place by no item', async () => {
    poolAnswers({ item: 'manual-12' });
    expect(await read()).toEqual({ status: 200, body: { item: null, articlesKept: true, articles: [], truncated: false } });
    expect(query.mock.calls.some(([sql]) => (sql as string).includes('WHERE item = $1'))).toBe(false);
  });

  it('says where more articles use the item than one read lists', async () => {
    const many = Array.from({ length: MOST_GUIDE_ARTICLES + 1 }, (_, i) => ({ site: 'enwikivoyage', title: `Article ${i}` }));
    poolAnswers({ item: MANTINEIA, articles: many });
    const { body } = await read();
    expect(body.articles).toHaveLength(MOST_GUIDE_ARTICLES);
    expect(body.truncated).toBe(true);
  });

  it('says what failed when the copy cannot be read, and shows no raw error', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('external_id')) return { rowCount: 1, rows: [{ item: MANTINEIA }] };
      throw new Error('relation "wikivoyage_articles" does not exist');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await read();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).toContain('Failed to read the Wikivoyage articles');
    expect(JSON.stringify(failed.body)).not.toContain('relation');
  });

  it('refuses a membership id that is no positive whole number before anything is read', async () => {
    await expect(read('abc')).rejects.toThrow();
    await expect(read('0')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
