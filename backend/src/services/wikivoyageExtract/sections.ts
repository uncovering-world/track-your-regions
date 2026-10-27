/**
 * A Wikivoyage article's sections, read from its wikitext (#2089) the way the
 * Action API's `parse` lists them: a heading line `== Name ==`, numbered from
 * 1 in the order the headings appear, whose text runs from its heading to the
 * next heading of the same or a higher level. A heading inside a comment is
 * not one. Pure functions, no I/O.
 */

import type { WikiSection } from './types.js';

/** A section with its own wikitext, its heading line included. */
export type ArticleSection = WikiSection & { level: number; text: string };

/** MediaWiki's heading rule: the same run of `=` on both sides, one to six of them. */
const HEADING = /^(={1,6})(.+)\1[ \t]*$/;

/** The wikitext with each comment's characters blanked, newlines kept, so offsets and lines stay where they were. */
const withoutComments = (wikitext: string) =>
  wikitext.replace(/<!--[\s\S]*?(?:-->|$)/g, comment => comment.replace(/[^\n]/g, ' '));

/** A heading's text as the API's `line` gives it: links shown by their label, bold, italics and tags dropped. */
function headingLine(raw: string): string {
  return raw
    .replace(/\[\[(?:[^|\]]{0,500}\|)?([^|\]]{0,500})\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^<>]{0,500}>/g, '')
    .trim();
}

/** Every section of `wikitext`, in order; an article with no heading has none. */
export function articleSections(wikitext: string): ArticleSection[] {
  const blanked = withoutComments(wikitext);
  const headings: Array<{ start: number; level: number; line: string }> = [];
  let start = 0;
  for (const line of blanked.split('\n')) {
    const match = HEADING.exec(line);
    if (match) headings.push({ start, level: match[1].length, line: headingLine(match[2]) });
    start += line.length + 1;
  }
  return headings.map((heading, i) => {
    const next = headings.slice(i + 1).find(h => h.level <= heading.level);
    return {
      index: String(i + 1),
      line: heading.line,
      level: heading.level,
      text: wikitext.slice(heading.start, next ? next.start : wikitext.length).trimEnd(),
    };
  });
}
