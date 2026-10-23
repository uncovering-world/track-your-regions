import { describe, expect, it } from 'vitest';
import { isWorldHeritageCentreUrl } from './links.js';

describe('isWorldHeritageCentreUrl (#1851)', () => {
  it('names the World Heritage Centre whatever the scheme or the page', () => {
    // Gelati Monastery's, Khajuraho's and Zvartnots' P856 on 2026-10-22.
    expect(isWorldHeritageCentreUrl('http://whc.unesco.org/en/list/710')).toBe(true);
    expect(isWorldHeritageCentreUrl('https://whc.unesco.org/en/list/240/')).toBe(true);
    expect(isWorldHeritageCentreUrl('https://whc.unesco.org/en/list/1011/documents/')).toBe(true);
    expect(isWorldHeritageCentreUrl('HTTPS://WHC.UNESCO.ORG')).toBe(true);
  });

  it('leaves every other address alone, UNESCO\'s other sites and look-alikes included', () => {
    expect(isWorldHeritageCentreUrl('https://www.louvre.fr')).toBe(false);
    expect(isWorldHeritageCentreUrl('https://www.unesco.org/en/articles/x')).toBe(false);
    expect(isWorldHeritageCentreUrl('https://whc.unesco.org.example.com/en/list/710')).toBe(false);
    expect(isWorldHeritageCentreUrl('https://example.com/?u=https://whc.unesco.org')).toBe(false);
  });
});
