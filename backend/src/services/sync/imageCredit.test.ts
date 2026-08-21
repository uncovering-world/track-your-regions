/**
 * Tests for the picture credits.
 *
 * The obligation is the point: CC BY and CC BY-SA, which cover most of the 330
 * Commons files this catalogue shows, ask for exactly one thing — that the
 * author is named. So what these pin is that a name survives the trip out of
 * somebody else's wiki markup, and that a source having a bad day costs a credit
 * line rather than an import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  commonsFileName,
  commonsFilePage,
  creditText,
  creditToWrite,
  fetchCommonsCredits,
} from './imageCredit.js';
import { WaitBudget } from './sourceRetry.js';

const FILE_PATH = 'http://commons.wikimedia.org/wiki/Special:FilePath/Church%20Of%20Our%20Lady%20Bruges.jpg';

function answer(pages: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ query: { pages } }),
    json: async () => ({ query: { pages } }),
    headers: new Headers(),
  } as unknown as Response;
}

function httpError(status: number): Response {
  return {
    ok: false, status, text: async () => 'commons said no', headers: new Headers(),
  } as unknown as Response;
}

const OPTIONS = () => ({ userAgent: 'Test/1.0', budget: new WaitBudget(20000) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if (outcome.error !== undefined) throw outcome.error;
  return outcome.value as T;
}

describe('reading a Commons URL', () => {
  it('finds the file name inside a Special:FilePath URL', () => {
    expect(commonsFileName(FILE_PATH)).toBe('Church Of Our Lady Bruges.jpg');
  });

  it('turns it into the page where the licence is stated', () => {
    // Underscores, not spaces: that is the address the file page actually has,
    // and a credit link that 404s is the same as no credit at all.
    expect(commonsFilePage(FILE_PATH))
      .toBe('https://commons.wikimedia.org/wiki/File:Church_Of_Our_Lady_Bruges.jpg');
  });

  it('says nothing about a URL that is not a Commons file', () => {
    expect(commonsFileName('https://whc.unesco.org/document/119616')).toBeNull();
    expect(commonsFilePage(null)).toBeNull();
  });

  it('checks the host, not just the path', () => {
    // A curator may type this URL now. Matching the path anywhere in the string
    // would have `my-blog.example` asked about on Commons and a real
    // photographer's name printed under somebody else's photograph — the one
    // thing the credit line promises never to do.
    expect(commonsFileName('https://my-blog.example/wiki/Special:FilePath/Mona_Lisa.jpg'))
      .toBeNull();
    expect(commonsFileName('https://commons.wikimedia.org/wiki/File:Mona_Lisa.jpg'))
      .toBeNull();
  });
});

describe('a credit out of wiki markup', () => {
  it('keeps the name and drops the tags', () => {
    const html = '<a rel="nofollow" class="external text" href="https://flickr.com/x">Jane Doe</a>';
    expect(creditText(html)).toBe('Jane Doe');
  });

  it('decodes the entities a wiki field arrives with', () => {
    expect(creditText('Mus&eacute;e &amp; Co')).toBe('Mus&eacute;e & Co');
    expect(creditText('<bdi>A&nbsp;B</bdi>')).toBe('A B');
  });

  it('does not decode its own output back into markup', () => {
    // A chain of replacements re-reads what it wrote: `&amp;lt;` becomes `&lt;`
    // when the ampersand is decoded, and the next pass turns that into `<`. So a
    // page showing the literal text `<b>` came out as the tag this function had
    // just stripped. CodeQL called it (js/double-escaping) on the first run of
    // the branch that introduced it.
    expect(creditText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(creditText('&amp;amp;')).toBe('&amp;');
  });

  it('bounds a template that turned out to be a paragraph', () => {
    const long = creditText(`<p>${'name '.repeat(200)}</p>`);
    expect(long!.length).toBeLessThanOrEqual(201);
    expect(long!.endsWith('…')).toBe(true);
  });

  it('is nothing when there was nothing but markup', () => {
    expect(creditText('<span></span>')).toBeNull();
    expect(creditText(undefined)).toBeNull();
  });
});

describe('what a run writes about the photographer', () => {
  const fetched = { author: 'Fresh', license: 'CC BY 4.0', licenseUrl: null, detailsUrl: null };
  const credit = { author: 'Stored', license: 'CC0', licenseUrl: null, detailsUrl: null };
  const SAME = 'http://commons.wikimedia.org/wiki/Special:FilePath/Same.jpg';
  const OTHER = 'http://commons.wikimedia.org/wiki/Special:FilePath/Other.jpg';
  const stored = { credit, hasCredit: true, imageUrl: SAME, imageClaimed: false };

  it('writes what it just fetched', () => {
    expect(creditToWrite(fetched, stored, SAME)).toEqual({ imageCredit: fetched });
  });

  it('resends the stored credit when it could not fetch one', () => {
    // Resent, not omitted. The upsert writes `EXCLUDED.metadata || <claims>`, so
    // the object a run sends replaces what is stored — a key left out is a key
    // dropped, and one bad Commons batch would strip the photographer's name
    // off every museum in it.
    expect(creditToWrite(undefined, stored, SAME)).toEqual({ imageCredit: credit });
  });

  it('does not carry a credit across to a different photograph', () => {
    // The source changed `wdt:P18` and the Commons batch for the new file
    // failed. Reusing the row's credit here would print the previous
    // photographer's name under a picture they did not take.
    expect(creditToWrite(undefined, stored, OTHER)).toEqual({});
  });

  it('claims nothing where there is neither', () => {
    expect(creditToWrite(undefined, undefined, SAME)).toEqual({});
  });

  it('echoes back what a curator-owned picture already says', () => {
    // The upsert keeps a claimed `image_url`, so a credit written here would
    // describe the source's photograph and sit beside the curator's. Echoing
    // rather than omitting, because the change set compares key by key: an
    // omitted key reads as a removal and files a phantom conflict every run.
    const claimed = { credit, hasCredit: true, imageUrl: SAME, imageClaimed: true };
    expect(creditToWrite(fetched, claimed, SAME)).toEqual({ imageCredit: credit });
  });

  it('echoes a curator-owned picture with no credit as no key', () => {
    const claimed = { credit: null, hasCredit: false, imageUrl: SAME, imageClaimed: true };
    expect(creditToWrite(fetched, claimed, SAME)).toEqual({});
  });

  it('echoes a curator-owned null, so the run files nothing about it', () => {
    // A curator whose Commons lookup failed left `imageCredit: null` unclaimed.
    // Sending the same null keeps the two objects equal; sending nothing would
    // read as a removal.
    const claimed = { credit: null, hasCredit: true, imageUrl: SAME, imageClaimed: true };
    expect(creditToWrite(fetched, claimed, SAME)).toEqual({ imageCredit: null });
  });
});

describe('fetchCommonsCredits', () => {
  const page = {
    title: 'File:Church Of Our Lady Bruges.jpg',
    imageinfo: [{
      extmetadata: {
        Artist: { value: '<a href="https://flickr.com/x">Jane Doe</a>' },
        LicenseShortName: { value: 'CC BY 2.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by/2.0' },
      },
    }],
  };

  it('credits a picture by the URL the caller passed in', async () => {
    fetchMock.mockResolvedValue(answer([page]));

    const credits = await runWithTimers(fetchCommonsCredits([FILE_PATH], OPTIONS()));

    expect(credits.get(FILE_PATH)).toEqual({
      author: 'Jane Doe',
      license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
      detailsUrl: 'https://commons.wikimedia.org/wiki/File:Church_Of_Our_Lady_Bruges.jpg',
    });
  });

  it('asks once for a batch, and says who is asking', async () => {
    fetchMock.mockResolvedValue(answer([page]));

    await runWithTimers(fetchCommonsCredits(
      [FILE_PATH, 'http://commons.wikimedia.org/wiki/Special:FilePath/Other.jpg'],
      OPTIONS(),
    ));

    // One request for both files: 50 titles a time is their documented ceiling,
    // and 330 files in seven requests is the whole point of using it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('titles=');
    expect(decodeURIComponent(url)).toContain('|File:Other.jpg');
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['User-Agent']).toBe('Test/1.0');
  });

  it('never asks about a URL that is not on Commons', async () => {
    const credits = await runWithTimers(
      fetchCommonsCredits(['https://whc.unesco.org/document/119616', null], OPTIONS()),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(credits.size).toBe(0);
  });

  it('loses the credit rather than the import when Commons will not answer', async () => {
    fetchMock.mockResolvedValue(httpError(503));

    const credits = await runWithTimers(fetchCommonsCredits([FILE_PATH], OPTIONS()));

    // A picture with no line under it is a shortcoming; a run that threw away
    // 128 museums because a metadata endpoint was down is a failure.
    expect(credits.size).toBe(0);
  });

  it('stops when the run is cancelled', async () => {
    fetchMock.mockResolvedValue(httpError(503));

    await expect(runWithTimers(fetchCommonsCredits(
      [FILE_PATH],
      { ...OPTIONS(), isCancelled: () => true },
    ))).rejects.toThrow(/cancelled/i);
  });
});
