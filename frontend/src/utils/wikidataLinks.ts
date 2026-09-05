/**
 * Where a Wikidata id can take a curator, built in one place.
 *
 * Every museum, monument and work in the catalogue is known to its source by a
 * Wikidata item id, and the next move on a curator's screen is almost always to
 * open what the source actually says. Two pages answer that: the item itself,
 * and the Wikipedia article Wikidata links it to — which the catalogue stores
 * for experiences but never for works, and stores in English only. Wikidata's
 * own redirect answers for any language without anything being stored:
 * `Special:GoToLinkedPage/<lang>wiki/<QID>` is a 302 to the article when the
 * sitelink exists, and Wikidata's own "no page found for that combination"
 * form when it does not — a page that says so, not a 404.
 *
 * Built only from an id that *is* a QID. The other ids in the catalogue are a
 * World Heritage number (`738`) and a curator-created row's own, and a template
 * literal over `external_id` would turn either into an address that is not a
 * page. Lived as two private copies (`fieldMeaning.tsx`, `WorksPreview.tsx`)
 * and one unguarded template literal over a model-supplied id (the import
 * tree's AI enrichment, `ImportTreeDialogs.tsx`) until the id chip needed a
 * fourth (#806).
 */

const QID = /^Q\d+$/;

/** A wiki's language code as it appears in a site id: `en`, `zh-min-nan`, `be-tarask`. */
// eslint-disable-next-line security/detect-unsafe-regex -- every repeated group opens on a literal `-` that the class before it cannot match, so no input matches two ways and the match is linear
const LANGUAGE_CODE = /^[a-z]+(-[a-z]+)*$/;

/**
 * The item's own page, or nothing for an id that is not a Wikidata item.
 *
 * `unknown` rather than `string`, because one caller reads the id out of a
 * proposed value a run filed as JSON (`fieldMeaning.tsx`), and the check that
 * it is a string belongs with the check that it is a QID.
 */
export function wikidataItemUrl(id: unknown): string | null {
  return typeof id === 'string' && QID.test(id) ? `https://www.wikidata.org/wiki/${id}` : null;
}

/**
 * The Wikipedia article for an item in a language, resolved by Wikidata at the
 * time of the click rather than stored.
 *
 * English by default: every article the catalogue stores today is the English
 * one, and the product has no language rule yet. When it has one, this is the
 * argument it sets.
 */
export function wikipediaArticleUrl(id: unknown, lang = 'en'): string | null {
  if (typeof id !== 'string' || !QID.test(id) || !LANGUAGE_CODE.test(lang)) return null;
  return `https://www.wikidata.org/wiki/Special:GoToLinkedPage/${lang}wiki/${id}`;
}
