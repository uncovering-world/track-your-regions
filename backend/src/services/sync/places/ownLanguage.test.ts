/**
 * The article of a place in its country's language (#2491). The places are
 * real, read off the #2435 measurement on 2026-11-12: the Monument to Peter
 * the Great in Arkhangelsk (Q4343300) in Russia (Q159), and Victory Monument,
 * Minsk (Q3831641), whose lead the measurement read in Belarusian; and, read
 * off the development subset, Standard Chinese (Q727694, under Q2169652), Chinese
 * (Q7850), Moldovan (Q36392) and Romanian (Q7913). Every other
 * id below is synthetic, `Q9000000…`, and marked so: the countries and
 * languages stand for kinds of country (one language, two, English among
 * them), not for any item. The article titles are written for the test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../subset/entities.js', async (actual) => ({ ...(await actual<object>()), entitiesOf: vi.fn() }));
vi.mock('../../../db/index.js', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

import type { CompactEntity, CompactStatement } from '../../dumps/wikidata/compactEntity.js';
import { entitiesOf, type Kept } from '../subset/entities.js';
import { subsetDoor } from '../subset/reader.js';
import type { LanguageFacts } from '../subset/ownLanguage.js';
import { pool } from '../../../db/index.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { codesOfLanguages, type LanguageNode } from './languageCodes.js';
import { fetchOwnLanguageArticles, ownArticleOf } from './ownLanguage.js';

const PETER_MONUMENT = 'Q4343300';
const RUSSIA = 'Q159';
const VICTORY_MONUMENT_MINSK = 'Q3831641';
/** Synthetic ids, standing for no real item. */
const SYNTHETIC = {
  belarus: 'Q900000001',
  canadaLike: 'Q900000002',
  englishOnly: 'Q900000003',
  place: 'Q900000004',
  russian: 'Q900000011',
  belarusian: 'Q900000012',
  regional: 'Q900000013',
  formerCountry: 'Q900000021',
  step: 'Q900000031',
  deeper: 'Q900000032',
};

function facts(countries: Record<string, string[]>, languages: Record<string, string[]>, sitelinks: Record<string, Record<string, string>>): LanguageFacts {
  return { countries: new Map(Object.entries(countries)), languages: new Map(Object.entries(languages)), sitelinks: new Map(Object.entries(sitelinks)) };
}

describe('the article in the country\'s language', () => {
  it('is the first language of the country whose edition writes about the place', () => {
    const known = facts({ [PETER_MONUMENT]: [RUSSIA] }, { [RUSSIA]: ['ru'] }, { [PETER_MONUMENT]: { ruwiki: 'Памятник Петру I', dewiki: 'Peter-I.-Denkmal' } });
    expect(ownArticleOf(PETER_MONUMENT, known)).toEqual({ wiki: 'ruwiki', host: 'ru', language: 'ru', title: 'Памятник Петру I' });
  });

  it('takes the languages in their order, and passes over one whose edition has no article', () => {
    const languages = { [SYNTHETIC.belarus]: ['be', 'ru'] };
    const both = facts({ [VICTORY_MONUMENT_MINSK]: [SYNTHETIC.belarus] }, languages, { [VICTORY_MONUMENT_MINSK]: { bewiki: 'Манумент Перамогі', ruwiki: 'Монумент Победы' } });
    expect(ownArticleOf(VICTORY_MONUMENT_MINSK, both)?.wiki).toBe('bewiki');
    const russianOnly = facts({ [VICTORY_MONUMENT_MINSK]: [SYNTHETIC.belarus] }, languages, { [VICTORY_MONUMENT_MINSK]: { ruwiki: 'Монумент Победы' } });
    expect(ownArticleOf(VICTORY_MONUMENT_MINSK, russianOnly)?.wiki).toBe('ruwiki');
  });

  it('passes over English, whose lead the step has read: a country of English alone has none, one of English and French reads French', () => {
    const known = facts(
      { [SYNTHETIC.place]: [SYNTHETIC.canadaLike], [PETER_MONUMENT]: [SYNTHETIC.englishOnly] },
      { [SYNTHETIC.canadaLike]: ['en', 'fr'], [SYNTHETIC.englishOnly]: ['en'] },
      { [SYNTHETIC.place]: { enwiki: 'A place', frwiki: 'Un lieu' }, [PETER_MONUMENT]: { enwiki: 'A monument' } },
    );
    expect(ownArticleOf(SYNTHETIC.place, known)).toMatchObject({ wiki: 'frwiki', language: 'fr' });
    expect(ownArticleOf(PETER_MONUMENT, known)).toBeNull();
  });

  it('names an edition as Wikidata\'s sitelinks do, and its host as its address does', () => {
    const known = facts({ [SYNTHETIC.place]: [SYNTHETIC.belarus] }, { [SYNTHETIC.belarus]: ['nb'] }, { [SYNTHETIC.place]: { nowiki: 'Et sted' } });
    expect(ownArticleOf(SYNTHETIC.place, known)).toEqual({ wiki: 'nowiki', host: 'no', language: 'nb', title: 'Et sted' });
  });

  it('asks no host a code spells otherwise than an edition, whatever the place\'s sitelinks hold', () => {
    const known = facts({ [SYNTHETIC.place]: [SYNTHETIC.belarus] }, { [SYNTHETIC.belarus]: ['evil.example/x'] },
      { [SYNTHETIC.place]: { 'evil.example/xwiki': 'A title' } });
    expect(ownArticleOf(SYNTHETIC.place, known)).toBeNull();
  });

  it('is none for a place with no country', () => {
    expect(ownArticleOf(PETER_MONUMENT, facts({}, { [RUSSIA]: ['ru'] }, { [PETER_MONUMENT]: { ruwiki: 'Памятник Петру I' } }))).toBeNull();
  });
});

