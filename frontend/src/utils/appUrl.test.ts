import { describe, expect, it } from 'vitest';
import {
  buildAppUrl,
  buildReviewUrl,
  EMPTY_REVIEW,
  legacyRedirect,
  normaliseReviewQ,
  parseAppUrl,
  parseReviewUrl,
  slugify,
  slugsOf,
  type AppAddress,
  type ReviewAddress,
} from './appUrl';

const MAP_ROOT: AppAddress = { mode: 'map', worldViewId: null, regionId: null, experienceId: null, kindId: null };

/**
 * One grammar for every address the app writes and reads (#644). The path
 * carries what names a resource — the world view, the region, the open card —
 * and the query carries view state a visitor set deliberately: today only
 * Discover's kind. Slugs decorate; ids decide.
 */
describe('parseAppUrl', () => {
  it('reads the map root as the default world view with nothing selected', () => {
    expect(parseAppUrl('/', '')).toEqual(MAP_ROOT);
  });

  it('reads world view, region and experience from the path, ignoring the slugs', () => {
    expect(parseAppUrl('/wv/5/r/6737-europe/e/1234-historic-centre-of-saint-petersburg', '')).toEqual({
      mode: 'map', worldViewId: 5, regionId: 6737, experienceId: 1234, kindId: null,
    });
  });

  it('reads Discover with its kind', () => {
    expect(parseAppUrl('/discover/wv/5/r/7120-france', '?kind=1')).toEqual({
      mode: 'discover', worldViewId: 5, regionId: 7120, experienceId: null, kindId: 1,
    });
    // The parameter was spelled `cat` until #819; a link shared before it still opens the list.
    expect(parseAppUrl('/discover/wv/5/r/7120-france', '?cat=1')).toEqual({
      mode: 'discover', worldViewId: 5, regionId: 7120, experienceId: null, kindId: 1,
    });
  });

  it('answers null for pages that are not places', () => {
    for (const pathname of ['/account', '/admin', '/admin/world-views', '/review', '/auth/callback', '/verify-email']) {
      expect(parseAppUrl(pathname, '')).toBeNull();
    }
  });

  it('treats a segment that does not parse, and everything after it, as absent', () => {
    expect(parseAppUrl('/wv/abc/r/12', '')).toEqual(MAP_ROOT);
    expect(parseAppUrl('/wv/5/r/x/e/9', '')).toEqual({ ...MAP_ROOT, worldViewId: 5 });
    expect(parseAppUrl('/wv/0/r/12', '')).toEqual(MAP_ROOT);
    expect(parseAppUrl('/wv/5/r/-3', '')).toEqual({ ...MAP_ROOT, worldViewId: 5 });
  });

  it('requires the id to end the segment or be followed by its slug', () => {
    // Stricter than `parseInt`, which would read 6737 out of either of these
    // and accept a segment nothing in the app ever wrote.
    expect(parseAppUrl('/wv/5/r/6737europe', '')).toEqual({ ...MAP_ROOT, worldViewId: 5 });
    expect(parseAppUrl('/wv/5/r/europe-6737', '')).toEqual({ ...MAP_ROOT, worldViewId: 5 });
    expect(parseAppUrl('/wv/5/r/6737-europe', '')).toEqual({ ...MAP_ROOT, worldViewId: 5, regionId: 6737 });
  });

  it('needs a region before an experience', () => {
    expect(parseAppUrl('/wv/5/e/1234', '')).toEqual({ ...MAP_ROOT, worldViewId: 5 });
  });

  it('reads the legacy ?wv= form when the path names no world view', () => {
    expect(parseAppUrl('/', '?wv=5')).toEqual({ ...MAP_ROOT, worldViewId: 5 });
    expect(parseAppUrl('/discover', '?wv=5')).toEqual({ ...MAP_ROOT, mode: 'discover', worldViewId: 5 });
    expect(parseAppUrl('/wv/7', '?wv=5')).toEqual({ ...MAP_ROOT, worldViewId: 7 });
  });

  it('ignores a kind outside Discover', () => {
    expect(parseAppUrl('/wv/5/r/1', '?kind=2')).toEqual({ ...MAP_ROOT, worldViewId: 5, regionId: 1 });
  });

  it('ignores a kind that does not parse', () => {
    expect(parseAppUrl('/discover/wv/5/r/1', '?kind=x')).toEqual({ ...MAP_ROOT, mode: 'discover', worldViewId: 5, regionId: 1 });
  });

  it('tolerates a trailing slash', () => {
    expect(parseAppUrl('/wv/5/r/6737/', '')).toEqual({ ...MAP_ROOT, worldViewId: 5, regionId: 6737 });
  });
});

