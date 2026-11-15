/**
 * How a Wikipedia edition is named in each place it is written: the language
 * code a reader or Wikidata's *Wikimedia language code* (`P424`) gives, the
 * site key Wikidata's sitelinks use (`ruwiki`), and the host its pages and API
 * answer on (`ru.wikipedia.org`). Read by a reader's editions
 * (`wikipediaEditionsController.ts`, #2209) and by the lead of a place's
 * article in its country's language (`places/ownLanguage.ts`, #2491).
 */

/**
 * The edition a language names, as Wikidata's sitelinks name it: `ru` →
 * `ruwiki`, `zh-classical` → `zh_classicalwiki`. Two languages are written
 * otherwise: Norwegian Bokmål's edition is `no`, and Belarusian in the
 * Taraškievica spelling is `be_x_old`.
 */
export function wikiOfLanguage(language: string): string {
  if (language === 'nb') return 'nowiki';
  if (language === 'be-tarask') return 'be_x_oldwiki';
  return `${language.replace(/-/g, '_')}wiki`;
}

/** The host name before `.wikipedia.org` of an edition: `zh_classicalwiki` → `zh-classical`, `be_x_oldwiki` → `be-tarask`. */
export function editionHost(wiki: string): string {
  const site = wiki.replace(/wiki$/, '');
  return site === 'be_x_old' ? 'be-tarask' : site.replace(/_/g, '-');
}

/** The edition a host names, as Wikidata's sitelinks name it: `ru` → `ruwiki`, `be-tarask` → `be_x_oldwiki`; `editionHost` turned round. */
export function wikiOfHost(host: string): string {
  return host === 'be-tarask' ? 'be_x_oldwiki' : `${host.replace(/-/g, '_')}wiki`;
}

/** The address of an edition's article: `ruwiki`, `Старый музей` → `https://ru.wikipedia.org/wiki/Старый_музей`, escaped. */
export function editionUrl(wiki: string, title: string): string {
  return `https://${editionHost(wiki)}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}