const statement = (value: string, qualifiers?: CompactStatement['qualifiers'], rank?: CompactStatement['rank']): CompactStatement => ({
  id: `s-${value}`, value, ...(qualifiers ? { qualifiers } : {}), ...(rank ? { rank } : {}),
});
const kept = (id: string, claims: CompactEntity['claims'], sitelinks: Record<string, string> = {}): Kept => ({
  sitelinks: Object.keys(sitelinks).length,
  entity: { id, labels: {}, descriptions: {}, claims, sitelinks },
});

/** `entitiesOf` over these entities: an id the subset does not keep has no entry. */
const serve = (entities: ReadonlyMap<string, Kept>) => async (ids: string[] = []) => new Map(ids.flatMap((id) => {
  const entity = entities.get(id);
  return entity ? [[id, entity] as const] : [];
}));

describe('the facts the subset holds', () => {
  beforeEach(() => {
    vi.mocked(entitiesOf).mockReset();
    vi.mocked(pool.query).mockClear();
  });

  it('reads standing countries, their nationwide official languages\' codes, and the place\'s Wikipedia articles', async () => {
    const entities = new Map<string, Kept>([
      [PETER_MONUMENT, kept(PETER_MONUMENT, {
        P17: [statement(SYNTHETIC.formerCountry, { P582: [{ time: '+1917-00-00T00:00:00Z' }] }), statement(RUSSIA)],
      }, { ruwiki: 'Памятник Петру I', commonswiki: 'Category:Monument', enwikivoyage: 'Arkhangelsk' })],
      [RUSSIA, kept(RUSSIA, {
        // A language official in one part of the country only is that part's.
        P37: [statement(SYNTHETIC.regional, { P518: ['Q900000099'] }), statement(SYNTHETIC.russian)],
      })],
      [SYNTHETIC.russian, kept(SYNTHETIC.russian, { P424: [statement('ru')] })],
      [SYNTHETIC.regional, kept(SYNTHETIC.regional, { P424: [statement('xx')] })],
    ]);
    vi.mocked(entitiesOf).mockImplementation(serve(entities));
    const own = await fetchOwnLanguageArticles(subsetDoor(vi.fn()), [PETER_MONUMENT]);
    expect(own.get(PETER_MONUMENT)).toEqual({ wiki: 'ruwiki', host: 'ru', language: 'ru', title: 'Памятник Петру I' });
    // The ended country is not read, and the regional language is never asked for its code's edition.
    expect(vi.mocked(entitiesOf).mock.calls[1][0]).toEqual([RUSSIA]);
    expect(vi.mocked(entitiesOf).mock.calls[2][0]).toEqual([SYNTHETIC.russian]);
  });

  it('reads no place in a regional language where that is the only one with an article', async () => {
    const entities = new Map<string, Kept>([
      [SYNTHETIC.place, kept(SYNTHETIC.place, { P17: [statement(RUSSIA)] }, { xxwiki: 'A regional title' })],
      [RUSSIA, kept(RUSSIA, { P37: [statement(SYNTHETIC.regional, { P3005: ['Q900000099'] }), statement(SYNTHETIC.russian)] })],
      [SYNTHETIC.russian, kept(SYNTHETIC.russian, { P424: [statement('ru')] })],
      [SYNTHETIC.regional, kept(SYNTHETIC.regional, { P424: [statement('xx')] })],
    ]);
    vi.mocked(entitiesOf).mockImplementation(serve(entities));
    expect((await fetchOwnLanguageArticles(subsetDoor(vi.fn()), [SYNTHETIC.place])).size).toBe(0);
  });

  it('asks nothing for no place', async () => {
    expect((await fetchOwnLanguageArticles(subsetDoor(vi.fn()), [])).size).toBe(0);
    expect(entitiesOf).not.toHaveBeenCalled();
  });
});