describe('buildAppUrl', () => {
  it('writes bare ids when no names are given', () => {
    expect(buildAppUrl({ mode: 'map', worldViewId: 5, regionId: 6737, experienceId: 1234, kindId: null })).toBe('/wv/5/r/6737/e/1234');
  });

  it('decorates the ids with slugs when the names are known', () => {
    expect(buildAppUrl(
      { mode: 'map', worldViewId: 5, regionId: 6737, experienceId: 1234, kindId: null },
      { region: 'Europe', experience: 'Historic Centre of Saint Petersburg and Related Groups of Monuments' },
    )).toBe('/wv/5/r/6737-europe/e/1234-historic-centre-of-saint-petersburg-and-related-groups-of-mo');
  });

  it('writes Discover with its kind', () => {
    expect(buildAppUrl({ mode: 'discover', worldViewId: 5, regionId: 7120, experienceId: null, kindId: 1 })).toBe('/discover/wv/5/r/7120?kind=1');
  });

  it('writes the default world view as the bare root', () => {
    expect(buildAppUrl(MAP_ROOT)).toBe('/');
    expect(buildAppUrl({ ...MAP_ROOT, mode: 'discover' })).toBe('/discover');
  });

  it('drops what cannot stand alone: an experience without a region, a kind outside Discover', () => {
    expect(buildAppUrl({ ...MAP_ROOT, worldViewId: 5, experienceId: 1234 })).toBe('/wv/5');
    expect(buildAppUrl({ ...MAP_ROOT, worldViewId: 5, regionId: 1, kindId: 2 })).toBe('/wv/5/r/1');
  });

  it('writes nothing for a name whose slug is empty', () => {
    expect(buildAppUrl({ ...MAP_ROOT, worldViewId: 5, regionId: 1 }, { region: 'Москва' })).toBe('/wv/5/r/1');
  });
});

describe('an address survives the round trip', () => {
  const addresses: AppAddress[] = [
    MAP_ROOT,
    { ...MAP_ROOT, mode: 'discover' },
    { ...MAP_ROOT, worldViewId: 5 },
    { ...MAP_ROOT, worldViewId: 5, regionId: 6737 },
    { ...MAP_ROOT, worldViewId: 5, regionId: 6737, experienceId: 1234 },
    { ...MAP_ROOT, mode: 'discover', worldViewId: 5, regionId: 7120 },
    { ...MAP_ROOT, mode: 'discover', worldViewId: 5, regionId: 7120, kindId: 1 },
    { ...MAP_ROOT, mode: 'discover', worldViewId: 5, regionId: 7120, experienceId: 1234, kindId: 1 },
  ];

  it.each(addresses)('%j', (address) => {
    const url = new URL(buildAppUrl(address, { region: 'Europe', experience: 'Stonehenge' }), 'http://x');
    expect(parseAppUrl(url.pathname, url.search)).toEqual(address);
  });
});

describe('legacyRedirect', () => {
  it('moves ?wv= into the path', () => {
    expect(legacyRedirect('/', '?wv=5')).toBe('/wv/5');
    expect(legacyRedirect('/discover', '?wv=5')).toBe('/discover/wv/5');
  });

  it('drops a ?wv= that does not parse', () => {
    expect(legacyRedirect('/', '?wv=abc')).toBe('/');
  });

  it('leaves a canonical address alone', () => {
    expect(legacyRedirect('/', '')).toBeNull();
    expect(legacyRedirect('/wv/5/r/6737-europe', '')).toBeNull();
    expect(legacyRedirect('/discover/wv/5/r/1', '?kind=2')).toBeNull();
  });

  it('leaves pages that are not places alone', () => {
    expect(legacyRedirect('/auth/callback', '?code=abc&wv=5')).toBeNull();
  });
});

describe('slugsOf', () => {
  it('reads the slugs an address carries', () => {
    expect(slugsOf('/wv/5/r/6737-europe/e/1234-stonehenge')).toEqual({ region: 'europe', experience: 'stonehenge' });
    expect(slugsOf('/discover/wv/5/r/6737-europe-old-name')).toEqual({ region: 'europe-old-name', experience: '' });
    expect(slugsOf('/wv/5/r/6737')).toEqual({ region: '', experience: '' });
    expect(slugsOf('/account')).toEqual({ region: '', experience: '' });
  });
});

