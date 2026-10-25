import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRobotsAllow, normalizePath, parseRobots, refreshRobotsForRun, refusesModelInput, rulesAllow, RobotsRefusal,
} from './robotsSignals.js';
import { BOT_PRODUCT_TOKEN } from '../../config/userAgent.js';

/**
 * What a host's robots.txt says to the catalogue's programs (ADR-0148
 * decision 2, #2005). The files are the shapes the hosts serve, with a group
 * for the catalogue's token added where a case needs one.
 */

/** data.unesco.org's file, read on 2026-10-25: Opendatasoft's default. */
const OPENDATASOFT = `User-agent: *
Disallow: /api/
Disallow: /explore/dataset/*/download

User-agent: Googlebot
Allow: /api/
Disallow: /api/explore/v2*/exports/
`;

const fileFetch = (text: string, status = 200) => vi.fn(async () => new Response(text, { status })) as unknown as typeof fetch;
const lines = (file: ReturnType<typeof parseRobots>) => file.signals.map(signal => signal.line);

afterEach(() => {
  refreshRobotsForRun();
  vi.restoreAllMocks();
});

describe('the group that addresses the catalogue', () => {
  it('is none in a file that only speaks to every agent and to Googlebot', () => {
    expect(parseRobots(OPENDATASOFT)).toEqual({ ownRules: null, signals: [] });
  });

  it("is the group naming the catalogue's token, among several agents and whatever the case", () => {
    const file = parseRobots(`User-agent: GPTBot\nUser-agent: ${BOT_PRODUCT_TOKEN.toLowerCase()}\nDisallow: /private/\nAllow: /private/open\n`);
    expect(file.ownRules).toEqual([{ allow: false, path: '/private/' }, { allow: true, path: '/private/open' }]);
  });

  it('keeps consecutive agents in one group across a line that is no rule', () => {
    const file = parseRobots(`User-agent: GPTBot\nSitemap: https://example.org/map.xml\nUser-agent: ${BOT_PRODUCT_TOKEN}\nDisallow: /private\n`);
    expect(file.ownRules).toEqual([{ allow: false, path: '/private' }]);
  });

  it('ends a group at an empty Disallow, so the next agent opens a group of its own', () => {
    const file = parseRobots(`User-agent: ${BOT_PRODUCT_TOKEN}\nDisallow:\n\nUser-agent: *\nDisallow: /\n`);
    expect(file.ownRules).toEqual([]);
  });

  it('applies the longest rule, an allow winning a tie, and wildcards as RFC 9309 reads them', () => {
    const rules = [
      { allow: false, path: '/api/' },
      { allow: true, path: '/api/explore/*/exports/json$' },
      { allow: false, path: '/*.csv$' },
    ];
    expect(rulesAllow(rules, '/api/explore/v2.1/catalog/datasets/whc001/exports/json')).toBe(true);
    expect(rulesAllow(rules, '/api/explore/v2.1/catalog/datasets/whc001/exports/json?select=id_no')).toBe(false);
    expect(rulesAllow(rules, '/api/records')).toBe(false);
    expect(rulesAllow(rules, '/data/list.csv')).toBe(false);
    expect(rulesAllow(rules, '/data/list.csv.gz')).toBe(true);
    expect(rulesAllow([{ allow: false, path: '/a' }, { allow: true, path: '/a' }], '/a')).toBe(true);
    expect(rulesAllow([], '/anything')).toBe(true);
  });

  it('compares a rule and the path called as RFC 9309 encodes them', () => {
    expect(normalizePath('/wiki/Café')).toBe('/wiki/Caf%C3%A9');
    expect(normalizePath('/%70rivate/%2f')).toBe('/private/%2F');
    const own = parseRobots(`User-agent: ${BOT_PRODUCT_TOKEN}\nDisallow: /private\nDisallow: /wiki/Café\n`).ownRules ?? [];
    expect(rulesAllow(own, '/%70rivate/page')).toBe(false);
    expect(rulesAllow(own, '/wiki/Caf%C3%A9')).toBe(false);
    expect(rulesAllow(own, '/wiki/Cafe')).toBe(true);
  });

  it('reads a * or $ in the path called as a character, which a rule names encoded', () => {
    const own = parseRobots(`User-agent: ${BOT_PRODUCT_TOKEN}\nDisallow: /file%2A\nDisallow: /price-%24\n`).ownRules ?? [];
    expect(rulesAllow(own, '/file*')).toBe(false);
    expect(rulesAllow(own, '/file1')).toBe(true);
    expect(rulesAllow(own, '/price-$')).toBe(false);
    expect(rulesAllow([{ allow: false, path: '/file*' }], '/file1')).toBe(false);
  });
});

