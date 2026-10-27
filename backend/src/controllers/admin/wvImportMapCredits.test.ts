/**
 * The credits of the region map images an admin's dialog draws (#2087): read
 * from Commons the first time and kept, never asked for a file the world view
 * does not hold, and never stored when Commons did not answer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, fetchCommonsCredits } = vi.hoisted(() => ({ query: vi.fn(), fetchCommonsCredits: vi.fn() }));
vi.mock('../../db/index.js', () => ({ pool: { query } }));
vi.mock('../../services/sync/imageCredit.js', () => ({ fetchCommonsCredits }));
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

const mapCredits = routeAt(adminDeclaredRoutes, '/wv-import/matches/:worldViewId/map-credits', 'post');

// Algeria and Mauritania in the development database's Wikivoyage import
// (world view 2), and the maps their Regions sections draw.
const WORLD_VIEW = 2;
const ALGERIA_MAP = 'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png';
const MAURITANIA_MAP = 'https://commons.wikimedia.org/wiki/Special:FilePath/Mauritania_Regions_map.png';
// What Commons' extmetadata gives the Algeria map: a Wikivoyage mapmaker's work.
const FITZGERALD = {
  author: 'Peter Fitzgerald',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  detailsUrl: 'https://commons.wikimedia.org/wiki/File:Algeria_regions_map.png',
};

function holding(rows: Array<{ image_url: string; image_credit: unknown }>) {
  query.mockImplementation(async (sql: string) => {
    if (/SELECT DISTINCT ON/.test(sql)) return { rows };
    return { rows: [], rowCount: 1 };
  });
}

async function call(urls: string[]) {
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  await answerRoute(mapCredits, { params: { worldViewId: String(WORLD_VIEW) }, body: { urls } }, res);
  return { res, body: json.mock.calls[0]?.[0] };
}

function updates(): unknown[][] {
  return query.mock.calls.filter((c) => /UPDATE region_map_images/.test(String(c[0])));
}

beforeEach(() => {
  query.mockReset();
  fetchCommonsCredits.mockReset();
});

describe('the credits of the map images a dialog draws', () => {
  it('answers a stored credit without asking Commons', async () => {
    holding([{ image_url: ALGERIA_MAP, image_credit: FITZGERALD }]);

    const { body } = await call([ALGERIA_MAP]);

    expect(body).toEqual({ credits: [{ url: ALGERIA_MAP, credit: FITZGERALD }] });
    expect(fetchCommonsCredits).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it('reads a credit not read yet from Commons and keeps it on the file\'s rows', async () => {
    holding([{ image_url: ALGERIA_MAP, image_credit: null }]);
    fetchCommonsCredits.mockResolvedValue(new Map([[ALGERIA_MAP, FITZGERALD]]));

    const { body } = await call([ALGERIA_MAP]);

    expect(body).toEqual({ credits: [{ url: ALGERIA_MAP, credit: FITZGERALD }] });
    expect(fetchCommonsCredits).toHaveBeenCalledWith([ALGERIA_MAP], expect.objectContaining({ timeoutMs: 5000 }));
    const [update] = updates();
    expect(JSON.parse(String((update[1] as unknown[])[0]))).toEqual({ [ALGERIA_MAP]: FITZGERALD });
    expect(String(update[0])).toMatch(/image_credit IS NULL/);
  });

  it('answers null and stores nothing where Commons did not answer, so the next draw asks again', async () => {
    holding([{ image_url: MAURITANIA_MAP, image_credit: null }]);
    fetchCommonsCredits.mockResolvedValue(new Map());

    const { body } = await call([MAURITANIA_MAP]);

    expect(body).toEqual({ credits: [{ url: MAURITANIA_MAP, credit: null }] });
    expect(updates()).toHaveLength(0);
  });

  it('leaves out a url no region of the world view holds, and never asks Commons about it', async () => {
    const elsewhere = 'https://commons.wikimedia.org/wiki/Special:FilePath/Not_an_import_map.png';
    holding([{ image_url: ALGERIA_MAP, image_credit: FITZGERALD }]);

    const { body } = await call([ALGERIA_MAP, elsewhere]);

    expect(body).toEqual({ credits: [{ url: ALGERIA_MAP, credit: FITZGERALD }] });
    expect(fetchCommonsCredits).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[1]).toEqual([WORLD_VIEW, [ALGERIA_MAP, elsewhere]]);
  });

  it('answers every candidate a region can hold in one request', async () => {
    // The extraction keeps up to 15 from the Regions section, 15 from the page
    // and the map it picked.
    const candidates = Array.from({ length: 31 }, (_, i) => `https://commons.wikimedia.org/wiki/Special:FilePath/Map_${i}.png`);
    holding(candidates.map((image_url) => ({ image_url, image_credit: FITZGERALD })));

    const { body } = await call(candidates);

    expect(body.credits).toHaveLength(31);
  });

  it('refuses a url that is not an absolute http(s) address', async () => {
    await expect(call(['javascript:alert(1)'])).rejects.toThrow();

    expect(query).not.toHaveBeenCalled();
  });
});