describe('the code of a language that carries none of its own', () => {
  // Real ids, read off the development subset: Standard Chinese (Q727694), official in China and Taiwan,
  // is a subclass of Q2169652 and up its chain of Chinese (Q7850, `zh`); Moldovan (Q36392) of Romanian (Q7913, `ro`).
  // The step between Q2169652 and Q7850 is synthetic, and so is its code, which names no edition.
  const STANDARD_CHINESE = 'Q727694';
  const STANDARD_CHINESE_PARENT = 'Q2169652';
  const CHINESE = 'Q7850';
  const MOLDOVAN = 'Q36392';
  const ROMANIAN = 'Q7913';
  const NODES: Record<string, LanguageNode> = {
    [STANDARD_CHINESE]: { codes: [], parents: [STANDARD_CHINESE_PARENT] },
    [STANDARD_CHINESE_PARENT]: { codes: [], parents: [SYNTHETIC.step] },
    [SYNTHETIC.step]: { codes: ['xx-noedition'], parents: [CHINESE] },
    [CHINESE]: { codes: ['zh'], parents: [] },
    [MOLDOVAN]: { codes: [], parents: [ROMANIAN] },
    [ROMANIAN]: { codes: ['ro'], parents: [] },
  };
  const EDITIONS = new Set(['zh', 'ro', 'ru', 'be']);
  const read = (nodes: Record<string, LanguageNode>) => vi.fn(async (ids: string[]) => new Map(ids.flatMap((id) => (nodes[id] ? [[id, nodes[id]] as const] : []))));
  const editions = vi.fn(async (codes: string[]) => new Set(codes.filter((code) => EDITIONS.has(code))));

  it('is its nearest ancestor\'s that names an edition, three steps up at most, a code naming none passed over', async () => {
    const codes = await codesOfLanguages([STANDARD_CHINESE, MOLDOVAN, ROMANIAN], read(NODES), editions);
    expect(codes).toEqual(new Map([[STANDARD_CHINESE, ['zh']], [MOLDOVAN, ['ro']], [ROMANIAN, ['ro']]]));
  });

  it('is none past three steps, and none where the chain reaches an item the reader does not know', async () => {
    const longer = { ...NODES, [SYNTHETIC.step]: { codes: [], parents: [SYNTHETIC.deeper] }, [SYNTHETIC.deeper]: { codes: [], parents: [CHINESE] } };
    expect((await codesOfLanguages([STANDARD_CHINESE], read(longer), editions)).size).toBe(0);
    const withoutRomanian = Object.fromEntries(Object.entries(NODES).filter(([id]) => id !== ROMANIAN));
    expect((await codesOfLanguages([MOLDOVAN], read(withoutRomanian), editions)).size).toBe(0);
  });

  it('walks breadth-first, parents in their order: a nearer ancestor answers before a farther one, the first parent before the second', async () => {
    const nodes: Record<string, LanguageNode> = {
      [SYNTHETIC.place]: { codes: [], parents: [SYNTHETIC.step, MOLDOVAN, ROMANIAN] },
      [SYNTHETIC.step]: { codes: [], parents: [CHINESE] },
      [MOLDOVAN]: { codes: [], parents: [] },
      [ROMANIAN]: { codes: ['ro'], parents: [] },
      [CHINESE]: { codes: ['zh'], parents: [] },
    };
    expect(await codesOfLanguages([SYNTHETIC.place], read(nodes), editions)).toEqual(new Map([[SYNTHETIC.place, ['ro']]]));
    const swapped = { ...nodes, [SYNTHETIC.place]: { codes: [], parents: [SYNTHETIC.step, CHINESE, ROMANIAN] } };
    expect(await codesOfLanguages([SYNTHETIC.place], read(swapped), editions)).toEqual(new Map([[SYNTHETIC.place, ['zh']]]));
  });

  it('reads Moldova\'s places in Romanian from the subset, never its own ISO codes', async () => {
    const entities = new Map<string, Kept>([
      [SYNTHETIC.place, kept(SYNTHETIC.place, { P17: [statement(SYNTHETIC.belarus)] }, { rowiki: 'Un monument', mowiki: 'Ун монумент' })],
      [SYNTHETIC.belarus, kept(SYNTHETIC.belarus, { P37: [statement(MOLDOVAN)] })],
      [MOLDOVAN, kept(MOLDOVAN, { P218: [statement('mo')], P279: [statement(ROMANIAN)] })],
      [ROMANIAN, kept(ROMANIAN, { P424: [statement('ro')] })],
    ]);
    vi.mocked(entitiesOf).mockImplementation(serve(entities));
    vi.mocked(pool.query).mockImplementation((async (_sql: string, [sites]: [string[]]) => ({
      rows: sites.filter((site) => ['rowiki', 'mowiki'].includes(site)).map((site) => ({ site })),
    })) as never);
    const own = await fetchOwnLanguageArticles(subsetDoor(vi.fn()), [SYNTHETIC.place]);
    expect(own.get(SYNTHETIC.place)).toEqual({ wiki: 'rowiki', host: 'ro', language: 'ro', title: 'Un monument' });
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual([['rowiki']]);
  });
});

