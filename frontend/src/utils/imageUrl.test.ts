import { describe, it, expect } from 'vitest';
import { toThumbnailUrl, extractImageUrl } from './imageUrl';

describe('toThumbnailUrl', () => {
  it('appends width param to Special:FilePath URLs', () => {
    const url = 'http://commons.wikimedia.org/wiki/Special:FilePath/Louvre.jpg';
    expect(toThumbnailUrl(url, 250)).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Louvre.jpg?width=250'
    );
  });

  it('upgrades http to https for Special:FilePath URLs', () => {
    const url = 'http://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg';
    const result = toThumbnailUrl(url);
    expect(result.startsWith('https://')).toBe(true);
  });

  it('uses default width of 120 for Special:FilePath', () => {
    const url = 'http://commons.wikimedia.org/wiki/Special:FilePath/Image.jpg';
    expect(toThumbnailUrl(url)).toContain('?width=120');
  });

  it('proxies trusted remote URLs through wsrv.nl', () => {
    const url = 'https://whc.unesco.org/uploads/sites/1234.jpg';
    const result = toThumbnailUrl(url, 330);
    expect(result).toContain('wsrv.nl');
    expect(result).toContain('w=330');
    expect(result).toContain(encodeURIComponent(url));
  });

  it('rejects untrusted remote URLs', () => {
    const url = 'https://evil.example.com/malicious.jpg';
    expect(toThumbnailUrl(url)).toBe('');
  });

  it('passes through relative/local URLs unchanged', () => {
    const url = '/images/experiences/unesco/123.jpg';
    expect(toThumbnailUrl(url)).toBe(url);
  });

  it('allows upload.wikimedia.org URLs', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Louvre.jpg';
    const result = toThumbnailUrl(url, 500);
    expect(result).toContain('wsrv.nl');
    expect(result).toContain('w=500');
  });

  it('allows commons.wikimedia.org non-FilePath URLs', () => {
    const url = 'https://commons.wikimedia.org/some/other/path.jpg';
    const result = toThumbnailUrl(url);
    expect(result).toContain('wsrv.nl');
  });
});

describe('extractImageUrl', () => {
  it('returns null for null input', () => {
    expect(extractImageUrl(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractImageUrl('')).toBeNull();
  });

  it('parses JSON-encoded URL format', () => {
    const json = JSON.stringify({ url: 'https://upload.wikimedia.org/test.jpg' });
    const result = extractImageUrl(json);
    expect(result).toBe('https://upload.wikimedia.org/test.jpg');
  });

  it('returns null for JSON with untrusted URL', () => {
    const json = JSON.stringify({ url: 'https://evil.example.com/hack.jpg' });
    expect(extractImageUrl(json)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractImageUrl('{broken json')).toBeNull();
  });

  it('prepends API URL for local image paths', () => {
    const result = extractImageUrl('/images/experiences/unesco/123.jpg');
    expect(result).toContain('/images/experiences/unesco/123.jpg');
    // Should have API URL prefix (defaults to http://localhost:3001 in test)
    expect(result).toContain('localhost:3001');
  });

  it('passes through trusted remote URLs', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/test.jpg';
    expect(extractImageUrl(url)).toBe(url);
  });

  it('rejects untrusted remote URLs', () => {
    const url = 'https://not-trusted-domain.com/image.jpg';
    expect(extractImageUrl(url)).toBeNull();
  });

  it('allows whc.unesco.org URLs', () => {
    const url = 'https://whc.unesco.org/uploads/sites/1234.jpg';
    expect(extractImageUrl(url)).toBe(url);
  });

  it('allows data.unesco.org URLs', () => {
    const url = 'https://data.unesco.org/img/test.jpg';
    expect(extractImageUrl(url)).toBe(url);
  });

  it('returns null for JSON without url field', () => {
    const json = JSON.stringify({ name: 'test' });
    expect(extractImageUrl(json)).toBeNull();
  });
});

