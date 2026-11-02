/**
 * The languages a visitor reads Wikipedia in, first choice first (#2209).
 *
 * A signed-in visitor's own list is kept with the account; anyone else reads
 * in the browser's languages. The browser names regions (`ru-RU`, `en-GB`,
 * `zh-CN`), Wikipedia names editions, so a browser language is read by its
 * first part, and a language Wikipedia writes otherwise is named as Wikipedia
 * names it. English always closes the list: it is the article the catalogue
 * links, and the one every link falls back to.
 */

import { MAX_READING_LANGUAGES, READING_LANGUAGE } from '@tyr/shared/preferences';

/** A browser's language as Wikipedia names its edition: `ru-RU` → `ru`, `nb-NO` → `nb`. */
function editionLanguage(tag: string): string | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return READING_LANGUAGE.test(primary) ? primary : null;
}

/**
 * The browser's languages ahead of English, as Wikipedia names them, each once,
 * in the browser's order, at most `MAX_READING_LANGUAGES`. A language the
 * browser puts after English is never reached, since every article has its
 * English link, so it is not listed: `['en-US', 'ru']` reads English alone.
 */
export function browserReadingLanguages(tags: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const code = editionLanguage(tag);
    if (code === 'en') break;
    if (code && !out.includes(code)) out.push(code);
  }
  return out.slice(0, MAX_READING_LANGUAGES);
}

/** The list a link reads: the visitor's own, or the browser's, then English. */
export function readingOrder(chosen: readonly string[] | null | undefined, browser: readonly string[]): string[] {
  return [...(chosen ?? browser), 'en'];
}

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return null;
  }
})();

/** A language as a reader names it: `ru` → *Russian*; the code itself where the browser knows no name. */
export function languageName(code: string): string {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}
