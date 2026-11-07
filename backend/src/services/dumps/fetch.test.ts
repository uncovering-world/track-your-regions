import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Readable } from 'node:stream';

/**
 * A request's timeout bounds the request once it holds one of the host's
 * connections, never the wait for one (#2353): the worker's check of the
 * newest dumps queues behind its own download, which holds all three of
 * dumps.wikimedia.org's connections for hours.
 */

vi.mock('../robots/robotsSignals.js', () => ({ assertRobotsAllow: vi.fn(async () => undefined) }));

const { fetchText, openStream } = await import('./fetch.js');

const HOST = 'https://dumps.wikimedia.org';

/** A download's body that streams until it is torn down. */
const endless = () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }), { status: 200 });

/** An answer that never comes, but gives up when its request is aborted. */
const never = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('a dump host request and its timeout', () => {
  it('waits for a connection a download holds without the wait counting against the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('.bz2') ? endless() : new Response('listing', { status: 200 }))));
    const download = new AbortController();
    const streams: Readable[] = await Promise.all([0, 1, 2].map(i => openStream(`${HOST}/part${i}.bz2`, download.signal)));

    const listing = fetchText(`${HOST}/enwiki/`, undefined, 50);
    let settled = false;
    listing.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(r => setTimeout(r, 200));
    expect(settled).toBe(false);

    for (const stream of streams) stream.destroy();
    await expect(listing).resolves.toBe('listing');
  });

  it('gives a request up once it has its connection and the host does not answer in time', async () => {
    vi.stubGlobal('fetch', vi.fn(never));
    await expect(fetchText(`${HOST}/wikidatawiki/`, undefined, 50)).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
