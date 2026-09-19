/**
 * `fetchPicture` holds every hop of a redirect chain to the picture rule, not
 * only the first request (#706). The chains are Commons' own shape, measured
 * 2026-09-19: `Special:FilePath` → `Special:Redirect/file` → the upload host.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPicture } from './pictureFetch.js';

const FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png';
const REDIRECT = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Algeria_regions_map.png';
const UPLOAD = 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Algeria_regions_map.png';

const redirectTo = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });
const picture = () => new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } });

/** Answer each requested address from a map; anything unlisted is a test failure. */
function stubFetch(answers: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    calls.push(input);
    expect(init?.redirect, 'no hop is followed by fetch itself').toBe('manual');
    const answer = answers[input];
    if (!answer) throw new Error(`unexpected request to ${input}`);
    return answer();
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPicture', () => {
  it("follows Commons' own chain to the file, hop by hop", async () => {
    const calls = stubFetch({
      [FILE_PATH]: () => redirectTo(REDIRECT),
      [REDIRECT]: () => redirectTo(`${UPLOAD}?utm_source=commons.wikimedia.org`, 301),
      [`${UPLOAD}?utm_source=commons.wikimedia.org`]: picture,
    });

    const response = await fetchPicture(FILE_PATH, 'test');

    expect(response?.status).toBe(200);
    expect(calls).toEqual([FILE_PATH, REDIRECT, `${UPLOAD}?utm_source=commons.wikimedia.org`]);
  });

  it('follows a scaled picture to the thumbnail host Commons serves it from', async () => {
    // The Algeria map's own chain with `?width=800`, from the `Location`
    // headers quoted in `urlSafety.ts` (960px is what Commons answers a
    // request for 800: the next standard size, not the width asked for).
    const SIZED = `${FILE_PATH}?width=800`;
    const INDEX = 'https://commons.wikimedia.org/w/index.php?title=Special%3ARedirect%2Ffile%2FAlgeria_regions_map.png&width=800';
    const THUMB = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/Algeria_regions_map.png/960px-Algeria_regions_map.png';
    const calls = stubFetch({
      [SIZED]: () => redirectTo(INDEX),
      [INDEX]: () => redirectTo(THUMB, 301),
      [THUMB]: picture,
    });

    expect((await fetchPicture(SIZED, 'test'))?.status).toBe(200);
    expect(calls).toEqual([SIZED, INDEX, THUMB]);
  });

  it('never starts on the thumbnail host, which only a redirect may reach', async () => {
    const calls = stubFetch({});

    expect(await fetchPicture('https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/A.png/960px-A.png', 'test')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('resolves a relative Location against the hop that sent it', async () => {
    const calls = stubFetch({
      [FILE_PATH]: () => redirectTo('/wiki/Special:Redirect/file/Algeria_regions_map.png'),
      [REDIRECT]: picture,
    });

    expect((await fetchPicture(FILE_PATH, 'test'))?.status).toBe(200);
    expect(calls).toEqual([FILE_PATH, REDIRECT]);
  });

  it('refuses a redirect off the two hosts without requesting it', async () => {
    for (const elsewhere of ['http://127.0.0.1:3001/health', 'https://en.wikipedia.org/x.png', 'https://evil.example/x.png']) {
      const calls = stubFetch({ [FILE_PATH]: () => redirectTo(elsewhere) });

      expect(await fetchPicture(FILE_PATH, 'test'), elsewhere).toBeNull();
      expect(calls, elsewhere).toEqual([FILE_PATH]);
    }
  });

  it('refuses a first address the rule refuses, and requests nothing', async () => {
    const calls = stubFetch({});

    expect(await fetchPicture('http://127.0.0.1:3001/health', 'test')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('gives up on a chain that does not end', async () => {
    const calls = stubFetch({ [FILE_PATH]: () => redirectTo(FILE_PATH) });

    expect(await fetchPicture(FILE_PATH, 'test')).toBeNull();
    expect(calls.length).toBe(6);
  });

  it('returns a non-2xx final answer as it came, for the caller to read', async () => {
    stubFetch({ [FILE_PATH]: () => new Response(null, { status: 404 }) });

    expect((await fetchPicture(FILE_PATH, 'test'))?.status).toBe(404);
  });

  it('treats a 3xx with no Location as the answer rather than a hop', async () => {
    stubFetch({ [FILE_PATH]: () => new Response(null, { status: 304 }) });

    expect((await fetchPicture(FILE_PATH, 'test'))?.status).toBe(304);
  });
});