// Both functions hand their answer straight to an `<img src>`, so what they do
// not recognise they must refuse rather than pass on (#449). No sync writes
// such a value, and since #693 the API refuses every spelling of one on the way
// in — but a sync writes `image_url` through no request schema at all, and the
// rows already stored predate the rule. These cases are what runs where the
// value meets the DOM.
describe('unrenderable URLs', () => {
  const FOREIGN_SCHEMES = [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://evil.example.com/9f2c',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
  ];

  // Paths that look local and name a host: a browser rewrites `\` to `/` and
  // drops tab, LF and CR before parsing, so every one of these resolves to
  // evil.example.com rather than to us.
  const FOREIGN_AUTHORITIES = [
    '//evil.example.com/malicious.jpg',
    '/\\evil.example.com/malicious.jpg',
    '/\t/evil.example.com/malicious.jpg',
    '/\n/evil.example.com/malicious.jpg',
    '/\r/evil.example.com/malicious.jpg',
  ];

  // Resolved against whatever route the visitor happens to be on, which is
  // never where a picture lives.
  const RELATIVE = ['malicious.jpg'];

  const UNRENDERABLE = [...FOREIGN_SCHEMES, ...FOREIGN_AUTHORITIES, ...RELATIVE];

  it.each(UNRENDERABLE)('extractImageUrl refuses %j', url => {
    expect(extractImageUrl(url)).toBeNull();
  });

  it.each(UNRENDERABLE)('extractImageUrl refuses %j inside the JSON form', url => {
    expect(extractImageUrl(JSON.stringify({ url }))).toBeNull();
  });

  it.each(UNRENDERABLE)('toThumbnailUrl refuses %j', url => {
    expect(toThumbnailUrl(url)).toBe('');
  });

  it.each(FOREIGN_AUTHORITIES)('the browser really does read %j as a foreign host', url => {
    expect(new URL(url, 'https://ours.example').origin).toBe('https://evil.example.com');
  });

  it('toThumbnailUrl refuses a scheme that carries the Special:FilePath words', () => {
    expect(toThumbnailUrl("javascript:alert('Special:FilePath')")).toBe('');
  });

  it('toThumbnailUrl refuses an untrusted host on the Special:FilePath path', () => {
    expect(toThumbnailUrl('https://evil.example.com/wiki/Special:FilePath/Louvre.jpg')).toBe('');
  });
});

// A region's imported map (`region_map_url`) is the other stored picture, and
// it is wiki content too: the Wikivoyage extractor names a Commons
// `Special:FilePath` file for every map it finds. Seven dialogs used to build
// its `src` by hand (`${url}?width=500`) and one loader handed it to a
// `new Image()` untouched (#694). They all go through these two functions
// now, so what the functions make of that url is what the dialogs draw --
// and `backend/src/types/urlSafety.test.ts` holds every component to that,
// by reading the source, since only the backend's test tree can read files.
describe("a region's imported map", () => {
  const COMMONS_MAP = 'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png';

  it('is sized the way the dialogs used to size it by hand', () => {
    expect(toThumbnailUrl(COMMONS_MAP, 500)).toBe(`${COMMONS_MAP}?width=500`);
  });

  it('keeps a non-ASCII file name as stored, since the browser encodes it on the way out', () => {
    const raw = 'https://commons.wikimedia.org/wiki/Special:FilePath/Île-De-France-Map.png';
    expect(toThumbnailUrl(raw, 500)).toBe(`${raw}?width=500`);
  });

  it('is handed to the overlay loader at full size, as it was', () => {
    // The overlay is calibrated against division boundaries, so it wants the
    // original rather than a sized thumbnail: extractImageUrl answers with the
    // url itself once it has judged it, and with nothing otherwise.
    expect(extractImageUrl(COMMONS_MAP)).toBe(COMMONS_MAP);
    expect(extractImageUrl('javascript:alert(1)')).toBeNull();
  });
});
