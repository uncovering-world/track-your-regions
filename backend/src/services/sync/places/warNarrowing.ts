/**
 * A war narrowed to the battle or campaign a memorial is for (#2404).
 *
 * Wikidata's *commemorates* often names the whole war where the memorial is
 * one battle's: the Soviet War Memorial in Treptower Park is said to
 * commemorate World War II, and its article's lead says it commemorates the
 * soldiers who fell in the Battle of Berlin. "World War II" is true and tells
 * this memorial apart from no other of that war. So where a reading names a
 * war, the lead of the place's English Wikipedia article is read: the
 * sentences that say what the place commemorates, remembers or honours, or
 * who fell, and the articles they link. A linked article whose item is an
 * armed conflict or a military operation lying wholly within the war's dates
 * (`within`) replaces the war: Treptower → the Battle of Berlin, the Dunkirk
 * Memorial → the Battle of Dunkirk, Mamayev Kurgan → the Battle of
 * Stalingrad. A link to the war itself, to a unit, a place or a later war
 * (India Gate's lead names the Third Anglo-Afghan War of 1919 beside World
 * War I) narrows nothing, and the war stays.
 *
 * The lead is read live, one article at a time (`rvsection=0` answers for one
 * page), and only for the places whose reading names a war. A lead that
 * cannot be read narrows nothing: the reading it would refine is already
 * true, so the run goes on with the war (`fetchLeads`).
 */

import type { CommemoratedSubject, Commemorates } from '@tyr/shared/commemorates';
import { WARS_NARROWED_BY_LEAD } from '@tyr/shared/commemorates';
import { askWikipediaOnce, LOG_PREFIX, pagesOf, type CategoryOptions } from '../wikipediaCategories.js';
import { WaitBudget } from '../wikidataUtils.js';
import type { SubjectKind } from './commemorates.js';

/** A time span as a sortable number per end: year, month and day, `±YYYYMMDD`. */
export interface Span {
  from: number;
  to: number;
}

/**
 * A sentence of a lead that says what a place commemorates or who it is for:
 * "commemorates", "dedicated to", "in memory of", "in honour of", "fell".
 */
const DEDICATION_SENTENCE = /commemorat|dedicated|memorial (?:to|for|of)|in memory|in honou?r|honou?rs|remember|\bfell\b|fallen|killed|\bdied\b|missing|lost their lives/i;

/** A wiki link, its target and label captured whole; the target is what comes before a pipe or a section mark. */
// eslint-disable-next-line sonarjs/slow-regex -- the negated class `[^\]]+` cannot match the `]` that closes it, so it cannot backtrack across a link; one lead's wikitext at a time
const LINK = /\[\[([^\]]+)\]\]/g;

/** Wikitext without its comments, cut at each opening mark to its close, or to the end where none closes it. */
function withoutComments(wikitext: string): string {
  let out = '';
  let at = 0;
  for (let start = wikitext.indexOf('<!--'); start >= 0; start = wikitext.indexOf('<!--', at)) {
    out += wikitext.slice(at, start);
    const end = wikitext.indexOf('-->', start + 4);
    at = end < 0 ? wikitext.length : end + 3;
  }
  return out + wikitext.slice(at);
}

/** Wikitext without what is not prose: comments, references, templates (nested ones too) and files. */
function proseOf(wikitext: string): string {
  let text = withoutComments(wikitext).replace(/<ref[^>/]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  // Innermost templates first, until none is left: an infobox holds templates of its own.
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(/\{\{[^{}]*\}\}/g, '');
  }
  return withoutFiles(text);
}

/** Wikitext without its file links, whose captions hold links of their own: cut by counting brackets. */
function withoutFiles(text: string): string {
  let out = '';
  let at = 0;
  for (let start = fileLinkAt(text, 0); start >= 0; start = fileLinkAt(text, at)) {
    out += text.slice(at, start);
    let depth = 0;
    let i = start;
    do {
      if (text.startsWith('[[', i)) { depth++; i += 2; } else if (text.startsWith(']]', i)) { depth--; i += 2; } else i++;
    } while (depth > 0 && i < text.length);
    at = i;
  }
  return out + text.slice(at);
}

