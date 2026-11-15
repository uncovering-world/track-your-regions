/**
 * The article of a place in the language of the country it stands in
 * (#2491): where a monument's English lead names no dedication, or it has no
 * English article, the lead step reads this one (`leadDedication.ts`). The
 * Monument to Peter the Great in Arkhangelsk says on the Russian Wikipedia
 * whom it was raised to; the Democracy Monument in Bangkok on the Thai one
 * what it commemorates.
 *
 * The language is the country's, as Wikidata states it: the place's standing
 * countries (`P17` at its best rank, no end time), each country's official
 * languages (`P37`, the same, and none confined to a part of the country by
 * `REGIONAL_QUALIFIERS`), each language's Wikimedia language code (`P424`, or,
 * where it has none, its nearest ancestor's up its `P279` chain that names an
 * edition, `codesOfLanguages`: Standard Chinese reads Chinese's `zh`), and
 * the edition that code names (`wikiOfLanguage`). The first of them, country by
 * country and language by language, whose edition holds an article about the
 * place is its own (`ownArticleOf`); English is passed over, since the step has
 * read the English lead already: a place in the United States has none, a
 * place in India is read in Hindi, a place in Canada in French. The order is
 * the statements' own in the subset, which is the order Wikidata's editors
 * list them in, and the items' order where the live query service answers,
 * which keeps none (as `fetchSubjectClaims` sorts its live answer).
 *
 * The rule is a country's, and it is temporary (ADR-0208): it is replaced by
 * the languages each region lists once regions store them (#1905), and this
 * module and its subset twin are then deleted, not kept beside them. Until
 * then two cases read coarsely. A regional language its country does not hold
 * officially is not read: a monument in Barcelona is read in Spanish, since
 * Catalan is Catalonia's official language and not Spain's, and one in Kazan
 * in Russian, not Tatar. And a place whose `P17` names more than one country,
 * as Crimea's name Ukraine and Russia, is read in the first country's language
 * by that order, which is an order and no judgement about the territory.
 */

import { readsSubset } from '../subset/reader.js';
import { REGIONAL_QUALIFIERS, subsetLanguageFacts, type LanguageFacts } from '../subset/ownLanguage.js';
import { chunk, standing, values, type SparqlFn } from '../wikidataQueries.js';
import { extractQid, isQid } from '../wikidataUtils.js';
import { editionHost, wikiOfHost, wikiOfLanguage } from '../../wikipediaEditionNames.js';
import { codesOfLanguages, type LanguageNode } from './languageCodes.js';

const BATCH = 50;

/** English Wikipedia, whose lead the step reads first. */
const ENGLISH = 'enwiki';

/**
 * A Wikipedia host as an edition's code spells it (`ru`, `be-tarask`,
 * `zh-min-nan`), as `wikipediaArticles.ts` reads a tag's: a host built from
 * anything else is asked nothing, whatever a language item's code says.
 */
const EDITION_HOST = /^[a-z][a-z-]{1,15}$/;

/** A place's article in its country's language. */
export interface OwnArticle {
  /** The edition, as Wikidata's sitelinks name it: `ruwiki`. */
  wiki: string;
  /** Its host before `.wikipedia.org`: `ru`. */
  host: string;
  /** The Wikimedia language code the country's language carries: `ru`. */
  language: string;
  /** The article's title on that edition. */
  title: string;
}

/** The place's article in the first language of its countries that has one and is not English, or null. */
export function ownArticleOf(qid: string, facts: LanguageFacts): OwnArticle | null {
  const sitelinks = facts.sitelinks.get(qid) ?? {};
  for (const country of facts.countries.get(qid) ?? []) {
    for (const language of facts.languages.get(country) ?? []) {
      const wiki = wikiOfLanguage(language);
      const title = wiki === ENGLISH ? undefined : sitelinks[wiki];
      const host = editionHost(wiki);
      if (title && EDITION_HOST.test(host)) return { wiki, host, language, title };
    }
  }
  return null;
}

/** Item ids by their number. */
const byItem = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));

/** `value` added to the list `key` holds in `map`, once. */
function addOnce(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
}

/** An edition's address as the live query service names its site: `https://ru.wikipedia.org/`. */
const SITE = /^https:\/\/([a-z][a-z-]{1,15})\.wikipedia\.org\/$/;

/** Each place's standing countries and each country's nationwide official languages, live, in item order. */
async function liveLanguagesOf(sparql: SparqlFn, qids: string[]): Promise<Pick<LanguageFacts, 'countries'> & { languagesOf: Map<string, string[]> }> {
  const rows: Array<{ place: string; country: string; language: string }> = [];
  for (const batch of chunk(qids, BATCH)) {
    const answer = await sparql(`
      SELECT ?e ?country ?language WHERE {
        VALUES ?e { ${values(batch)} }
        ${standing('?e', 'P17', '?country')}
        ${standing('?country', 'P37', '?language')}
        ${REGIONAL_QUALIFIERS.map((qualifier) => `FILTER NOT EXISTS { ?st37 pq:${qualifier} ?confined${qualifier.slice(1)} }`).join('\n        ')}
      }`, { kind: 'edges', label: `the official languages of ${batch.length} places' countries` });
    for (const row of answer) {
      const [place, country, language] = [row.e, row.country, row.language].map((cell) => extractQid(cell?.value ?? ''));
      if (isQid(place) && isQid(country) && isQid(language)) rows.push({ place, country, language });
    }
  }
  const countries = new Map<string, string[]>();
  const languagesOf = new Map<string, string[]>();
  for (const row of rows.sort((a, b) => byItem(a.country, b.country) || byItem(a.language, b.language))) {
    addOnce(countries, row.place, row.country);
    addOnce(languagesOf, row.country, row.language);
  }
  return { countries, languagesOf };
}

