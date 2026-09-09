import { describe, expect, it } from 'vitest';
import {
  evaluateAssertions, gotSuccessfulRequestMatching, hasFailures, pageExpectations, validateAssertions,
} from './assertions.mjs';

const URL = 'http://frontend:5173/wv/9001';

const lhr = {
  categories: { performance: { score: 0.62 } },
  audits: {
    'largest-contentful-paint': { numericValue: 2500, score: 0.7 },
    'cumulative-layout-shift': { numericValue: 0.02, score: 1 },
    'resource-summary': {
      details: {
        items: [
          { resourceType: 'total', requestCount: 12, transferSize: 900000 },
          { resourceType: 'script', requestCount: 1, transferSize: 780000 },
        ],
      },
    },
  },
};

describe('evaluateAssertions', () => {
  it('judges a timing, a category score and a resource-summary row', () => {
    const results = evaluateAssertions(
      lhr,
      {
        'largest-contentful-paint': ['error', { maxNumericValue: 3000 }],
        'categories:performance': ['warn', { minScore: 0.7 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 700000 }],
        'resource-summary:total:count': ['error', { maxNumericValue: 20 }],
      },
      URL,
    );

    expect(results.map((r) => [r.auditId, r.auditProperty, r.actual, r.passed])).toEqual([
      ['largest-contentful-paint', undefined, 2500, true],
      ['categories:performance', undefined, 0.62, false],
      ['resource-summary', 'script:size', 780000, false],
      ['resource-summary', 'total:count', 12, true],
    ]);
    expect(results.every((r) => r.url === URL)).toBe(true);
  });

  it('reads the score for minScore and numericValue for maxNumericValue, never one for the other', () => {
    const results = evaluateAssertions(
      lhr,
      {
        // 2500 ms would satisfy a 0.9 threshold if the numeric value leaked
        // into a score comparison; the score is 0.7 and must be what fails.
        'largest-contentful-paint': ['error', { minScore: 0.9 }],
        'cumulative-layout-shift': ['error', { minScore: 0.9 }],
      },
      URL,
    );

    expect(results.map((r) => [r.actual, r.passed])).toEqual([
      [0.7, false],
      [1, true],
    ]);
  });

  it('fails a budget the report cannot answer instead of passing it', () => {
    const results = evaluateAssertions(
      lhr,
      {
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
        'resource-summary:font:size': ['error', { maxNumericValue: 1 }],
        'resource-summary:script:weight': ['error', { maxNumericValue: 1 }],
        'resource-summary:script:size': ['error', { minScore: 1 }],
        'categories:performance': ['error', { maxNumericValue: 1 }],
        'largest-contentful-paint': ['error', {}],
      },
      URL,
    );

    expect(results.map((r) => r.passed)).toEqual([false, false, false, false, false, false]);
    expect(results.map((r) => r.message)).toEqual([
      'audit "total-blocking-time" not in report',
      'resource type "font" not in resource-summary',
      'unknown measure "weight" (use size or count)',
      'a resource-summary row takes maxNumericValue',
      'a category takes minScore',
      undefined,
    ]);
  });

  it('skips "off" and lets only error-level misses fail the lane', () => {
    const results = evaluateAssertions(
      lhr,
      {
        'largest-contentful-paint': 'off',
        'categories:performance': ['warn', { minScore: 0.9 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
      URL,
    );

    expect(results).toHaveLength(2);
    expect(hasFailures(results)).toBe(false);
    expect(hasFailures([{ level: 'error', passed: false }])).toBe(true);
    // A level nobody validated must not read as a pass either.
    expect(hasFailures([{ level: 'eror', passed: false }])).toBe(true);
  });
});

describe('validateAssertions', () => {
  it('accepts the shapes the lane uses', () => {
    expect(() =>
      validateAssertions({
        'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'categories:performance': ['warn', { minScore: 0.8 }],
        'interactive': 'off',
      }),
    ).not.toThrow();
  });

  it('refuses a file that could not gate', () => {
    expect(() => validateAssertions(undefined)).toThrow(/no "assertions"/);
    expect(() => validateAssertions({})).toThrow(/at least one entry/);
    expect(() => validateAssertions({ 'largest-contentful-paint': ['eror', { maxNumericValue: 2000 }] })).toThrow(
      /level must be "error", "warn" or "off", got "eror"/,
    );
    expect(() => validateAssertions({ 'largest-contentful-paint': ['error', {}] })).toThrow(/needs exactly one numeric threshold/);
    expect(() => validateAssertions({ 'largest-contentful-paint': ['error', { maxNumericValue: '2000' }] })).toThrow(/needs exactly one/);
    // Both at once is an ambiguity, not a stricter budget: only one would be checked.
    expect(() => validateAssertions({ 'largest-contentful-paint': ['error', { maxNumericValue: 2000, minScore: 0.9 }] })).toThrow(
      /needs exactly one/,
    );
  });
});

describe('pageExpectations', () => {
  const fill = (text) => text.replaceAll('{worldView}', '9001');

  it('gives every page the shared fragment, and a page its own on top', () => {
    const pages = pageExpectations(
      {
        urls: [
          { url: 'http://frontend:5173/wv/{worldView}', expectRequestMatching: '/tile_world_view_all_leaf_regions/' },
          'http://frontend:5173/discover/wv/{worldView}',
        ],
        expectRequestMatching: '/api/world-views/{worldView}/',
      },
      fill,
    );

    expect(pages).toEqual([
      {
        url: 'http://frontend:5173/wv/9001',
        expects: ['/api/world-views/9001/', '/tile_world_view_all_leaf_regions/'],
      },
      { url: 'http://frontend:5173/discover/wv/9001', expects: ['/api/world-views/9001/'] },
    ]);
  });

  it('takes a list of fragments at either level, and none at all', () => {
    const pages = pageExpectations(
      { urls: [{ url: 'http://a/', expectRequestMatching: ['/x/', '/y/'] }, 'http://b/'], expectRequestMatching: ['/s/'] },
      (t) => t,
    );
    expect(pages.map((p) => p.expects)).toEqual([['/s/', '/x/', '/y/'], ['/s/']]);

    expect(pageExpectations({ urls: ['http://a/'] }, (t) => t)).toEqual([{ url: 'http://a/', expects: [] }]);
  });

  it('refuses an entry it cannot read rather than expecting nothing of it', () => {
    // An entry with no url, or a fragment that is not a string, would be a
    // page the lane measures with no idea what it should have asked for.
    expect(() => pageExpectations({ urls: [{ expectRequestMatching: '/x/' }] }, (t) => t)).toThrow(/urls/);
    expect(() => pageExpectations({ urls: ['http://a/'], expectRequestMatching: [''] }, (t) => t)).toThrow(/fragment/);
    expect(() => pageExpectations({ urls: [{ url: 'http://a/', expectRequestMatching: 7 }] }, (t) => t)).toThrow(/fragment/);
  });
});

describe('gotSuccessfulRequestMatching', () => {
  const report = (items) => ({ audits: { 'network-requests': { details: { items } } } });
  const tile = 'http://martin:3000/tile_world_view_all_leaf_regions/1/0/0?world_view_id=9001';

  it('counts a request answered 2xx, an empty tile among them', () => {
    expect(gotSuccessfulRequestMatching(report([{ url: tile, statusCode: 200 }]), '/tile_world_view_all_leaf_regions/')).toBe(true);
    // Martin answers 204 for a tile with nothing in it - still the map asking.
    expect(gotSuccessfulRequestMatching(report([{ url: tile, statusCode: 204 }]), '/tile_world_view_all_leaf_regions/')).toBe(true);
  });

  it('does not count a preflight, a failed request, or no request at all', () => {
    // The worker-dead shape of #849: the basemap's PNGs arrive, the API
    // answers, and no tile function is ever asked for.
    const noTiles = report([
      { url: 'https://tile.openstreetmap.org/1/0/0.png', statusCode: 200 },
      { url: 'http://backend:3001/api/world-views/9001/regions/root', statusCode: 200 },
    ]);
    expect(gotSuccessfulRequestMatching(noTiles, '/tile_world_view_all_leaf_regions/')).toBe(false);
    expect(gotSuccessfulRequestMatching(report([{ url: tile, statusCode: 204, resourceType: 'Preflight' }]), '/tile_')).toBe(false);
    expect(gotSuccessfulRequestMatching(report([{ url: tile, statusCode: 404 }]), '/tile_')).toBe(false);
    expect(gotSuccessfulRequestMatching({ audits: {} }, '/tile_')).toBe(false);
  });
});