/** Where the next file link starts, at or after `from`, or -1. */
function fileLinkAt(text: string, from: number): number {
  const match = /\[\[(?:File|Image):/i.exec(text.slice(from));
  return match ? from + match.index : -1;
}

/** The articles the dedication sentences of a lead link, in the order they appear, once each. */
export function dedicationLinks(wikitext: string): string[] {
  const titles: string[] = [];
  for (const sentence of proseOf(wikitext).split(/(?<=[.!?])\s+/)) {
    if (!DEDICATION_SENTENCE.test(sentence)) continue;
    for (const [, link] of sentence.matchAll(LINK)) {
      const title = link.split('|')[0].split('#')[0].trim().replace(/_/g, ' ');
      if (!title || /^[^:]+:/.test(title)) continue;
      titles.push(title.charAt(0).toUpperCase() + title.slice(1));
    }
  }
  return [...new Set(titles)];
}

/** Whether `inner` lies wholly within `outer`. */
export function within(inner: Span, outer: Span): boolean {
  return inner.from >= outer.from && inner.to <= outer.to;
}

/**
 * The reading with each war it names replaced by the conflicts the lead's
 * dedication sentences link within that war's dates, or the reading as it was
 * where none is; `via` says the lead narrowed it.
 */
export function narrowWars(
  reading: Commemorates,
  linked: readonly string[],
  kinds: ReadonlyMap<string, SubjectKind>,
  articles: ReadonlyMap<string, string>,
): Commemorates {
  const subjects: CommemoratedSubject[] = [];
  let narrowed = false;
  for (const subject of reading.subjects) {
    const war = kinds.get(subject.item);
    const span = war?.war ? war.span : null;
    const narrower = span ? linked.filter((item) => {
      const kind = kinds.get(item);
      return item !== subject.item && kind?.conflict && kind.span && within(kind.span, span);
    }) : [];
    if (!narrower.length) {
      subjects.push(subject);
      continue;
    }
    narrowed = true;
    for (const item of narrower) {
      const kind = kinds.get(item) as SubjectKind;
      subjects.push({ item, label: kind.label, articleUrl: articles.get(item) ?? null });
    }
  }
  const once = subjects.filter((subject, i) => subjects.findIndex((other) => other.item === subject.item) === i);
  return narrowed ? { via: WARS_NARROWED_BY_LEAD, subjects: once } : reading;
}

/** One page's lead as `prop=revisions` answers it under `formatversion=2`. */
interface RevisionPage {
  revisions?: { slots?: { main?: { content?: string } } }[];
}

/**
 * The wikitext of each article's lead (section 0), by the title asked; an
 * article the API has no page for has no entry. One ask per article, since a
 * section is answered for one page at a time. A lead that cannot be read, its
 * retries spent or the host refusing it, has no entry either and is logged:
 * its war stays as the reading named it. A cancelled run stops here.
 */
export async function fetchLeads(titles: readonly string[], options: CategoryOptions): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const budget = options.budget ?? new WaitBudget(0);
  for (const title of titles) {
    if (options.isCancelled?.()) break;
    try {
      const answer = await askWikipediaOnce({
        action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0',
        redirects: '1', format: 'json', formatversion: '2', titles: title,
      }, options, budget, `the lead of ${title}`);
      const content = (pagesOf(answer)[0] as unknown as RevisionPage | undefined)?.revisions?.[0]?.slots?.main?.content;
      if (content) out.set(title, content);
    } catch (error) {
      if (options.isCancelled?.()) throw error;
      console.warn(`${LOG_PREFIX} the lead of ${title} was not read, its war stays: ${error instanceof Error ? error.message : String(error)}`);
    }
    await options.pause?.();
  }
  return out;
}
