/**
 * A war narrowed to what a memorial is for (#2404, #2412). The ids and dates
 * are the development subset's (2026-11-09 and 2026-11-10): World War II
 * (Q362) ran from 1939-09-01 to 1945-09-02, World War I (Q361) from
 * 1914-07-28 to 1918-11-11, the Battle of Berlin (Q154182) from 1945-04-16 to
 * 1945-05-02; the Gulf War (Q37643) stands in for a war after World War I,
 * and *military* (Q8473) for a link that is no event. Romania in World War I
 * (Q553157) is an event and no armed conflict; the atomic bombing of
 * Hiroshima (Q703203) is the Hiroshima Peace Memorial's significant event;
 * the Warsaw Uprising (Q1402078) ran from 1944-08-01 to 1944-10-02, the
 * Warsaw Ghetto Uprising (Q160161) from 1943-04-19 to 1943-05-16; Roman
 * Shukhevych (Q463766) is the man the Edmonton bust shows, and Mustafa Kemal
 * Atatürk (Q5152) the man Canberra's Kemal Atatürk Memorial is named for. The
 * wikitext is written for the test, in the shape of a lead.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../wikipediaCategories.js', async (actual) => ({ ...(await actual<object>()), askWikipediaOnce: vi.fn() }));

import { askWikipediaOnce } from '../wikipediaCategories.js';
import type { SubjectKind } from './commemorates.js';
import { BIOGRAPHY_CATEGORY, dedicationLinks, fetchLeads, leadLinks, narrowWars, overlaps, within, type WarEvidence } from './warNarrowing.js';

const WW2 = 'Q362';
const WW1 = 'Q361';
const BERLIN = 'Q154182';
const GULF_WAR = 'Q37643';
const MILITARY = 'Q8473';
const ROMANIA_IN_WW1 = 'Q553157';
const BOMBING_OF_HIROSHIMA = 'Q703203';
const WARSAW_UPRISING = 'Q1402078';
const GHETTO_UPRISING = 'Q160161';
const SHUKHEVYCH = 'Q463766';
const ATATURK = 'Q5152';
const WESTERPLATTE = 'Q517081';
const DANIEL_LINDLEY = 'Q14864324';
const HOLOCAUST = 'Q2763';
const SIEGE_OF_WARSAW = 'Q182240';

const NOT: Omit<SubjectKind, 'label'> = { human: false, event: true, holy: false, classical: false, war: false, occurrence: true, figure: false, span: null };
const KINDS = new Map<string, SubjectKind>([
  [WW2, { ...NOT, label: 'World War II', war: true, span: { from: 19390901, to: 19450902 } }],
  [WW1, { ...NOT, label: 'World War I', war: true, span: { from: 19140728, to: 19181111 } }],
  [BERLIN, { ...NOT, label: 'Battle of Berlin', span: { from: 19450416, to: 19450502 } }],
  [GULF_WAR, { ...NOT, label: 'Gulf War', war: true, span: { from: 19900802, to: 19910228 } }],
  [MILITARY, { ...NOT, label: 'military', event: false, occurrence: false }],
  // A peninsula Wikidata gives the battle's dates, and no occurrence.
  [WESTERPLATTE, { ...NOT, label: 'Westerplatte', occurrence: false, span: { from: 19390901, to: 19390907 } }],
  [ROMANIA_IN_WW1, { ...NOT, label: 'Romania in World War I', span: { from: 19160801, to: 19171201 } }],
  [BOMBING_OF_HIROSHIMA, { ...NOT, label: 'atomic bombing of Hiroshima', span: { from: 19450806, to: 19450806 } }],
  [WARSAW_UPRISING, { ...NOT, label: 'Warsaw Uprising', span: { from: 19440801, to: 19441002 } }],
  [GHETTO_UPRISING, { ...NOT, label: 'Warsaw Ghetto Uprising', span: { from: 19430419, to: 19430516 } }],
  // The subset keeps no item a lead alone links: what Roman Shukhevych is, it does not know.
  [SHUKHEVYCH, { ...NOT, label: 'Roman Shukhevych', event: false, occurrence: false }],
  [ATATURK, { ...NOT, label: 'Mustafa Kemal Atatürk', event: false, occurrence: false, human: true }],
  [DANIEL_LINDLEY, { ...NOT, label: 'Daniel Lindley', event: false, occurrence: false }],
  // Wikidata dates the Holocaust by years: 1933 to 1945.
  [HOLOCAUST, { ...NOT, label: 'The Holocaust', span: { from: 19330000, to: 19450000 } }],
  [SIEGE_OF_WARSAW, { ...NOT, label: 'Siege of Warsaw', span: { from: 19390908, to: 19390928 } }],
]);
/** What a place says beside its reading: by default, a lead that was read and links nothing. */
const said = (over: Partial<WarEvidence> = {}): WarEvidence => ({ events: [], depicts: [], dedicated: [], linked: [], ...over });
const subject = (item: string) => ({ item, label: KINDS.get(item)!.label, articleUrl: null });
const categoryReading = (...items: string[]) => ({ via: 'memorials-category' as const, subjects: items.map(subject) });
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
    expect(narrowWars(WAR_READING(WW2, 'World War II'), said({ dedicated: [MILITARY, BERLIN] }), KINDS, ARTICLES)).toEqual({
      via: 'war-narrowed-by-lead',
      subjects: [{ item: BERLIN, label: 'Battle of Berlin', articleUrl: 'https://en.wikipedia.org/wiki/Battle_of_Berlin' }],
    });
  });

  it('takes an event a dedication sentence links within the war, armed conflict or not', () => {
    // Bucharest's Arcul de Triumf "commemorates Romania's victory in the First World War".
    expect(narrowWars(categoryReading(WW1), said({ dedicated: [ROMANIA_IN_WW1] }), KINDS, ARTICLES))
      .toEqual({ via: 'war-narrowed-by-lead', subjects: [subject(ROMANIA_IN_WW1)] });
  });

  it('keeps the war where the lead links only the war itself, a war after it, or no event', () => {
    const reading = WAR_READING(WW1, 'World War I');
    expect(narrowWars(reading, said({ dedicated: [WW1, GULF_WAR, MILITARY] }), KINDS, ARTICLES)).toBe(reading);
    // The Westerplatte Monument's lead links the peninsula beside the battle: the battle alone is read.
    expect(narrowWars(WAR_READING(WW2, 'World War II'), said({ dedicated: [WESTERPLATTE, BERLIN] }), KINDS, ARTICLES).subjects.map((s) => s.item))
      .toEqual([BERLIN]);
  });

  it('narrows nothing that is not a war, and keeps what else the reading names', () => {
    const reading = { via: 'commemorates' as const, subjects: [{ item: BERLIN, label: 'Battle of Berlin', articleUrl: null }] };
    expect(narrowWars(reading, said({ dedicated: [BERLIN] }), KINDS, ARTICLES)).toBe(reading);
    const both = { via: 'commemorates' as const, subjects: [{ item: MILITARY, label: 'military', articleUrl: null }, WAR_READING(WW2, 'World War II').subjects[0]] };
    expect(narrowWars(both, said({ dedicated: [BERLIN] }), KINDS, ARTICLES).subjects.map((s) => s.item)).toEqual([MILITARY, BERLIN]);
  });

  it('narrows first to the place\'s own significant event within the war', () => {
    // The Hiroshima Peace Memorial, under *World War II memorials in Japan*.
    expect(narrowWars(categoryReading(WW2), said({ events: [BOMBING_OF_HIROSHIMA], dedicated: [BERLIN] }), KINDS, ARTICLES))
      .toEqual({ via: 'war-narrowed-by-event', subjects: [subject(BOMBING_OF_HIROSHIMA)] });
  });

  it('reads the event the categories name beside their war where the place\'s story tells it, and the war no more', () => {
    const reading = categoryReading(WW2, GHETTO_UPRISING);
    expect(narrowWars(reading, said({ linked: [GHETTO_UPRISING] }), KINDS, ARTICLES))
      .toEqual({ via: 'memorials-category', subjects: [subject(GHETTO_UPRISING)] });
  });

  it('reads what the lead dedicates the place to before what the categories name beside the war', () => {
    // The Monument to the Heroes of Warsaw, among the Warsaw Uprising's memorials, is raised to the heroes of 1939 to 1945.
    const reading = categoryReading(WW2, WARSAW_UPRISING);
    expect(narrowWars(reading, said({ dedicated: [GHETTO_UPRISING, WARSAW_UPRISING], linked: [GHETTO_UPRISING, WARSAW_UPRISING] }), KINDS, ARTICLES))
      .toEqual({ via: 'war-narrowed-by-lead', subjects: [subject(GHETTO_UPRISING), subject(WARSAW_UPRISING)] });
  });

  it('drops an event the categories name inside their war that the place\'s story never tells', () => {
    // Miła 18 is filed among the 1944 Warsaw Uprising's memorials; its lead never names that uprising.
    expect(narrowWars(categoryReading(WW2, WARSAW_UPRISING), said({ linked: [MILITARY] }), KINDS, ARTICLES))
      .toEqual({ via: 'memorials-category', subjects: [subject(WW2)] });
  });

  it('drops an event the categories name that overlaps their war where the place\'s story never tells it (#2416)', () => {
    // The Monument to the Heroes of Warsaw is filed among Warsaw's Holocaust memorials; its lead links the siege and the uprisings.
    const reading = categoryReading(WW2, WARSAW_UPRISING, HOLOCAUST);
    const said3 = said({ dedicated: [SIEGE_OF_WARSAW, GHETTO_UPRISING, WARSAW_UPRISING], linked: [SIEGE_OF_WARSAW, GHETTO_UPRISING, WARSAW_UPRISING] });
    expect(narrowWars(reading, said3, KINDS, ARTICLES).subjects.map((s) => s.item)).toEqual([SIEGE_OF_WARSAW, GHETTO_UPRISING, WARSAW_UPRISING]);
    expect(overlaps({ from: 19330000, to: 19450000 }, { from: 19390901, to: 19450902 })).toBe(true);
    expect(overlaps({ from: 19190506, to: 19190808 }, { from: 19140728, to: 19181111 })).toBe(false);
  });

  it('drops nothing where the lead was not read, and nothing a statement of the place names', () => {
    const categories = categoryReading(WW2, WARSAW_UPRISING);
    expect(narrowWars(categories, said({ linked: null }), KINDS, ARTICLES)).toBe(categories);
    const stated = { ...categories, via: 'commemorates' as const };
    expect(narrowWars(stated, said(), KINDS, ARTICLES)).toBe(stated);
  });

  it('reads the one person a bust of a war\'s reading shows, by its name or its depicts statement', () => {
    const bust = categoryReading(WW2);
    // The bust of Roman Shukhevych in Edmonton: his article is a biography, which the run asked of English Wikipedia.
    expect(narrowWars(bust, said({ linked: [SHUKHEVYCH], biographies: [SHUKHEVYCH], name: 'Roman Shukhevych statue' }), KINDS, ARTICLES))
      .toEqual({ via: 'war-narrowed-to-person', subjects: [subject(SHUKHEVYCH)] });
    expect(narrowWars(bust, said({ depicts: [ATATURK, MILITARY] }), KINDS, ARTICLES))
      .toEqual({ via: 'war-narrowed-to-person', subjects: [subject(ATATURK)] });
  });

  it('reads no person the place\'s name does not carry, none English Wikipedia does not file as one, and none beside another subject', () => {
    const bust = categoryReading(WW2);
    expect(narrowWars(bust, said({ linked: [SHUKHEVYCH], biographies: [SHUKHEVYCH], name: 'Edmonton monument' }), KINDS, ARTICLES)).toBe(bust);
    expect(narrowWars(bust, said({ linked: [SHUKHEVYCH], name: 'Roman Shukhevych statue' }), KINDS, ARTICLES)).toBe(bust);
    // The town of Lindley carries the surname of the missionary it was named after, not his name.
    expect(narrowWars(bust, said({ linked: [DANIEL_LINDLEY], biographies: [DANIEL_LINDLEY], name: 'Lindley' }), KINDS, ARTICLES)).toBe(bust);
    // Canberra's Kemal Atatürk Memorial names him and World War I, and keeps both.
    const memorial = categoryReading(ATATURK, WW1);
    expect(narrowWars(memorial, said({ linked: [ATATURK], name: 'Kemal Atatürk Memorial' }), KINDS, ARTICLES)).toBe(memorial);
  });

  it('holds a span within another only wholly inside it', () => {
    expect(within({ from: 19450416, to: 19450502 }, { from: 19390901, to: 19450902 })).toBe(true);
    expect(within({ from: 19190506, to: 19190808 }, { from: 19140728, to: 19181111 })).toBe(false);
  });
});

describe('the links of a lead and the categories of a biography', () => {
  it('reads every link of a lead\'s prose, whatever the sentence says', () => {
    expect(leadLinks('{{Infobox|[[Edmonton]]}} The bust of the nationalist [[Roman Shukhevych]] stands in [[Edmonton]].'))
      .toEqual(['Roman Shukhevych', 'Edmonton']);
  });

  it('knows a biography by its years and by *Living people*, and nothing else by them', () => {
    expect(['1907 births', '1950 deaths', '4th-century BC births', 'Living people'].every((c) => BIOGRAPHY_CATEGORY.test(c))).toBe(true);
    expect(['Deaths in Lviv', 'Births of royal children', '1973 sculptures'].some((c) => BIOGRAPHY_CATEGORY.test(c))).toBe(false);
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
