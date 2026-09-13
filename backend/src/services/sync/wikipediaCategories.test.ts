/**
 * Tests for the English Wikipedia category door.
 *
 * What these pin is the trip back: the API is asked about the title a caller
 * holds and answers about whatever title that one redirects or normalises to,
 * so a category read under the wrong key is a museum the archaeology rule
 * cannot see. The rest is the two ways a batch can quietly become nothing —
 * an answer that carries only half the categories and asks to be asked again,
 * and a batch the API refuses outright.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWikipediaCategories, enwikiTitleOf } from './wikipediaCategories.js';
import { WaitBudget, type SourceWait } from './sourceRetry.js';

const answer = (pages: Record<string, string[]>) => async () => new Response(JSON.stringify({
  query: { pages: Object.fromEntries(Object.entries(pages).map(([title, cats], i) => [
    String(i + 1), { pageid: i + 1, title, categories: cats.map((c) => ({ ns: 14, title: `Category:${c}` })) },
  ])) },
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('fetchWikipediaCategories', () => {
  it('returns each title’s categories without the prefix', async () => {
    const got = await fetchWikipediaCategories(['Louvre'], {
      userAgent: 'test', fetchImpl: answer({ Louvre: ['Archaeological museums in France', 'Museums in Paris'] }),
    });
    expect(got.get('Louvre')).toEqual(['Archaeological museums in France', 'Museums in Paris']);
  });
  it('follows a redirected title back to the one asked for', async () => {
    // The API answers under the target title and lists the redirect in query.redirects.
    const fetchImpl = async () => new Response(JSON.stringify({
      query: {
        redirects: [{ from: 'British Museum (London)', to: 'British Museum' }],
        pages: { '1': { title: 'British Museum', categories: [{ ns: 14, title: 'Category:Archaeological museums in London' }] } },
      },
    }), { status: 200 });
    const got = await fetchWikipediaCategories(['British Museum (London)'], { userAgent: 'test', fetchImpl });
    expect(got.get('British Museum (London)')).toEqual(['Archaeological museums in London']);
  });
  it('reads a title off an enwiki URL and nothing off another wiki', () => {
    expect(enwikiTitleOf('https://en.wikipedia.org/wiki/Mus%C3%A9e_Carnavalet')).toBe('Musée Carnavalet');
    expect(enwikiTitleOf('https://fr.wikipedia.org/wiki/Louvre')).toBeNull();
  });

  it('follows a normalised title back, and a normalisation a redirect then moves again', async () => {
    // Underscores and the capital first letter are the API's own doing, and it
    // reports them separately from a redirect — a title can go through both.
    const fetchImpl = async () => new Response(JSON.stringify({
      query: {
        normalized: [{ from: 'british_museum', to: 'British museum' }],
        redirects: [{ from: 'British museum', to: 'British Museum' }],
        pages: [{ title: 'British Museum', categories: [{ ns: 14, title: 'Category:Archaeological museums in London' }] }],
      },
    }), { status: 200 });
    const got = await fetchWikipediaCategories(['british_museum'], { userAgent: 'test', fetchImpl });
    expect(got.get('british_museum')).toEqual(['Archaeological museums in London']);
  });

  it('keeps asking while the answer carries a continuation', async () => {
    // A museum with more categories than one answer holds: the second half
    // arrives only if `clcontinue` is sent back, and it belongs to the same title.
    const answers = [
      new Response(JSON.stringify({
        continue: { clcontinue: '1|Museums_in_Paris', continue: '||' },
        query: { pages: [{ title: 'Louvre', categories: [{ ns: 14, title: 'Category:Archaeological museums in France' }] }] },
      }), { status: 200 }),
      new Response(JSON.stringify({
        query: { pages: [{ title: 'Louvre', categories: [{ ns: 14, title: 'Category:Museums in Paris' }] }] },
      }), { status: 200 }),
    ];
    const sent: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(String(init?.body));
      return answers.shift() as Response;
    };
    const got = await fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl });
    expect(got.get('Louvre')).toEqual(['Archaeological museums in France', 'Museums in Paris']);
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toContain('clcontinue');
    expect(sent[1]).toContain('clcontinue=1%7CMuseums_in_Paris');
  });

  it('gives both asked titles the categories when they are one article', async () => {
    // The API answers once for two names of the same museum. A map that kept
    // one name would leave the other reading as a museum with no categories,
    // which is a museum the archaeology rule refuses.
    const fetchImpl = async () => new Response(JSON.stringify({
      query: {
        normalized: [{ from: 'British_Museum', to: 'British Museum' }],
        pages: [{ title: 'British Museum', categories: [{ ns: 14, title: 'Category:Archaeological museums in London' }] }],
      },
    }), { status: 200 });
    const got = await fetchWikipediaCategories(['British_Museum', 'British Museum'], { userAgent: 'test', fetchImpl });
    expect(got.get('British_Museum')).toEqual(['Archaeological museums in London']);
    expect(got.get('British Museum')).toEqual(['Archaeological museums in London']);
  });

  it('keeps a batch that finishes on its last allowed request', async () => {
    // The bound is about a source that will not stop, not about a long batch:
    // an answer carrying no continuation is a batch that finished, and throwing
    // there would lose every category it had just read.
    let asked = 0;
    const fetchImpl: typeof fetch = async () => {
      asked += 1;
      return new Response(JSON.stringify({
        ...(asked < 10 ? { continue: { clcontinue: `page-${asked}` } } : {}),
        query: { pages: [{ title: 'Louvre', categories: [{ ns: 14, title: `Category:Room ${asked}` }] }] },
      }), { status: 200 });
    };
    const got = await fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl });
    expect(asked).toBe(10);
    expect(got.get('Louvre')).toHaveLength(10);
  });

  it('says so rather than filing a page nobody asked about', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = async () => new Response(JSON.stringify({
      query: { pages: [{ title: 'Some Other Museum', categories: [{ ns: 14, title: 'Category:Museums in Paris' }] }] },
    }), { status: 200 });
    const got = await fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl });
    expect(got.get('Louvre')).toEqual([]);
    expect(got.has('Some Other Museum')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Some Other Museum'));
    warn.mockRestore();
  });

  it('stops a source that continues without end, saying which question and after how many asks', async () => {
    // The cap is this run's and not Wikipedia's, and an admin reading a failed
    // run has to be able to tell those apart: "continues without end" alone left
    // them guessing which category, how many asks, and whose limit it was
    // (#887). It is logged as well as thrown, because the walk next door asks
    // one question per category and the log is where the one that would not stop
    // is named among them.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = async () => new Response(JSON.stringify({
      continue: { clcontinue: 'always' },
      query: { pages: [{ title: 'Louvre', categories: [{ ns: 14, title: 'Category:Museums in Paris' }] }] },
    }), { status: 200 });

    await expect(fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl }))
      .rejects.toThrow(/"Louvre" still continues after 10 asks, this run's cap/);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("still continues after 10 asks"));
    log.mockRestore();
  });

  it('gives a page the API does not have an empty list', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      query: { pages: [{ title: 'No Such Museum', missing: true }] },
    }), { status: 200 });
    const got = await fetchWikipediaCategories(['No Such Museum'], { userAgent: 'test', fetchImpl });
    expect(got.get('No Such Museum')).toEqual([]);
  });

  it('throws, naming the batch, when the API refuses it', async () => {
    // Never swallowed: a museum with no categories is one the rule refuses, so
    // a lost batch would read as a shelf of museums that are not archaeological.
    const fetchImpl = async () => new Response('not today', { status: 400 });
    await expect(fetchWikipediaCategories(['British Museum', 'Louvre'], { userAgent: 'test', fetchImpl }))
      .rejects.toThrow(/British Museum/);
  });

  it('throws when a 200 carries the API’s own refusal', async () => {
    // The Action API says no inside a 200. Read as an answer it is a batch of
    // museums with no categories, which is a batch of museums the rule refuses.
    const fetchImpl = async () => new Response(JSON.stringify({
      error: { code: 'toomanyvalues', info: 'Too many values supplied for parameter "titles".' },
    }), { status: 200 });
    await expect(fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl }))
      .rejects.toThrow(/toomanyvalues.*Too many values/s);
  });

  it('throws when a 200 carries no query at all', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ batchcomplete: true }), { status: 200 });
    await expect(fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl }))
      .rejects.toThrow(/without a query/);
  });

  it('asks the right endpoint, the right way, and says who is asking', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ query: { pages: [] } }), { status: 200 });
    };
    await fetchWikipediaCategories(['Louvre'], { userAgent: 'a-caller/1.0 (contact@example.org)', fetchImpl });

    expect(seen?.url).toBe('https://en.wikipedia.org/w/api.php');
    expect(seen?.init?.method).toBe('POST');
    const body = new URLSearchParams(String(seen?.init?.body));
    expect(body.get('clshow')).toBe('!hidden');
    expect(body.get('formatversion')).toBe('2');
    expect(body.get('titles')).toBe('Louvre');
    expect((seen?.init?.headers as Record<string, string>)['User-Agent'])
      .toBe('a-caller/1.0 (contact@example.org)');
  });

  it('throws when the answer is not JSON', async () => {
    const fetchImpl = async () => new Response('<html>Wikimedia is having a moment</html>', { status: 200 });
    await expect(fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl }))
      .rejects.toThrow(/Louvre/);
  });

  it('asks in batches of fifty', async () => {
    const titles = Array.from({ length: 51 }, (_, i) => `Museum ${i + 1}`);
    const asked: number[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      asked.push(new URLSearchParams(String(init?.body)).get('titles')?.split('|').length ?? 0);
      return new Response(JSON.stringify({ query: { pages: [] } }), { status: 200 });
    };
    await fetchWikipediaCategories(titles, { userAgent: 'test', fetchImpl });
    expect(asked).toEqual([50, 1]);
  });
});

/**
 * The retry path, on fake timers so the backoff costs nothing — the shape
 * `imageCredit.test.ts` uses for the same reason.
 */