describe('usage signals', () => {
  it('are those outside any group and those of the group that addresses the catalogue', () => {
    const file = parseRobots('Content-Signal: search=yes\nUser-agent: *\nContent-Signal: ai-train=no\nAllow: /\nContent-Usage: train-ai=n\n\nUser-agent: GPTBot\nContent-Signal: ai-input=no\nDisallow: /\n');
    expect(lines(file)).toEqual(['Content-Signal: search=yes', 'Content-Signal: ai-train=no', 'Content-Usage: train-ai=n']);
  });

  it("are the token's group's alone where a group names the token", () => {
    const file = parseRobots(`User-agent: *\nContent-Signal: ai-input=no\n\nUser-agent: ${BOT_PRODUCT_TOKEN}\nContent-Signal: ai-input=yes\nAllow: /\n`);
    expect(lines(file)).toEqual(['Content-Signal: ai-input=yes']);
  });

  it('refuse a model input only where they say so, never for a refusal of training', () => {
    const of = (text: string) => parseRobots(`User-agent: *\n${text}\n`).signals;
    expect(refusesModelInput(of('Content-Signal: search=yes, ai-train=no'), '/')).toBeNull();
    expect(refusesModelInput(of('Content-Usage: train-ai=n'), '/')).toBeNull();
    expect(refusesModelInput(of('Content-Signal: ai-input=no, search=yes'), '/')).toBe('Content-Signal: ai-input=no, search=yes');
    expect(refusesModelInput(of('Content-Usage: ai-use=n'), '/')).toBe('Content-Usage: ai-use=n');
  });

  it('refuse only the paths a Content-Usage line names', () => {
    const signals = parseRobots('User-agent: *\nContent-Usage: /private/ ai-use=n\n').signals;
    expect(refusesModelInput(signals, '/private/item')).toBe('Content-Usage: /private/ ai-use=n');
    expect(refusesModelInput(signals, '/public/item')).toBeNull();
  });

  it('let the most specific Content-Usage line decide, a permission winning a tie', () => {
    const signals = parseRobots('User-agent: *\nContent-Usage: ai-use=n\nContent-Usage: /public/ ai-use=y\nContent-Usage: /public/ train-ai=n\n').signals;
    expect(refusesModelInput(signals, '/public/page')).toBeNull();
    expect(refusesModelInput(signals, '/private/page')).toBe('Content-Usage: ai-use=n');
    const tie = parseRobots('User-agent: *\nContent-Usage: /a/ ai-use=n\nContent-Usage: /a/ ai-use=y\n').signals;
    expect(refusesModelInput(tie, '/a/b')).toBeNull();
  });
});

describe('a call to a documented endpoint', () => {
  const EXPORT = 'https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/exports/json';

  it('goes on where the file only closes the path to every agent', async () => {
    await expect(assertRobotsAllow(EXPORT, { fetchImpl: fileFetch(OPENDATASOFT) })).resolves.toBeUndefined();
  });

  it("stops where a group naming the catalogue's token disallows the path", async () => {
    const fetchImpl = fileFetch(`${OPENDATASOFT}\nUser-agent: ${BOT_PRODUCT_TOKEN}\nDisallow: /api/\n`);
    await expect(assertRobotsAllow(EXPORT, { fetchImpl })).rejects.toThrow(RobotsRefusal);
    await expect(assertRobotsAllow(EXPORT, { fetchImpl })).rejects.toThrow('data.unesco.org refuses this call');
  });

  it('stops a model input on a refusing signal, and lets the same call through when nothing reaches a model', async () => {
    const fetchImpl = fileFetch('User-agent: *\nContent-Signal: ai-input=no\nAllow: /\n');
    await expect(assertRobotsAllow(EXPORT, { fetchImpl, modelInput: true })).rejects.toThrow('reaches a model');
    await expect(assertRobotsAllow(EXPORT, { fetchImpl })).resolves.toBeUndefined();
  });

  it('goes on where the file is missing or cannot be read, and asks an unread file again soon', async () => {
    await expect(assertRobotsAllow(EXPORT, { fetchImpl: fileFetch('', 404) })).resolves.toBeUndefined();
    refreshRobotsForRun();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const unavailable = fileFetch('', 503);
      await expect(assertRobotsAllow(EXPORT, { fetchImpl: unavailable })).resolves.toBeUndefined();
      await assertRobotsAllow(EXPORT, { fetchImpl: unavailable });
      expect(unavailable).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await assertRobotsAllow(EXPORT, { fetchImpl: unavailable });
      expect(unavailable).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
    refreshRobotsForRun();
    const failing = vi.fn(async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
    await expect(assertRobotsAllow(EXPORT, { fetchImpl: failing })).resolves.toBeUndefined();
  });

  it('reads the file once per host, shared by calls that arrive together, under the bot User-Agent', async () => {
    const fetchImpl = fileFetch(OPENDATASOFT);
    await Promise.all([assertRobotsAllow(EXPORT, { fetchImpl }), assertRobotsAllow(`${EXPORT}?select=id_no`, { fetchImpl })]);
    await assertRobotsAllow(EXPORT, { fetchImpl });
    expect(vi.mocked(fetchImpl).mock.calls.map(([input]) => String(input))).toEqual(['https://data.unesco.org/robots.txt']);
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(String((init.headers as Record<string, string>)['User-Agent']).startsWith(`${BOT_PRODUCT_TOKEN}/`)).toBe(true);
  });

  it('reads the file again once a new run starts', async () => {
    const fetchImpl = fileFetch(OPENDATASOFT);
    await assertRobotsAllow(EXPORT, { fetchImpl });
    refreshRobotsForRun();
    await assertRobotsAllow(EXPORT, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reads nothing when the lane turns the check off, unless handed a fetch of its own', async () => {
    const before = process.env.ROBOTS_CHECK;
    process.env.ROBOTS_CHECK = 'off';
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      await assertRobotsAllow(EXPORT);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.env.ROBOTS_CHECK = before;
    }
  });
});

describe('a refusal inside a retried read', () => {
  it('ends the read at once, with its reason, and is never retried', async () => {
    const { withRetries, RetrySignal, WaitBudget } = await import('../sync/sourceRetry.js');
    const attempt = vi.fn(async () => { throw new RobotsRefusal('example.org', 'its robots.txt disallows /api/'); });
    const classify = vi.fn(() => new RetrySignal(0, 'busy'));
    await expect(withRetries(attempt, { logPrefix: '[test]', retries: 3, budget: new WaitBudget(60000), classify }))
      .rejects.toThrow('example.org refuses this call');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(classify).not.toHaveBeenCalled();
  });
});
