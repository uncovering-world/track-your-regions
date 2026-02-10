import { describe, it, expect } from 'vitest';
import { toThumbnailUrl, extractImageUrl } from './useExperienceContext';

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
