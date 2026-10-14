import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Switching which Wikidata a source's runs read (#1459): refused for a source the subset cannot answer, stored otherwise. */

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db/index.js', () => ({ pool: db }));

const { setWikidataReader } = await import('./wikidataReaderController.js');

beforeEach(() => db.query.mockReset());

describe('setWikidataReader (#1459)', () => {
  it('refuses the subset for a source that still asks questions it has no answer for', async () => {
    await expect(setWikidataReader({ params: { sourceId: 2 }, body: { reader: 'subset' }, caller: { id: 1 } as Express.User }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('switches Public Art to the subset and answers what is stored', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 3, name: 'Public Art & Monuments', wikidata_reader: 'subset' }] });
    expect(await setWikidataReader({ params: { sourceId: 3 }, body: { reader: 'subset' }, caller: { id: 1 } as Express.User }))
      .toEqual({ sourceId: 3, name: 'Public Art & Monuments', wikidataReader: 'subset' });
  });

  it('lets any source go back to the live service, and 404s an unknown one', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(setWikidataReader({ params: { sourceId: 99 }, body: { reader: 'live' }, caller: { id: 1 } as Express.User })).rejects.toMatchObject({ statusCode: 404 });
  });
});
