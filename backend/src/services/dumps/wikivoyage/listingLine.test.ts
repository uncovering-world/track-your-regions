import { describe, expect, it } from 'vitest';
import { ListingReader } from './listingLine.js';

/**
 * The items a Wikivoyage edition's listings name (#1768), read from lines
 * shaped as English and German Wikivoyage's pages-articles dumps wrote them on
 * 2026-10-20.
 */

function read(lines: string[]): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const reader = new ListingReader((item, title) => found.push([item, title]));
  for (const line of lines) reader.line(line);
  return found;
}

const page = (title: string, ns: number, ...text: string[]) => [
  '  <page>', `    <title>${title}</title>`, `    <ns>${ns}</ns>`, '    <id>1</id>', '    <revision>', ...text, '    </revision>', '  </page>',
];

describe('the listings of a Wikivoyage dump', () => {
  it("hands over each item an article's listings name, in whichever template the edition writes", () => {
    expect(read([
      ...page('Bath', 0,
        '      <text bytes="1" xml:space="preserve">==See==',
        '* {{see | name=Roman Baths | url=https://www.romanbaths.co.uk/ | wikidata=Q2540426 }} Built around the hot springs.',
        '* {{see',
        '| name=Bath Abbey | wikidata = q1137430',
        '}}</text>'),
      ...page('Arles', 0, '{{vCard| name = Amphitheater | wikidata=Q181189 | type = monument }}'),
    ])).toEqual([['Q2540426', 'Bath'], ['Q1137430', 'Bath'], ['Q181189', 'Arles']]);
  });

  it('names an item once per article, and again in another article', () => {
    expect(read([
      ...page('Rome/Centro Storico', 0, '{{see|name=Largo di Torre Argentina|wikidata=Q1541068}}', '{{marker|wikidata=Q1541068}}'),
      ...page('Rome', 0, '{{see|name=Largo di Torre Argentina|wikidata=Q1541068}}'),
    ])).toEqual([['Q1541068', 'Rome/Centro Storico'], ['Q1541068', 'Rome']]);
  });

  it('reads articles only: a talk page or a template names an item without sending anyone there', () => {
    expect(read([
      ...page('Talk:Denver', 1, '{{see|name=Stapleton International Airport|wikidata=Q1436575}}'),
      ...page('Template:Listing', 10, '{{see|name=Example|wikidata=Q42}}'),
      ...page('Old Sarum', 0, '{{pagebanner|wikidata=Q782719}}'),
    ])).toEqual([['Q782719', 'Old Sarum']]);
  });

  it('gives the title as the edition writes it, unescaped', () => {
    expect(read(page('Tom &amp; Jerry&#039;s &quot;Fort&quot;', 0, '{{see|wikidata=Q1}}'))).toEqual([['Q1', 'Tom & Jerry\'s "Fort"']]);
  });
});
