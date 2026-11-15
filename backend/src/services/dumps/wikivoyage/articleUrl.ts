/**
 * Where a kept Wikivoyage article is read (#2520): its edition's own host and
 * its own title, never the place's Wikipedia article or a Wikidata sitelink.
 *
 * An edition is named by its database name, as the dumps and
 * `wikivoyage_articles` name it (`dewikivoyage`), and its language is the
 * host's first label (`de.wikivoyage.org`). A title is written the way
 * MediaWiki writes its own links (`wfUrlencode`): spaces become underscores,
 * every other character is percent-encoded as UTF-8, and the characters a
 * path may carry as they are stay readable. A slash stays one, since a
 * district of a city is a subpage (`London/Westminster`), and a colon stays
 * one. A question mark, a hash, an ampersand and a percent sign are encoded,
 * so a title never ends the path early.
 */

/** The language of an edition, as its host names it: `dewikivoyage` → `de`, `shnwikivoyage` → `shn`. */
export function editionLanguage(site: string): string {
  return site.replace(/wikivoyage$/, '').replace(/_/g, '-');
}

/** The characters MediaWiki leaves unencoded in an article's path that `encodeURIComponent` encodes. */
const READABLE = /%(3B|40|24|2C|2F|3A)/g;

/** The address of an edition's article: `dewikivoyage`, `Mantineia` → `https://de.wikivoyage.org/wiki/Mantineia`. */
export function wikivoyageArticleUrl(site: string, title: string): string {
  const path = encodeURIComponent(title.replaceAll(' ', '_')).replace(READABLE, escaped => decodeURIComponent(escaped));
  return `https://${editionLanguage(site)}.wikivoyage.org/wiki/${path}`;
}
