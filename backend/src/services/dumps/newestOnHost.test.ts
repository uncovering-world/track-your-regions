import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The newest dump the host lists (#1583), learnt by the dump worker at most
 * once a day and kept for the backend to read, which never asks the host
 * itself (#2353). The catalog and the database are mocked.
 */

const resolve = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => new Map<string, { dump: string; newest_date: string | null; asked_at: Date; answered: boolean }>());
vi.mock('./catalog.js', () => ({
  DUMPS: [{ key: 'wikidata-entities' }, { key: 'enwiki-page' }],
  dumpNamed: (key: string) => ({ key, resolve }),
}));
vi.mock('./fetch.js', () => ({ fetchText: vi.fn(), sizeOf: vi.fn() }));
vi.mock('../../db/index.js', () => ({
  pool: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('INSERT')) {
        const [dump, date, askedAt, answered] = params as [string, string | null, Date, boolean];
        rows.set(dump, { dump, newest_date: date, asked_at: askedAt, answered });
        return { rows: [] };
      }
      return { rows: [...rows.values()] };
    }),
  },
}));

const { askDueDumps, newestDump, newestDumps } = await import('./newestOnHost.js');

const DAY = 24 * 60 * 60 * 1000;
const stop = () => new AbortController().signal;

beforeEach(() => {
  resolve.mockReset();
  rows.clear();
});

describe('the newest dump the host lists', () => {
  it('is asked of the host by the worker once a day per dump, and read by the backend from what it kept', async () => {
    resolve.mockResolvedValue({ date: '2026-10-19' });
    expect(await newestDump('wikidata-entities')).toEqual({ date: null, askedAt: null, answered: false });

    await askDueDumps(stop(), () => 0);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(await newestDump('wikidata-entities')).toEqual({ date: '2026-10-19', askedAt: new Date(0), answered: true });

    await askDueDumps(stop(), () => DAY - 1);
    expect(resolve).toHaveBeenCalledTimes(2);
    resolve.mockResolvedValue({ date: '2026-11-02' });
    await askDueDumps(stop(), () => DAY);
    expect(resolve).toHaveBeenCalledTimes(4);
    expect((await newestDumps()).get('enwiki-page')).toMatchObject({ date: '2026-11-02', askedAt: new Date(DAY) });
  });

  it('keeps the date it knew when the host does not answer, and waits a day before asking again', async () => {
    resolve.mockResolvedValue({ date: '2026-10-19' });
    await askDueDumps(stop(), () => 0);
    resolve.mockRejectedValue(new Error('dumps.wikimedia.org answered 503'));
    await askDueDumps(stop(), () => DAY);
    expect(await newestDump('wikidata-entities')).toEqual({ date: '2026-10-19', askedAt: new Date(DAY), answered: false });
    await askDueDumps(stop(), () => DAY + 1);
    expect(resolve).toHaveBeenCalledTimes(4);
  });

  it('records each dump as asked when its own asking starts, not when the pass did', async () => {
    let at = 0;
    resolve.mockImplementation(async () => {
      at += 1000;
      return { date: '2026-10-19' };
    });
    await askDueDumps(stop(), () => at);
    expect((await newestDumps()).get('wikidata-entities')?.askedAt).toEqual(new Date(0));
    expect((await newestDumps()).get('enwiki-page')?.askedAt).toEqual(new Date(1000));
  });

  it('records nothing for an asking the worker was stopped in', async () => {
    const stopping = new AbortController();
    resolve.mockImplementation(async () => {
      stopping.abort();
      throw new Error('aborted');
    });
    await askDueDumps(stopping.signal, () => 0);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(await newestDumps()).toEqual(new Map());
  });
});
