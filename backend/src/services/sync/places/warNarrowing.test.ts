/**
 * A war narrowed to the battle a memorial is for (#2404). The ids and dates
 * are the development subset's (2026-11-09): World War II (Q362) ran from
 * 1939-09-01 to 1945-09-02, World War I (Q361) from 1914-07-28 to 1918-11-11,
 * the Battle of Berlin (Q154182) from 1945-04-16 to 1945-05-02; the Gulf War
 * (Q37643) stands in for a war after World War I, and *military* (Q8473) for a
 * link that is no conflict. The wikitext is written for the test, in the shape
 * of a lead.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../wikipediaCategories.js', async (actual) => ({ ...(await actual<object>()), askWikipediaOnce: vi.fn() }));

import { askWikipediaOnce } from '../wikipediaCategories.js';
import type { SubjectKind } from './commemorates.js';
import { dedicationLinks, fetchLeads, narrowWars, within } from './warNarrowing.js';

const WW2 = 'Q362';
const WW1 = 'Q361';
const BERLIN = 'Q154182';
const GULF_WAR = 'Q37643';
const MILITARY = 'Q8473';

const NOT: Omit<SubjectKind, 'label'> = { human: false, event: true, holy: false, war: false, conflict: false, span: null };
const KINDS = new Map<string, SubjectKind>([
  [WW2, { ...NOT, label: 'World War II', war: true, conflict: true, span: { from: 19390901, to: 19450902 } }],
  [WW1, { ...NOT, label: 'World War I', war: true, conflict: true, span: { from: 19140728, to: 19181111 } }],
  [BERLIN, { ...NOT, label: 'Battle of Berlin', conflict: true, span: { from: 19450416, to: 19450502 } }],
  [GULF_WAR, { ...NOT, label: 'Gulf War', war: true, conflict: true, span: { from: 19900802, to: 19910228 } }],
  [MILITARY, { ...NOT, label: 'military', event: false }],
]);
const ARTICLES = new Map([[BERLIN, 'https://en.wikipedia.org/wiki/Battle_of_Berlin']]);
const WAR_READING = (item: string, label: string) => ({ via: 'commemorates' as const, subjects: [{ item, label, articleUrl: null }] });

describe('the links of a lead that say what a place is for', () => {
  it('reads the links of the sentences that say whom a place commemorates, past an infobox, a reference and a file', () => {
    const lead = [
      '{{Infobox monument|name=Memorial|{{coord|52.48|13.47}}}}',
      '[[File:Memorial.jpg|thumb|The statue at the [[Spree]]]]',
      'The memorial stands in [[Treptower Park]] in [[Berlin]].',
      'It commemorates the [[Red Army]] soldiers who fell in the [[Battle of Berlin|battle for Berlin]] in 1945.<ref>A source.</ref>',
      'It was designed by an [[architect]].',
    ].join('\n');
    expect(dedicationLinks(lead)).toEqual(['Red Army', 'Battle of Berlin']);
  });

  it('reads no link inside a comment, closed or left open', () => {
    expect(dedicationLinks('It commemorates the fallen of the <!-- [[Battle of Berlin]] --> [[Battle of Dunkirk]]. <!-- [[Pacific War]] fell'))
      .toEqual(['Battle of Dunkirk']);
  });

  it('reads no namespaced link and a link once, first letter raised as a title is', () => {
    expect(dedicationLinks('Dedicated to the [[world War I|war]] dead and [[Category:Memorials]]; in memory of [[World War I]].'))
      .toEqual(['World War I']);
  });
});

describe('narrowing a war', () => {
  it('replaces the war with the battle a dedication sentence links within it', () => {
    expect(narrowWars(WAR_READING(WW2, 'World War II'), [MILITARY, BERLIN], KINDS, ARTICLES)).toEqual({
      via: 'war-narrowed-by-lead',
      subjects: [{ item: BERLIN, label: 'Battle of Berlin', articleUrl: 'https://en.wikipedia.org/wiki/Battle_of_Berlin' }],
    });
  });

  it('keeps the war where the lead links only the war itself, a war after it, or no conflict', () => {
    const reading = WAR_READING(WW1, 'World War I');
    expect(narrowWars(reading, [WW1, GULF_WAR, MILITARY], KINDS, ARTICLES)).toBe(reading);
  });

  it('narrows nothing that is not a war, and keeps what else the reading names', () => {
    const reading = { via: 'commemorates' as const, subjects: [{ item: BERLIN, label: 'Battle of Berlin', articleUrl: null }] };
    expect(narrowWars(reading, [BERLIN], KINDS, ARTICLES)).toBe(reading);
    const both = { via: 'commemorates' as const, subjects: [{ item: MILITARY, label: 'military', articleUrl: null }, WAR_READING(WW2, 'World War II').subjects[0]] };
    expect(narrowWars(both, [BERLIN], KINDS, ARTICLES).subjects.map((s) => s.item)).toEqual([MILITARY, BERLIN]);
  });

  it('holds a span within another only wholly inside it', () => {
    expect(within({ from: 19450416, to: 19450502 }, { from: 19390901, to: 19450902 })).toBe(true);
    expect(within({ from: 19190506, to: 19190808 }, { from: 19140728, to: 19181111 })).toBe(false);
  });
});

describe('reading the leads', () => {
  const page = (content: string) => ({ query: { pages: [{ title: 't', revisions: [{ slots: { main: { content } } }] }] } });

  it('goes on past a lead it cannot read, which keeps its war', async () => {
    vi.mocked(askWikipediaOnce).mockReset()
      .mockRejectedValueOnce(new Error('[Wikipedia] the lead of Basra Memorial could not be read: 503'))
      .mockResolvedValueOnce(page('It commemorates those who fell in the [[Battle of Berlin]].'));
    const leads = await fetchLeads(['Basra Memorial', 'Soviet War Memorial (Treptower Park)'], { userAgent: 'test' });
    expect([...leads.keys()]).toEqual(['Soviet War Memorial (Treptower Park)']);
  });

  it('stops a cancelled run rather than reading on', async () => {
    let cancelled = false;
    vi.mocked(askWikipediaOnce).mockReset().mockImplementationOnce(async () => {
      cancelled = true;
      throw new Error('cancelled');
    });
    await expect(fetchLeads(['Basra Memorial', 'Dunkirk Memorial'], { userAgent: 'test', isCancelled: () => cancelled }))
      .rejects.toThrow('cancelled');
    expect(askWikipediaOnce).toHaveBeenCalledTimes(1);
  });
});
