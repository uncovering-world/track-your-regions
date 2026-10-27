import { describe, expect, it } from 'vitest';
import { PageReader, unescapeXml, type DumpPage } from './pageLine.js';

/**
 * Reading English Wikivoyage's `pages-articles` XML (#2089), in the shape the
 * 20261001 dump writes a page: the page's own id before its revision's, a
 * redirect's target as an attribute, and a text over many lines.
 */

const page = (lines: string[]) => ['  <page>', ...lines, '  </page>'];
const read = (lines: string[]) => {
  const pages: DumpPage[] = [];
  const reader = new PageReader(p => pages.push(p));
  for (const line of lines) reader.line(line);
  return { pages, reader };
};

const ALGERIA = page([
  '    <title>Algeria</title>',
  '    <ns>0</ns>',
  '    <id>2195</id>',
  '    <revision>',
  '      <id>5049871</id>',
  '      <contributor>',
  '        <id>12</id>',
  '      </contributor>',
  '      <text bytes="120" sha1="x" xml:space="preserve">{{pagebanner|Algeria banner.jpg}}',
  '==Regions==',
  '{{Regionlist',
  '| region1name=[[Northern Algeria]] &amp; the coast',
  '}}',
  '&lt;!-- a comment --&gt;</text>',
  '    </revision>',
]);

describe("English Wikivoyage's pages from its dump", () => {
  it("keeps an article's own id and its text whole, unescaped", () => {
    const { pages, reader } = read(ALGERIA);
    expect(pages).toEqual([{
      id: 2195, title: 'Algeria', redirectTo: null,
      wikitext: '{{pagebanner|Algeria banner.jpg}}\n==Regions==\n{{Regionlist\n| region1name=[[Northern Algeria]] & the coast\n}}\n<!-- a comment -->',
    }]);
    expect(reader.open).toBe(false);
  });

  it("keeps a redirect with its target, the section dropped", () => {
    const { pages } = read(page([
      '    <title>Alger</title>', '    <ns>0</ns>', '    <id>40211</id>',
      '    <redirect title="Algiers#Understand" />',
      '    <revision>', '      <id>4000001</id>',
      '      <text bytes="30" xml:space="preserve">#REDIRECT [[Algiers#Understand]]</text>',
      '    </revision>',
    ]));
    expect(pages).toEqual([{ id: 40211, title: 'Alger', redirectTo: 'Algiers', wikitext: '#REDIRECT [[Algiers#Understand]]' }]);
  });

  it('passes over a page of another namespace and a text the dump left out', () => {
    const { pages } = read([
      ...page(['    <title>Template:Regionlist</title>', '    <ns>10</ns>', '    <id>77</id>',
        '      <text bytes="9" xml:space="preserve">{{{1}}}', '</text>']),
      ...page(['    <title>Atlantis</title>', '    <ns>0</ns>', '    <id>78</id>', '      <text bytes="0" />']),
    ]);
    expect(pages).toEqual([{ id: 78, title: 'Atlantis', redirectTo: null, wikitext: '' }]);
  });

  it('says a file that ends inside a text is open', () => {
    const { pages, reader } = read(ALGERIA.slice(0, 11));
    expect(pages).toEqual([]);
    expect(reader.open).toBe(true);
  });

  it('unescapes the named entities and numeric references', () => {
    expect(unescapeXml('Côte d&apos;Ivoire &#8211; &#x2014; &quot;a&quot; &lt;b&gt; &amp;amp;')).toBe('Côte d\'Ivoire – — "a" <b> &amp;');
  });
});