describe('the facts asked live', () => {
  const uri = (id: string) => ({ value: `http://www.wikidata.org/entity/${id}` });
  const STANDARD_CHINESE = 'Q727694';
  const CHINESE = 'Q7850';

  /** The live query service, answering each question by its label. */
  function live(answers: { languages: object[]; nodes: Record<string, object[]>; sites: string[]; articles: object[] }) {
    return vi.fn(async (query: string, descriptor?: { label?: string }) => {
      const label = descriptor?.label ?? '';
      if (label.startsWith('the official languages')) return answers.languages;
      if (label.startsWith('the codes and parents')) return Object.entries(answers.nodes).filter(([id]) => query.includes(`wd:${id} `) || query.includes(`wd:${id}}`)).flatMap(([, rows]) => rows);
      if (label.startsWith('which of')) return answers.sites.filter((site) => query.includes(`<${site}>`)).map((site) => ({ site: { value: site } }));
      if (label.startsWith('the Wikipedia articles')) return answers.articles;
      throw new Error(`unexpected question: ${label}`);
    }) as unknown as SparqlFn & ReturnType<typeof vi.fn>;
  }

  it('takes countries and languages in item order, the live answer keeping none, and leaves out a regional language', async () => {
    const sparql = live({
      languages: [
        { e: uri(VICTORY_MONUMENT_MINSK), country: uri(SYNTHETIC.belarus), language: uri(SYNTHETIC.belarusian) },
        { e: uri(VICTORY_MONUMENT_MINSK), country: uri(SYNTHETIC.belarus), language: uri(SYNTHETIC.russian) },
      ],
      nodes: { [SYNTHETIC.belarusian]: [{ l: uri(SYNTHETIC.belarusian), code: { value: 'be' } }], [SYNTHETIC.russian]: [{ l: uri(SYNTHETIC.russian), code: { value: 'ru' } }] },
      sites: [],
      articles: [
        { e: uri(VICTORY_MONUMENT_MINSK), site: { value: 'https://be.wikipedia.org/' }, title: { value: 'Манумент Перамогі' } },
        { e: uri(VICTORY_MONUMENT_MINSK), site: { value: 'https://ru.wikipedia.org/' }, title: { value: 'Монумент Победы' } },
      ],
    });
    const own = await fetchOwnLanguageArticles(sparql, [VICTORY_MONUMENT_MINSK]);
    // The synthetic Russian language's id is the lower one, so it is read first.
    expect(own.get(VICTORY_MONUMENT_MINSK)).toEqual({ wiki: 'ruwiki', host: 'ru', language: 'ru', title: 'Монумент Победы' });
    const [query] = sparql.mock.calls[0] as unknown as [string];
    expect(query).toContain('ps:P37 ?language');
    expect(query).toContain('pq:P518');
    expect(query).toContain('pq:P3005');
  });

  it('walks a language with no code up its parents as the subset does, asking which codes name a Wikipedia', async () => {
    const sparql = live({
      languages: [{ e: uri(SYNTHETIC.place), country: uri(SYNTHETIC.belarus), language: uri(STANDARD_CHINESE) }],
      nodes: {
        [STANDARD_CHINESE]: [{ l: uri(STANDARD_CHINESE), parent: uri(SYNTHETIC.step) }],
        [SYNTHETIC.step]: [{ l: uri(SYNTHETIC.step), code: { value: 'xx-noedition' } }, { l: uri(SYNTHETIC.step), parent: uri(CHINESE) }],
        [CHINESE]: [{ l: uri(CHINESE), code: { value: 'zh' } }],
      },
      sites: ['https://zh.wikipedia.org/'],
      articles: [{ e: uri(SYNTHETIC.place), site: { value: 'https://zh.wikipedia.org/' }, title: { value: '纪念碑' } }],
    });
    const own = await fetchOwnLanguageArticles(sparql, [SYNTHETIC.place]);
    expect(own.get(SYNTHETIC.place)).toEqual({ wiki: 'zhwiki', host: 'zh', language: 'zh', title: '纪念碑' });
  });
});
