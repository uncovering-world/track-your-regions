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
  batchTitles,
  commonsFileName,
  commonsFilePage,
  creditFromExtmetadata,
  creditToWrite,
  fetchCommonsCredits,
} from './imageCredit.js';
import { authorText, cleanAuthor, creditText } from './creditAuthor.js';
import { FEARLESS_GIRL, FUJI, IPATIEV, PHUKTAL, VALLICELLA } from './imageCredit.fixtures.js';
import { WaitBudget } from './sourceRetry.js';

const FILE_PATH = 'http://commons.wikimedia.org/wiki/Special:FilePath/Church%20Of%20Our%20Lady%20Bruges.jpg';

function answer(pages: unknown[]): Response {
  return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
}

function httpError(status: number): Response {
  return new Response('commons said no', { status });
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

  it("reads the media host's address of a Commons file, a thumbnail's included", () => {
    // What a browser's "copy image address" gives, and the picture field takes it.
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg')).toBe('Mona Lisa.jpg');
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Mona_Lisa.jpg/330px-Mona_Lisa.jpg'))
      .toBe('Mona Lisa.jpg');
    // Another wiki's own upload is not a Commons file.
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/en/6/6a/Mona_Lisa.jpg')).toBeNull();
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

describe('the author Commons assumed when the uploader named nobody', () => {
  it('names the assumed account and drops the sentence around it', () => {
    // The Sydney Opera House's credit line on the development database, as
    // Commons' Artist field sends it: the account is a link inside the sentence.
    const html = 'No machine-readable author provided. <a href="//commons.wikimedia.org/wiki/User:Roybb95~commonswiki" '
      + 'title="User:Roybb95~commonswiki">Roybb95~commonswiki</a> assumed (based on copyright claims).';
    expect(authorText(html)).toBe('Roybb95~commonswiki');
  });

  it('reduces the plain-text form a stored credit holds the same way', () => {
    expect(authorText('No machine-readable author provided. Azeri assumed (based on copyright claims).'))
      .toBe('Azeri');
  });

  it('names nobody where the sentence names nobody, so the line falls back to the licence', () => {
    expect(authorText('No machine-readable author provided.')).toBeNull();
    expect(authorText('No machine-readable author provided. assumed (based on copyright claims).')).toBeNull();
  });

  it('reduces a credit a run resends without asking Commons again', () => {
    // UNESCO asks only about files new to a row: the stored sentence would
    // otherwise stay under the picture for as long as the row keeps it.
    const stored = {
      credit: {
        author: 'No machine-readable author provided. Roybb95~commonswiki assumed (based on copyright claims).',
        license: 'CC BY-SA 3.0', licenseUrl: null, detailsUrl: null,
      },
      hasCredit: true,
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Sydney%20Opera%20House%20Sails.jpg',
      imageClaimed: false,
    };
    const same = creditToWrite(undefined, stored, stored.imageUrl);
    expect(same.imageCredit?.author).toBe('Roybb95~commonswiki');
    expect(same.imageCredit?.license).toBe('CC BY-SA 3.0');
    // A claimed picture's credit is resent as stored: the upsert keeps it
    // whatever is sent, and a reduced one would read as a change every run.
    const claimed = creditToWrite(undefined, { ...stored, imageClaimed: true }, stored.imageUrl);
    expect(claimed.imageCredit).toBe(stored.credit);
  });

  it('leaves a named author exactly as creditText reads it', () => {
    const html = '<a rel="nofollow" class="external text" href="https://flickr.com/x">Jane Doe</a>';
    expect(authorText(html)).toBe(creditText(html));
    expect(authorText(null)).toBeNull();
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

  it('treats a picture the run may not write as no picture, whatever was fetched for it', () => {
    // A P18 can name a PDF; the writer refuses the url, and a photographer's name
    // beside a frame that will hold nothing is the claim this feature never makes.
    const refused = 'https://commons.wikimedia.org/wiki/Special:FilePath/Nomination.pdf';
    expect(creditToWrite(fetched, stored, refused)).toEqual({});
    expect(creditToWrite(fetched, undefined, 'https://whc.unesco.org/document/141884')).toEqual({});
  });

  it('keeps the curator\'s own credit when the source offers a picture the run may not write', () => {
    // creditToWrite is the one place that sees the claim, which is why the
    // refusal is decided here and not at the writer: dropped there, the resend
    // would read as a removal on every run, for a photograph the row keeps.
    const claimed = { ...stored, imageClaimed: true };
    expect(creditToWrite(fetched, claimed, 'https://commons.wikimedia.org/wiki/Special:FilePath/Nomination.pdf'))
      .toEqual({ imageCredit: credit });
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

/**
 * An author field that is a template rather than a name (#2346).
 *
 * Read off Commons verbatim (`imageCredit.fixtures.ts`): these five reached the
 * line raw before, as the sentence around the name, an e-mail address, the
 * licence's hidden cells, or a tag the input cap cut open.
 */
describe('an author field that is a template, not a name', () => {
  const PAGE = 'https://commons.wikimedia.org/wiki/File:Example.jpg';

  it("reads the photographer's name out of their template, without the e-mail address", () => {
    // Phuktal Monastery: "This Photo was taken by Timothy A. Gonsalves. Feel
    // free to use my photos … send me an email tagooty@yahoo.com …". The
    // initial's full stop is not the sentence's.
    expect(creditFromExtmetadata(PHUKTAL, PAGE).author).toBe('Timothy A. Gonsalves');
  });

  it('reads the name and not the credit line the template asks for around it', () => {
    // The Ipatiev Monastery: "… Please credit this with : Photo : Anton Zelenov in
    // the immediate vicinity of the image." The line says "© Anton Zelenov".
    expect(creditFromExtmetadata(IPATIEV, PAGE).author).toBe('Anton Zelenov');
  });

  it('names nobody where the author field holds only the licence', () => {
    // Mount Fuji: the licence's hidden cells ("Public domain Public domain false
    // false") and then its text; nothing in it is a person.
    const credit = creditFromExtmetadata(FUJI, PAGE);
    expect(credit.author).toBeNull();
    expect(credit.license).toBe('Public domain');
    expect(credit.attributionRequired).toBe(false);
  });

  it('drops a tag the input cap cut open, rather than showing it as text', () => {
    // Santa Maria in Vallicella: a 5.6 kB template, cut at 2 kB inside
    // `<a class="external text" data-mw-original-href=…`.
    const credit = creditFromExtmetadata(VALLICELLA, PAGE);
    expect(credit.author).toBe('Wolfgang Moroder');
    expect(authorText(VALLICELLA.Artist.value)).not.toMatch(/[<>]/);
  });

  it('uses the credit the photographer asked for, without the licence and the address beside it', () => {
    // Fearless Girl's `Attribution`: "C.Suthorn / cc-by-sa-4.0 /
    // commons.wikimedia.org (Note the three necessary links …)". The line names
    // the licence and links the file page itself.
    const credit = creditFromExtmetadata(FEARLESS_GIRL, PAGE);
    expect(credit.author).toBe('C.Suthorn');
    expect(credit.license).toBe('CC BY-SA 4.0');
    expect(credit.attributionRequired).toBe(true);
  });

  it('records whether the licence asks for a credit, and nothing where Commons did not say', () => {
    expect(creditFromExtmetadata(PHUKTAL, PAGE).attributionRequired).toBe(true);
    expect(creditFromExtmetadata({ Artist: { value: 'Jane Doe' } }, PAGE).attributionRequired).toBeNull();
  });

  it('decodes an escaped tag before it strips tags', () => {
    expect(creditText('&lt;a href="https://example.org"&gt;Jane Doe&lt;/a&gt;')).toBe('Jane Doe');
  });

  it('keeps a plain name exactly as it is', () => {
    // The common case, and the one a re-read must leave alone: a changed name
    // is a change the run files.
    for (const name of ['Carl Montgomery', 'Stefan Kühn', 'Dr. Avishai Teicher', 'J. R. R. Tolkien', '江戸村のとくぞう']) {
      expect(cleanAuthor(name)).toBe(name);
    }
    expect(cleanAuthor('Photo credit: Andreas Praefcke')).toBe('Andreas Praefcke');
    expect(cleanAuthor('© Raimond Spekking')).toBe('Raimond Spekking');
  });

  it('cleans a credit stored with the old reading when a run resends it', () => {
    // As the development database held them on 2026-11-04. The UNESCO run asks
    // Commons only about files new to a row, so the stored text is cleaned
    // where it is resent; and once clean it stays as it is.
    const SAME = 'http://commons.wikimedia.org/wiki/Special:FilePath/Same.jpg';
    const stored = (author: string, license = 'CC BY-SA 4.0') => ({
      credit: { author, license, licenseUrl: null, detailsUrl: null },
      hasCredit: true, imageUrl: SAME, imageClaimed: false,
    });
    const resentAuthor = (author: string, license?: string) =>
      creditToWrite(undefined, stored(author, license), SAME).imageCredit?.author;
    expect(resentAuthor('This Photo was taken by Timothy A. Gonsalves . Feel free to use my photos, but please mention '
      + 'me as the author. I would much appreciate if you send me an email tagooty@yahoo.com or write on my talk pa…'))
      .toBe('Timothy A. Gonsalves');
    expect(resentAuthor('This photo was taken by Anton Zelenov . Please credit this with : Photo : Anton Zelenov in the '
      + 'immediate vicinity of the image. If you use one of my photos, please email me (account needed) or leave m…',
    'CC BY-SA 3.0')).toBe('Anton Zelenov');
    expect(resentAuthor('Public domain Public domain false false I, the copyright holder of this work, release this '
      + 'work into the public domain . This applies worldwide. In some countries this may not be legally possible; if…',
    'Public domain')).toBeNull();
    expect(resentAuthor('This Photo was taken by Wolfgang Moroder . Feel free to use my photos, but please mention me as '
      + 'the author and send me a <a class="external text" data-mw-original-href="http://commons.wikimedia.org/w/…',
    'CC BY-SA 3.0')).toBe('Wolfgang Moroder');
    const clean = stored('Michielvd', 'CC BY-SA 3.0');
    expect(creditToWrite(undefined, clean, SAME).imageCredit).toBe(clean.credit);
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
      attributionRequired: null,
    });
  });

  it('asks once for a batch, and says who is asking', async () => {
    fetchMock.mockResolvedValue(answer([page]));

    await runWithTimers(fetchCommonsCredits(
      [FILE_PATH, 'http://commons.wikimedia.org/wiki/Special:FilePath/Other.jpg'],
      OPTIONS(),
    ));

    // One request for both files: 50 titles a time is their documented ceiling,
    // and asking once per file instead is the whole point of not doing that.
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

/**
 * The batch has two ceilings, and only one of them is documented by the API.
 *
 * The count was enough while the files were named after buildings. Artwork files
 * are named after the painting, the painter, the museum and the inventory number,
 * so fifty of those titles can build a query string several kilobytes long — and a
 * request that goes over the URL limit fails as a 414, which this module turns
 * into a batch of silently missing credits rather than an error anybody sees.
 */
describe('how many files one request carries', () => {
  it('closes a batch at fifty names', () => {
    const batches = batchTitles(Array.from({ length: 120 }, (_, i) => `Short ${i}.jpg`));

    expect(batches.map(b => b.length)).toEqual([50, 50, 20]);
  });

  it('closes it earlier when the names are long enough to overrun the URL', () => {
    // Names that encode to roughly 1.5 kB each: four of them are already past
    // the budget, so a batch of fifty is never reached.
    const long = Array.from({ length: 12 }, (_, i) => `${'Ludwig van Beethoven '.repeat(75)}${i}.jpg`);

    const batches = batchTitles(long);

    // The budget itself, not just "more than one batch": a wrong size calculation
    // or a smaller budget also produces several short batches, so counting them
    // proves nothing. Each batch that holds more than one name must fit inside the
    // ceiling **as the request will serialise it** — `URLSearchParams`, which is
    // what `askCommons` uses, and not `encodeURIComponent`, which disagrees with it
    // about `~ ' ! ( )` and about the space.
    const encodedCost = (names: string[]) =>
      new URLSearchParams({ titles: names.map(n => `File:${n}`).join('|') })
        .toString().length - 'titles='.length;
    for (const batch of batches) {
      if (batch.length > 1) expect(encodedCost(batch)).toBeLessThanOrEqual(6000);
    }
    // And it fills them: the next name in line would have overrun, or the batch
    // would have taken it. Without this, a budget of one name per batch passes.
    for (const [i, batch] of batches.entries()) {
      const next = batches[i + 1]?.[0];
      if (next) expect(encodedCost([...batch, next])).toBeGreaterThan(6000);
    }
    expect(batches.length).toBeGreaterThan(1);
    expect(Math.max(...batches.map(b => b.length))).toBeLessThan(50);
    // Every name still asked about, in order, and none dropped for being long.
    expect(batches.flat()).toEqual(long);
  });

  it('measures a name the way the request will send it, not the way a person reads it', () => {
    // Form encoding writes `'` and `(` as three characters where
    // `encodeURIComponent` leaves them as one, so a set of names full of them
    // measured short under the old estimate and built a longer URL than the budget
    // allows. Commons names are full of both — "Rembrandt's", "(cropped)".
    const punctuated = Array.from({ length: 40 }, (_, i) =>
      `${"Rembrandt's (cropped) ~ plate!".repeat(8)}${i}.jpg`);

    const batches = batchTitles(punctuated);

    for (const batch of batches) {
      if (batch.length > 1) {
        const serialised = new URLSearchParams({ titles: batch.map(n => `File:${n}`).join('|') })
          .toString().length - 'titles='.length;
        expect(serialised).toBeLessThanOrEqual(6000);
      }
    }
    expect(batches.flat()).toEqual(punctuated);
  });

  it('asks about a name too long for any batch rather than skipping it', () => {
    // Refusing to ask is a credit certainly missing; asking is one that may yet
    // arrive, and the failure is already handled.
    const monster = `${'x'.repeat(9000)}.jpg`;

    expect(batchTitles([monster, 'Short.jpg'])).toEqual([[monster], ['Short.jpg']]);
  });

  it('has nothing to send when there are no files', () => {
    expect(batchTitles([])).toEqual([]);
  });
});