describe('when Wikipedia is having a bad day', () => {
  afterEach(() => { vi.useRealTimers(); });

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

  it('waits out a 503 and takes the answer that follows', async () => {
    vi.useFakeTimers();
    const answers = [
      new Response('the servers are busy', { status: 503, headers: { 'retry-after': '0' } }),
      new Response(JSON.stringify({
        query: { pages: [{ title: 'Louvre', categories: [{ ns: 14, title: 'Category:Archaeological museums in France' }] }] },
      }), { status: 200 }),
    ];
    const fetchImpl: typeof fetch = async () => answers.shift() as Response;

    const got = await runWithTimers(
      fetchWikipediaCategories(['Louvre'], { userAgent: 'test', fetchImpl }),
    );

    expect(got.get('Louvre')).toEqual(['Archaeological museums in France']);
    expect(answers).toHaveLength(0);
  });

  it('says it is waiting, so the panel does not read as a stuck run', async () => {
    // A 429 with a `Retry-After` is a wait a person is watching, and without
    // this the run went on showing its last phase line for the whole of it
    // (#886). The shape is the Wikidata door's, so one run has one vocabulary
    // for waiting.
    vi.useFakeTimers();
    const answers = [
      new Response('too many requests', { status: 429, headers: { 'retry-after': '0' } }),
      new Response(JSON.stringify({
        query: { pages: [{ title: 'Louvre', categories: [] }] },
      }), { status: 200 }),
    ];
    const fetchImpl: typeof fetch = async () => answers.shift() as Response;
    const waits: SourceWait[] = [];

    await runWithTimers(fetchWikipediaCategories(['Louvre'], {
      userAgent: 'test', fetchImpl, onWait: (wait) => waits.push(wait),
    }));

    expect(waits).toHaveLength(1);
    expect(waits[0].reason).toContain('429');
  });

  it('spends the run\'s patience rather than minting its own', async () => {
    // One budget for the whole run, Wikidata's waits and Wikipedia's together:
    // a budget per call let a run wait far longer in total than the number any
    // one of them was held to (#886). Read off the object the caller handed in,
    // because that is the only thing that says the two doors share it.
    vi.useFakeTimers();
    const answers = [
      new Response('too many requests', { status: 429, headers: { 'retry-after': '30' } }),
      new Response(JSON.stringify({
        query: { pages: [{ title: 'Louvre', categories: [] }] },
      }), { status: 200 }),
    ];
    const fetchImpl: typeof fetch = async () => answers.shift() as Response;
    const runBudget = new WaitBudget(900000);

    await runWithTimers(fetchWikipediaCategories(['Louvre'], {
      userAgent: 'test', fetchImpl, budget: runBudget,
    }));

    // Thirty seconds of the run's patience gone, not of a budget nobody else
    // can see.
    expect(runBudget.remainingMs).toBe(900000 - 30000);
  });

  it('stops when the run has no patience left, with the reason named', async () => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = async () =>
      new Response('too many requests', { status: 429, headers: { 'retry-after': '600' } });

    await expect(runWithTimers(fetchWikipediaCategories(['Louvre'], {
      userAgent: 'test', fetchImpl, budget: new WaitBudget(1),
    }))).rejects.toThrow(/could not be read/);
  });
});

describe('enwikiTitleOf', () => {
  it('reads nothing off a URL that is not an article, and nothing off nothing', () => {
    expect(enwikiTitleOf(null)).toBeNull();
    expect(enwikiTitleOf('https://en.wikipedia.org/w/index.php?title=Louvre')).toBeNull();
    expect(enwikiTitleOf('not a url at all')).toBeNull();
  });
  it('drops the fragment a section link carries', () => {
    expect(enwikiTitleOf('https://en.wikipedia.org/wiki/British_Museum#History')).toBe('British Museum');
  });
  it('reads an article a row holds without the s, which isStorableHttpUrl allows', () => {
    expect(enwikiTitleOf('http://en.wikipedia.org/wiki/Pergamon_Museum')).toBe('Pergamon Museum');
    expect(enwikiTitleOf('ftp://en.wikipedia.org/wiki/Pergamon_Museum')).toBeNull();
  });
});
