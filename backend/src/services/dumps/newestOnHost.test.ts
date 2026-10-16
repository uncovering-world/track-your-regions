import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The newest dump the host lists, asked at most once a day and never waited on (#1583). The catalog is mocked. */

const resolve = vi.hoisted(() => vi.fn());
vi.mock('./catalog.js', () => ({ dumpNamed: (key: string) => ({ key, resolve }) }));
vi.mock('./fetch.js', () => ({ fetchText: vi.fn(), sizeOf: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.resetModules();
  resolve.mockReset();
});

describe('the newest dump the host lists', () => {
  it('answers what it knows at once and asks the host in the background, once a day', async () => {
    const { newestDump } = await import('./newestOnHost.js');
    const newestDumpDate = (key: 'wikidata-entities', now: number) => newestDump(key, now).date;
    resolve.mockResolvedValue({ date: '2026-10-19' });
    expect(newestDumpDate('wikidata-entities', 0)).toBeNull();
    await vi.waitFor(() => expect(newestDumpDate('wikidata-entities', 1)).toBe('2026-10-19'));
    expect(resolve).toHaveBeenCalledTimes(1);

    newestDumpDate('wikidata-entities', DAY - 1);
    expect(resolve).toHaveBeenCalledTimes(1);
    resolve.mockResolvedValue({ date: '2026-11-02' });
    newestDumpDate('wikidata-entities', DAY);
    await vi.waitFor(() => expect(newestDumpDate('wikidata-entities', DAY + 1)).toBe('2026-11-02'));
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('keeps what it knew when the host does not answer, and waits a day before asking again', async () => {
    const { newestDump } = await import('./newestOnHost.js');
    const newestDumpDate = (key: 'wikidata-entities', now: number) => newestDump(key, now).date;
    resolve.mockResolvedValueOnce({ date: '2026-10-19' });
    newestDumpDate('wikidata-entities', 0);
    await vi.waitFor(() => expect(newestDumpDate('wikidata-entities', 1)).toBe('2026-10-19'));
    resolve.mockRejectedValueOnce(new Error('dumps.wikimedia.org answered 503'));
    newestDumpDate('wikidata-entities', DAY);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    await new Promise(r => setTimeout(r, 0));
    expect(newestDumpDate('wikidata-entities', DAY + 1)).toBe('2026-10-19');
    expect(newestDump('wikidata-entities', DAY + 2)).toMatchObject({ answered: false, askedAt: new Date(DAY) });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('says it has not asked yet, rather than that nothing newer is out, right after a start', async () => {
    const { newestDump } = await import('./newestOnHost.js');
    resolve.mockReturnValue(new Promise(() => undefined));
    expect(newestDump('wikidata-entities', 0)).toEqual({ date: null, askedAt: null, answered: false });
  });
});