describe('slugify', () => {
  it('lowercases and strips diacritics', () => {
    expect(slugify('Château de Versailles')).toBe('chateau-de-versailles');
  });

  it('collapses runs of anything that is not a letter or digit, and trims the ends', () => {
    expect(slugify('  Saint Petersburg & Related Groups!  ')).toBe('saint-petersburg-related-groups');
  });

  it('caps the length at sixty without leaving a trailing dash', () => {
    const slug = slugify('Historic Centre of Saint Petersburg and Related Groups of Monuments');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('is empty for a name with no Latin letters or digits', () => {
    expect(slugify('Москва')).toBe('');
    expect(slugify('東京')).toBe('');
  });
});

/**
 * The review page's list state (ADR-0051 decision 5): order, search, filters
 * and the selected row are query parameters on `/review`, in the words
 * `GET /api/experiences/review/queue` already reads. `/review` is not a place
 * — `parseAppUrl` answers null for it — so this pair is a sibling to
 * `parseAppUrl`/`buildAppUrl` rather than an extension of them.
 */
describe('review address', () => {
  describe('parseReviewUrl', () => {
    it('reads the empty address from no query at all', () => {
      expect(parseReviewUrl('')).toEqual(EMPTY_REVIEW);
    });

    it('reads sort=question, and anything else as the default', () => {
      expect(parseReviewUrl('?sort=question')).toEqual({ ...EMPTY_REVIEW, sort: 'question' });
      expect(parseReviewUrl('?sort=date')).toEqual(EMPTY_REVIEW);
      expect(parseReviewUrl('?sort=bogus')).toEqual(EMPTY_REVIEW);
    });

    it('reads comma-separated source ids, dropping a bad entry rather than the whole list', () => {
      expect(parseReviewUrl('?source=1,3')).toEqual({ ...EMPTY_REVIEW, sourceIds: [1, 3] });
      expect(parseReviewUrl('?source=1,abc,3,0')).toEqual({ ...EMPTY_REVIEW, sourceIds: [1, 3] });
    });

    it('reads only the API kind words, dropping the rest, in the order given', () => {
      expect(parseReviewUrl('?kind=arrival,refused')).toEqual({ ...EMPTY_REVIEW, kinds: ['arrival', 'refused'] });
      expect(parseReviewUrl('?kind=bogus,refused')).toEqual({ ...EMPTY_REVIEW, kinds: ['refused'] });
      expect(parseReviewUrl('?kind=conflict,withdrawn,missing,arrival,held,contents')).toEqual({
        ...EMPTY_REVIEW,
        kinds: ['conflict', 'withdrawn', 'missing', 'arrival', 'held', 'contents'],
      });
    });

    it('reads region as none or a positive int, otherwise absent', () => {
      expect(parseReviewUrl('?region=none')).toEqual({ ...EMPTY_REVIEW, regionId: 'none' });
      expect(parseReviewUrl('?region=6737')).toEqual({ ...EMPTY_REVIEW, regionId: 6737 });
      expect(parseReviewUrl('?region=abc')).toEqual(EMPTY_REVIEW);
      expect(parseReviewUrl('?region=0')).toEqual(EMPTY_REVIEW);
    });

    it('reads run as a positive int, 0 as absent', () => {
      expect(parseReviewUrl('?run=98')).toEqual({ ...EMPTY_REVIEW, runId: 98 });
      expect(parseReviewUrl('?run=0')).toEqual(EMPTY_REVIEW);
      expect(parseReviewUrl('?run=abc')).toEqual(EMPTY_REVIEW);
    });

    it('reads aside=show only, anything else as absent', () => {
      expect(parseReviewUrl('?aside=show')).toEqual({ ...EMPTY_REVIEW, showAside: true });
      expect(parseReviewUrl('?aside=yes')).toEqual(EMPTY_REVIEW);
    });

    it('reads a row of kind:id for a list kind, garbage as absent', () => {
      expect(parseReviewUrl('?row=waiting:11586')).toEqual({ ...EMPTY_REVIEW, row: 'waiting:11586' });
      // The list's own word, not the API's: `row` carries a `QueueRow` key, and the row a
      // `?kind=conflict` filter leaves is keyed `conflicts:1`. A `row=conflict:1` the page
      // could never match is worse than none, so it reads as absent.
      expect(parseReviewUrl('?row=conflicts:1')).toEqual({ ...EMPTY_REVIEW, row: 'conflicts:1' });
      expect(parseReviewUrl('?row=conflict:1')).toEqual(EMPTY_REVIEW);
      expect(parseReviewUrl('?row=nonsense')).toEqual(EMPTY_REVIEW);
      // `arrival` is a sub-kind of `waiting`, not one of the five list kinds.
      expect(parseReviewUrl('?row=arrival:5')).toEqual(EMPTY_REVIEW);
      expect(parseReviewUrl('?row=waiting:0')).toEqual(EMPTY_REVIEW);
      expect(parseReviewUrl('?row=')).toEqual(EMPTY_REVIEW);
    });

    it('reads the rest of the query when one field is unreadable', () => {
      expect(parseReviewUrl('?run=98&row=nonsense')).toEqual({ ...EMPTY_REVIEW, runId: 98 });
    });

    it('drops unknown parameters', () => {
      expect(parseReviewUrl('?foo=bar&q=memorial')).toEqual({ ...EMPTY_REVIEW, q: 'memorial' });
    });

    it('trims and caps q at 100 characters', () => {
      const raw = `  ${'x'.repeat(150)}  `;
      const params = new URLSearchParams({ q: raw });
      expect(parseReviewUrl(`?${params.toString()}`)).toEqual({ ...EMPTY_REVIEW, q: 'x'.repeat(100) });
    });
  });

  describe('normaliseReviewQ', () => {
    // The rule the parse applies, exported so the search box can ask the same question
    // rather than half of it: comparing what was typed against a *trimmed* address alone
    // rewrote `Cologne ` under the caret, and a 101-character paste the same way.
    it('is what the parse does to q, and nothing else', () => {
      expect(normaliseReviewQ('  cologne  ')).toBe('cologne');
      expect(normaliseReviewQ('x'.repeat(150))).toBe('x'.repeat(100));
      expect(normaliseReviewQ(`  ${'x'.repeat(150)}  `)).toBe('x'.repeat(100));
      expect(normaliseReviewQ('cologne')).toBe('cologne');
      expect(normaliseReviewQ('')).toBe('');
    });

    it('answers what parseReviewUrl stores, for the same raw text', () => {
      const raw = '  Cologne Cathedral  ';
      const params = new URLSearchParams({ q: raw });
      expect(parseReviewUrl(`?${params.toString()}`).q).toBe(normaliseReviewQ(raw));
    });
  });

  describe('buildReviewUrl', () => {
    it('writes the empty address as the bare root', () => {
      expect(buildReviewUrl(EMPTY_REVIEW)).toBe('/review');
    });

    it('writes sort=date as nothing', () => {
      expect(buildReviewUrl({ ...EMPTY_REVIEW, sort: 'date' })).toBe('/review');
    });

    it('writes every field in a stable key order: sort, q, source, kind, region, run, aside, row', () => {
      const full: ReviewAddress = {
        q: 'memorial',
        sort: 'question',
        sourceIds: [1, 3],
        kinds: ['arrival', 'refused'],
        regionId: 6737,
        runId: 98,
        showAside: true,
        row: 'waiting:600',
      };
      expect(buildReviewUrl(full)).toBe(
        '/review?sort=question&q=memorial&source=1,3&kind=arrival,refused&region=6737&run=98&aside=show&row=waiting:600',
      );
    });

    it('writes region=none', () => {
      expect(buildReviewUrl({ ...EMPTY_REVIEW, regionId: 'none' })).toBe('/review?region=none');
    });

    it('encodes q through URLSearchParams', () => {
      expect(buildReviewUrl({ ...EMPTY_REVIEW, q: 'memorial site' })).toBe('/review?q=memorial+site');
    });

    // The build applies `normaliseReviewQ` too (same rule the parse applies), so a
    // trailing space or an over-length paste builds the address the settled search
    // would have built anyway — not a byte different address `go` treats as a change.
    it('normalises q the same way the parse does, so a cosmetic difference builds nothing new', () => {
      expect(buildReviewUrl({ ...EMPTY_REVIEW, q: 'cologne ' }))
        .toBe(buildReviewUrl({ ...EMPTY_REVIEW, q: 'cologne' }));
      expect(buildReviewUrl({ ...EMPTY_REVIEW, q: 'x'.repeat(150) }))
        .toBe(`/review?q=${'x'.repeat(100)}`);
    });
  });

  describe('an address survives the round trip', () => {
    const addresses: ReviewAddress[] = [
      EMPTY_REVIEW,
      { ...EMPTY_REVIEW, q: 'memorial' },
      { ...EMPTY_REVIEW, sort: 'question' },
      { ...EMPTY_REVIEW, sourceIds: [1, 3] },
      { ...EMPTY_REVIEW, kinds: ['arrival', 'held', 'contents'] },
      { ...EMPTY_REVIEW, kinds: ['conflict', 'withdrawn', 'missing'] },
      { ...EMPTY_REVIEW, regionId: 6737 },
      { ...EMPTY_REVIEW, regionId: 'none' },
      { ...EMPTY_REVIEW, runId: 98 },
      { ...EMPTY_REVIEW, showAside: true },
      { ...EMPTY_REVIEW, row: 'conflicts:1' },
      { ...EMPTY_REVIEW, row: 'waiting:11586' },
      { ...EMPTY_REVIEW, row: 'withdrawn:2' },
      { ...EMPTY_REVIEW, row: 'refused:3' },
      { ...EMPTY_REVIEW, row: 'missing:4' },
      {
        q: 'memorial',
        sort: 'question',
        sourceIds: [1, 3],
        kinds: ['arrival', 'refused'],
        regionId: 6737,
        runId: 98,
        showAside: true,
        row: 'waiting:600',
      },
    ];

    it.each(addresses)('%j', (address) => {
      const url = new URL(buildReviewUrl(address), 'http://x');
      expect(parseReviewUrl(url.search)).toEqual(address);
    });
  });
});
