/**
 * What a curator's list of whom a place commemorates may hold (#2144): the
 * shape the runs store, and nothing a card would render as a link it should
 * not be.
 */

import { describe, expect, it } from 'vitest';
import { editExperienceBodySchema } from './index.js';
import { isEnglishWikipediaArticleUrl } from './urlSafety.js';

// The Lincoln Memorial commemorates Abraham Lincoln (Q91).
const LINCOLN = { item: 'Q91', label: 'Abraham Lincoln', articleUrl: 'https://en.wikipedia.org/wiki/Abraham_Lincoln' };

const parse = (commemorates: unknown) => editExperienceBodySchema.safeParse({ commemorates });

describe("a curator's list of whom a place commemorates", () => {
  it('takes subjects in the shape a run stores, an article or none, and the empty list', () => {
    expect(parse([LINCOLN, { item: 'Q15193', label: 'Alexander I of Russia', articleUrl: null }]).success).toBe(true);
    // India Gate with every stray subject removed: the curator's word that it names nobody.
    expect(parse([]).data).toEqual({ commemorates: [] });
  });

  it('stores the label tidied, as every name is', () => {
    expect(parse([{ ...LINCOLN, label: '  Abraham   Lincoln ' }]).data?.commemorates?.[0].label).toBe('Abraham Lincoln');
  });

  it.each([
    ['an item that is not one', { ...LINCOLN, item: 'Lincoln' }],
    ['a property', { ...LINCOLN, item: 'P91' }],
    ['an item with a leading zero', { ...LINCOLN, item: 'Q091' }],
    ['no label', { ...LINCOLN, label: '   ' }],
    ['a label longer than Wikidata allows', { ...LINCOLN, label: 'A'.repeat(251) }],
    ['an article on another site', { ...LINCOLN, articleUrl: 'https://example.com/wiki/Abraham_Lincoln' }],
    ['an article on another Wikipedia', { ...LINCOLN, articleUrl: 'https://fr.wikipedia.org/wiki/Abraham_Lincoln' }],
    ['an article over plain http', { ...LINCOLN, articleUrl: 'http://en.wikipedia.org/wiki/Abraham_Lincoln' }],
    ['a page that is not an article', { ...LINCOLN, articleUrl: 'https://en.wikipedia.org/w/index.php?title=Abraham_Lincoln' }],
    ['a javascript: address', { ...LINCOLN, articleUrl: 'javascript:alert(1)' }],
    ['a javascript: address with a tab in its scheme', { ...LINCOLN, articleUrl: 'java\tscript:alert(1)//en.wikipedia.org/wiki/X' }],
    ['a key the stored value does not have', { ...LINCOLN, via: 'curator' }],
  ])('refuses %s', (_name, subject) => {
    expect(parse([subject]).success).toBe(false);
  });

  it('refuses one subject named twice', () => {
    expect(parse([LINCOLN, { ...LINCOLN, label: 'Lincoln' }]).success).toBe(false);
  });
});

describe('an English Wikipedia article', () => {
  it.each([
    ['https://en.wikipedia.org/wiki/Abraham_Lincoln', true],
    ['https://en.wikipedia.org/wiki/Bardo_National_Museum_(Tunis)', true],
    ['https://en.wikipedia.org/wiki/', false],
    ['https://en.wikipedia.org.example.com/wiki/Abraham_Lincoln', false],
    ['https://user@en.wikipedia.org/wiki/Abraham_Lincoln', false],
    ['https://en.wikipedia.org:8443/wiki/Abraham_Lincoln', false],
    ['JAVASCRIPT:alert(1)', false],
    ['/wiki/Abraham_Lincoln', false],
  ])('%s → %s', (value, expected) => {
    expect(isEnglishWikipediaArticleUrl(value)).toBe(expected);
  });
});

// Big Vishnu (Q12498977) shows Vishnu (Q11380) riding Garuda (Q188676).
const VISHNU = { item: 'Q11380', label: 'Vishnu', articleUrl: 'https://en.wikipedia.org/wiki/Vishnu' };
const GARUDA = { item: 'Q188676', label: 'Garuda', articleUrl: 'https://en.wikipedia.org/wiki/Garuda' };

describe("a curator's list of the figures a work depicts (#2421)", () => {
  it('takes the same shape as whom a place commemorates, and the empty list', () => {
    expect(editExperienceBodySchema.safeParse({ depicts: [VISHNU, GARUDA] }).success).toBe(true);
    expect(editExperienceBodySchema.safeParse({ depicts: [] }).data).toEqual({ depicts: [] });
    expect(editExperienceBodySchema.safeParse({ depicts: [{ ...VISHNU, articleUrl: 'javascript:alert(1)' }] }).success).toBe(false);
  });

  it('takes a subject moved from one line to the other, and refuses one on both', () => {
    expect(editExperienceBodySchema.safeParse({ commemorates: [LINCOLN], depicts: [VISHNU] }).success).toBe(true);
    const both = editExperienceBodySchema.safeParse({ commemorates: [VISHNU], depicts: [VISHNU, GARUDA] });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0].path).toEqual(['depicts']);
  });
});