/** What each language item says of itself, live (`codesOfLanguages`): its codes sorted, its parents in item order. */
async function liveLanguageNodes(sparql: SparqlFn, ids: string[]): Promise<Map<string, LanguageNode>> {
  const out = new Map<string, LanguageNode>();
  for (const batch of chunk(ids, BATCH)) {
    const answer = await sparql(`
      SELECT ?l ?code ?parent WHERE {
        VALUES ?l { ${values(batch)} }
        { ?l wdt:P424 ?code } UNION { ?l wdt:P279 ?parent }
      }`, { kind: 'edges', label: `the codes and parents of ${batch.length} languages` });
    for (const row of answer) {
      const id = extractQid(row.l?.value ?? '');
      if (!isQid(id)) continue;
      const node = out.get(id) ?? { codes: [], parents: [] };
      const parent = extractQid(row.parent?.value ?? '');
      if (row.code?.value && !node.codes.includes(row.code.value)) node.codes.push(row.code.value);
      if (isQid(parent) && !node.parents.includes(parent)) node.parents.push(parent);
      out.set(id, node);
    }
  }
  for (const node of out.values()) {
    node.codes.sort();
    node.parents.sort(byItem);
  }
  return out;
}

/** The codes whose edition the live query service knows as a Wikipedia; a code that spells no host is none. */
async function liveEditionCodes(sparql: SparqlFn, codes: string[]): Promise<Set<string>> {
  const hostOf = new Map(codes.map((code) => [code, editionHost(wikiOfLanguage(code))] as const));
  const hosts = [...new Set([...hostOf.values()].filter((host) => EDITION_HOST.test(host)))];
  if (!hosts.length) return new Set();
  const answer = await sparql(`
    SELECT ?site WHERE {
      VALUES ?site { ${hosts.map((host) => `<https://${host}.wikipedia.org/>`).join(' ')} }
      ?site wikibase:wikiGroup "wikipedia" .
    }`, { kind: 'edges', label: `which of ${hosts.length} language codes name a Wikipedia` });
  const known = new Set(answer.map((row) => SITE.exec(row.site?.value ?? '')?.[1]).filter((host): host is string => Boolean(host)));
  return new Set(codes.filter((code) => known.has(hostOf.get(code)!)));
}

/** Each place's Wikipedia articles, live, by site. */
async function liveSitelinks(sparql: SparqlFn, qids: string[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  for (const batch of chunk(qids, BATCH)) {
    const answer = await sparql(`
      SELECT ?e ?site ?title WHERE {
        VALUES ?e { ${values(batch)} }
        ?article schema:about ?e ; schema:isPartOf ?site ; schema:name ?title .
        ?site wikibase:wikiGroup "wikipedia" .
      }`, { kind: 'edges', label: `the Wikipedia articles of ${batch.length} places` });
    for (const row of answer) {
      const place = extractQid(row.e?.value ?? '');
      const host = SITE.exec(row.site?.value ?? '')?.[1];
      const title = row.title?.value;
      if (isQid(place) && host && title) out.set(place, { ...out.get(place), [wikiOfHost(host)]: title });
    }
  }
  return out;
}

/**
 * The facts live: the places' countries and their languages, each language's
 * code by the same walk as the subset's (`codesOfLanguages`), and the places'
 * articles. Countries, languages and parents are taken in item order, the
 * live answer keeping none.
 */
async function fetchLanguageFacts(sparql: SparqlFn, qids: string[]): Promise<LanguageFacts> {
  const { countries, languagesOf } = await liveLanguagesOf(sparql, qids);
  const codesOf = await codesOfLanguages(
    [...new Set([...languagesOf.values()].flat())],
    (ids) => liveLanguageNodes(sparql, ids),
    (codes) => liveEditionCodes(sparql, codes),
  );
  const languages = new Map<string, string[]>([...languagesOf].map(([country, official]) => [
    country, [...new Set(official.flatMap((language) => codesOf.get(language) ?? []))],
  ]));
  return { countries, languages, sitelinks: countries.size ? await liveSitelinks(sparql, [...countries.keys()]) : new Map() };
}

/**
 * Each place's article in its country's language, where it has one that is
 * not English, read through the run's door: the local subset where the run
 * reads it, the live query service otherwise.
 */
export async function fetchOwnLanguageArticles(sparql: SparqlFn, qids: string[]): Promise<Map<string, OwnArticle>> {
  const asked = [...new Set(qids)];
  if (!asked.length) return new Map();
  const facts = readsSubset(sparql) ? await subsetLanguageFacts(asked) : await fetchLanguageFacts(sparql, asked);
  return new Map(asked.flatMap((qid) => {
    const own = ownArticleOf(qid, facts);
    return own ? [[qid, own] as const] : [];
  }));
}
