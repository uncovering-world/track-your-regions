import { describe, expect, it } from 'vitest';
import { buildAppUrl, legacyRedirect, parseAppUrl, slugify, type AppAddress } from './appUrl';

const MAP_ROOT: AppAddress = { mode: 'map', worldViewId: null, regionId: null, experienceId: null, categoryId: null };

/**
 * One grammar for every address the app writes and reads (#644). The path
 * carries what names a resource — the world view, the region, the open card —
 * and the query carries view state a visitor set deliberately: today only
 * Discover's category. Slugs decorate; ids decide.
 */
describe('parseAppUrl', () => {
  it('reads the map root as the default world view with nothing selected', () => {
    expect(parseAppUrl('/', '')).toEqual(MAP_ROOT);
  });

  it('reads world view, region and experience from the path, ignoring the slugs', () => {
    expect(parseAppUrl('/wv/5/r/6737-europe/e/1234-historic-centre-of-saint-petersburg', '')).toEqual({
      mode: 'map', worldViewId: 5, regionId: 6737, experienceId: 1234, categoryId: null,
    });
  });

  it('reads Discover with its category', () => {
    expect(parseAppUrl('/discover/wv/5/r/7120-france', '?cat=1')).toEqual({
      mode: 'discover', worldViewId: 5, regionId: 7120, experienceId: null, categoryId: 1,
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

  it('ignores a category outside Discover', () => {
    expect(parseAppUrl('/wv/5/r/1', '?cat=2')).toEqual({ ...MAP_ROOT, worldViewId: 5, regionId: 1 });
  });

  it('ignores a category that does not parse', () => {
    expect(parseAppUrl('/discover/wv/5/r/1', '?cat=x')).toEqual({ ...MAP_ROOT, mode: 'discover', worldViewId: 5, regionId: 1 });
  });

  it('tolerates a trailing slash', () => {
    expect(parseAppUrl('/wv/5/r/6737/', '')).toEqual({ ...MAP_ROOT, worldViewId: 5, regionId: 6737 });
  });
});

describe('buildAppUrl', () => {
  it('writes bare ids when no names are given', () => {
    expect(buildAppUrl({ mode: 'map', worldViewId: 5, regionId: 6737, experienceId: 1234, categoryId: null })).toBe('/wv/5/r/6737/e/1234');
  });

  it('decorates the ids with slugs when the names are known', () => {
    expect(buildAppUrl(
      { mode: 'map', worldViewId: 5, regionId: 6737, experienceId: 1234, categoryId: null },
      { region: 'Europe', experience: 'Historic Centre of Saint Petersburg and Related Groups of Monuments' },
    )).toBe('/wv/5/r/6737-europe/e/1234-historic-centre-of-saint-petersburg-and-related-groups-of-mo');
  });

  it('writes Discover with its category', () => {
    expect(buildAppUrl({ mode: 'discover', worldViewId: 5, regionId: 7120, experienceId: null, categoryId: 1 })).toBe('/discover/wv/5/r/7120?cat=1');
  });

  it('writes the default world view as the bare root', () => {
    expect(buildAppUrl(MAP_ROOT)).toBe('/');
    expect(buildAppUrl({ ...MAP_ROOT, mode: 'discover' })).toBe('/discover');
  });

  it('drops what cannot stand alone: an experience without a region, a category outside Discover', () => {
    expect(buildAppUrl({ ...MAP_ROOT, worldViewId: 5, experienceId: 1234 })).toBe('/wv/5');
    expect(buildAppUrl({ ...MAP_ROOT, worldViewId: 5, regionId: 1, categoryId: 2 })).toBe('/wv/5/r/1');
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
    { ...MAP_ROOT, mode: 'discover', worldViewId: 5, regionId: 7120, categoryId: 1 },
    { ...MAP_ROOT, mode: 'discover', worldViewId: 5, regionId: 7120, experienceId: 1234, categoryId: 1 },
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
    expect(legacyRedirect('/discover/wv/5/r/1', '?cat=2')).toBeNull();
  });

  it('leaves pages that are not places alone', () => {
    expect(legacyRedirect('/auth/callback', '?code=abc&wv=5')).toBeNull();
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
