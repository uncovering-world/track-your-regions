import { describe, it, expect } from 'vitest';
import { getImagePath, getImageUrl, imageExists } from './imageService.js';
import { join } from 'path';

describe('getImagePath', () => {
  it('returns correct local path for a source and external ID', () => {
    const path = getImagePath('UNESCO', '123');
    expect(path).toContain(join('data', 'images', 'experiences', 'unesco', '123.jpg'));
  });

  it('sanitizes source name to lowercase alphanumeric with hyphens', () => {
    const path = getImagePath('Top Museums', 'Q12345');
    expect(path).toContain(join('experiences', 'top-museums'));
  });

  it('sanitizes external ID removing unsafe characters', () => {
    const path = getImagePath('UNESCO', '../../etc/passwd');
    // Path traversal chars should be replaced with hyphens
    expect(path).not.toContain('..');
    expect(path).not.toContain('/etc/passwd');
    expect(path).toContain('------etc-passwd.jpg');
  });

  it('handles special characters in source name', () => {
    const path = getImagePath('Public Art & Monuments!', 'test');
    expect(path).toContain('public-art---monuments-');
  });

  it('handles numeric external IDs', () => {
    const path = getImagePath('source', '42');
    expect(path).toContain('42.jpg');
  });
});

describe('getImageUrl', () => {
  it('returns URL-safe path for serving images', () => {
    const url = getImageUrl('UNESCO', '123');
    expect(url).toBe('/images/experiences/unesco/123.jpg');
  });

  it('sanitizes source name in URL', () => {
    const url = getImageUrl('Top Museums', 'Q456');
    expect(url).toBe('/images/experiences/top-museums/Q456.jpg');
  });

  it('prevents path traversal in URLs', () => {
    const url = getImageUrl('UNESCO', '../../../etc/passwd');
    expect(url).not.toContain('..');
    expect(url.startsWith('/images/experiences/')).toBe(true);
  });

  it('handles underscores and hyphens in external ID', () => {
    const url = getImageUrl('source', 'site_123-abc');
    expect(url).toBe('/images/experiences/source/site_123-abc.jpg');
  });
});

describe('imageExists', () => {
  it('returns false for non-existent images', () => {
    expect(imageExists('nonexistent-source', 'nonexistent-id')).toBe(false);
  });
});
