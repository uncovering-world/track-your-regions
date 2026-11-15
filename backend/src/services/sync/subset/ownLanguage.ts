/**
 * What the local Wikidata subset says of the language a place's country
 * reads (#2491), as `fetchLanguageFacts` asks it live: the place's standing
 * countries (`P17`), each country's official languages (`P37`) as their
 * Wikimedia language codes (`P424`, or the nearest ancestor's,
 * `codesOfLanguages`), and the place's Wikipedia articles. The
 * choice among them is `ownArticleOf`'s (`places/ownLanguage.ts`).
 *
 * Temporary, as that rule is (ADR-0208): once regions store the languages
 * spoken and read in them (#1905), the step reads a region's list and this
 * file is deleted with `places/ownLanguage.ts`.
 */

import { entitiesOf } from './entities.js';
import { bestStatements, itemsOf, standingStatements, textOf } from './values.js';
import type { CompactStatement } from '../../dumps/wikidata/compactEntity.js';
import { NOT_WIKIPEDIA } from './kit.js';
import { pool } from '../../../db/index.js';
import { wikiOfLanguage } from '../../wikipediaEditionNames.js';
import { codesOfLanguages, type LanguageNode } from '../places/languageCodes.js';

/** What decides the language of a place's own article: its countries, their languages and its articles. */
export interface LanguageFacts {
  /** Each place's standing countries (`P17` at its best rank, with no end time), once each. */
  countries: Map<string, string[]>;
  /** Each country's official languages (`P37`, standing and nationwide) as Wikimedia language codes (`P424`), once each. */
  languages: Map<string, string[]>;
  /** Each place's Wikipedia articles, by site (`ruwiki`). */
  sitelinks: Map<string, Record<string, string>>;
}

/**
 * The qualifiers that confine an official language to a part of its country:
 * *applies to part* (`P518`) and *valid in place* (`P3005`). Such a language is
 * that part's, and a place elsewhere in the country is not read in it.
 */
export const REGIONAL_QUALIFIERS = ['P518', 'P3005'] as const;

/** An official-language statement that holds for the whole country: no qualifier confines it to a part. */
function nationwide(statement: CompactStatement): boolean {
  return REGIONAL_QUALIFIERS.every((qualifier) => !(statement.qualifiers?.[qualifier]?.length));
}

/**
 * The facts of `qids`, in the items' own statement order. A country, or a
 * language, the subset does not keep names none; a place it does not keep has
 * no entry.
 */
export async function subsetLanguageFacts(qids: string[]): Promise<LanguageFacts> {
  const facts: LanguageFacts = { countries: new Map(), languages: new Map(), sitelinks: new Map() };
  const places = await entitiesOf(qids);
  for (const [qid, { entity }] of places) {
    facts.countries.set(qid, [...new Set(itemsOf(standingStatements(entity.claims.P17)))]);
    facts.sitelinks.set(qid, Object.fromEntries(Object.entries(entity.sitelinks)
      .filter(([site]) => site.endsWith('wiki') && !NOT_WIKIPEDIA.includes(site))));
  }
  const countries = await entitiesOf([...new Set([...facts.countries.values()].flat())]);
  const languagesOf = new Map([...countries].map(([country, { entity }]) => [
    country, [...new Set(itemsOf(standingStatements(entity.claims.P37).filter(nationwide)))],
  ] as const));
  const codesOf = await codesOfLanguages([...new Set([...languagesOf.values()].flat())], subsetLanguageNodes, subsetEditionCodes);
  for (const [country, official] of languagesOf) {
    facts.languages.set(country, [...new Set(official.flatMap((language) => codesOf.get(language) ?? []))]);
  }
  return facts;
}

/** What each language item the subset keeps says of itself, in its statements' order (`codesOfLanguages`). */
async function subsetLanguageNodes(ids: string[]): Promise<Map<string, LanguageNode>> {
  return new Map([...await entitiesOf(ids)].map(([id, { entity }]) => [id, {
    codes: bestStatements(entity.claims.P424).map((statement) => textOf(statement.value)).filter((code): code is string => Boolean(code)),
    parents: itemsOf(bestStatements(entity.claims.P279)),
  }] as const));
}

/** The codes whose edition some item the subset keeps has an article on: an edition no sitelink names is none. */
async function subsetEditionCodes(codes: string[]): Promise<Set<string>> {
  const { rows } = await pool.query<{ site: string }>(
    `SELECT s.site FROM unnest($1::text[]) AS s(site)
      WHERE EXISTS (SELECT 1 FROM wikidata_sitelinks l WHERE l.site = s.site)`,
    [codes.map(wikiOfLanguage)],
  );
  const sites = new Set(rows.map((row) => row.site));
  return new Set(codes.filter((code) => sites.has(wikiOfLanguage(code))));
}
