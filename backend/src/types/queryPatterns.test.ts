/**
 * The query parameters a handler parses beyond their type say in the OpenAPI
 * document what they accept (#2515): a client generated from the document, and
 * the API contract lane that draws requests from it, send only values the route
 * reads. Each pattern is no wider than the route's own reading: every value it
 * admits here, the schema accepts.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFile } from '../testSupport/repoFile.js';
import {
  findSiteCandidatesQuerySchema, imageProxyQuerySchema, wikipediaEditionsQuerySchema, worldPointsQuerySchema,
} from './index.js';

interface Parameter { name: string; schema: { pattern?: string; allOf?: Array<{ pattern?: string }>; items?: { pattern?: string } } }
interface Operation { operationId?: string; parameters?: Parameter[] }

const document = JSON.parse(readFileSync(repoFile('packages', 'shared', 'src', 'openapi.generated.json'), 'utf8')) as {
  paths: Record<string, Record<string, Operation>>;
};

/** The patterns the document gives one operation's parameter. */
function patternsOf(operationId: string, name: string): RegExp[] {
  const operations = Object.values(document.paths).flatMap(path => Object.values(path));
  const parameter = operations.find(operation => operation.operationId === operationId)?.parameters?.find(p => p.name === name);
  if (!parameter) throw new Error(`${operationId} documents no ${name}`);
  // A list's pattern is its items'.
  const { pattern, allOf = [], items } = parameter.schema;
  const patterns = [pattern, items?.pattern, ...allOf.map(part => part.pattern)].filter((p): p is string => !!p);
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the committed document's own patterns, never a request's
  return patterns.map(p => new RegExp(p));
}

const admits = (patterns: RegExp[], value: string) => patterns.every(pattern => pattern.test(value));

describe('a parsed query parameter says in the document what it accepts (#2515)', () => {
  it('documents the points read’s bbox as four numbers, and the route reads every box the pattern admits', () => {
    const patterns = patternsOf('getExperiencesPoints', 'bbox');
    expect(patterns).toHaveLength(1);
    // Berlin, a box over the antimeridian, a fraction without its zero, an exponent.
    for (const bbox of ['13.08,52.33,13.76,52.68', '170,-50,-170,-30', '.5,1.,2,3', '-1e2,-45,1E1,45']) {
      expect(admits(patterns, bbox)).toBe(true);
      expect(worldPointsQuerySchema.safeParse({ bbox }).success).toBe(true);
    }
    // Three numbers, a blank, a word, and an exponent no finite number has.
    for (const bbox of ['1,2,3', '1,2,,4', 'west,2,3,4', '1e999,2,3,4']) {
      expect(admits(patterns, bbox)).toBe(false);
      expect(worldPointsQuerySchema.safeParse({ bbox }).success).toBe(false);
    }
    // The route reads a plus sign and spaces, which the document does not spell: it is the narrower.
    for (const bbox of ['+13,52,14,53', '13, 52, 14, 53']) {
      expect(admits(patterns, bbox)).toBe(false);
      expect(worldPointsQuerySchema.safeParse({ bbox }).success).toBe(true);
    }
  });

  it('documents the editions read’s languages as a list of codes, and the route reads every list the pattern admits', () => {
    const patterns = patternsOf('getExperiencesWikipediaEditions', 'languages');
    const editions = (languages: string) => wikipediaEditionsQuerySchema.safeParse({ articles: ['https://en.wikipedia.org/wiki/Altes_Museum'], languages });
    for (const languages of ['de', 'ru,uk', 'pt-br,zh-hans', 'de,fr,es,it,pt,nl,pl,ru,uk,ja']) {
      expect(admits(patterns, languages)).toBe(true);
      expect(editions(languages).success).toBe(true);
    }
    // An eleventh code, a capital and a script tag.
    for (const languages of ['de,fr,es,it,pt,nl,pl,ru,uk,ja,ko', 'DE', 'ru,<script>']) {
      expect(admits(patterns, languages)).toBe(false);
      expect(editions(languages).success).toBe(false);
    }
    // The route skips an empty entry, which the document does not spell.
    expect(admits(patterns, 'de,')).toBe(false);
    expect(editions('de,').success).toBe(true);
  });

  it('documents the editions read’s articles so that a hundred fit in one request the server reads', () => {
    const patterns = patternsOf('getExperiencesWikipediaEditions', 'articles');
    expect(admits(patterns, 'https://en.wikipedia.org/wiki/Altes_Museum')).toBe(true);
    // A title that would be escaped, and one past the length a hundred-article request leaves room for.
    expect(admits(patterns, 'https://en.wikipedia.org/wiki/K%C3%B6lner_Dom')).toBe(false);
    expect(admits(patterns, `https://en.wikipedia.org/wiki/${'A'.repeat(91)}`)).toBe(false);
    // A hundred of the longest it admits, with their names, stay under Node's 16 kB request line.
    const longest = `https://en.wikipedia.org/wiki/${'A'.repeat(90)}`;
    const article = `articles=${encodeURIComponent(longest)}`;
    const query = `${Array(100).fill(article).join('&')}&languages=${'a'.repeat(200)}`;
    const line = `GET /api/experiences/wikipedia-editions?${query} HTTP/1.1`;
    expect(line.length).toBeLessThan(16 * 1024);
  });

  it('documents a link search as two characters other than spaces, which the route trims to', () => {
    const patterns = patternsOf('getExperiencesByIdFindLinksCandidates', 'q');
    expect(admits(patterns, ' Ur ')).toBe(true);
    expect(findSiteCandidatesQuerySchema.safeParse({ q: ' Ur ' }).success).toBe(true);
    expect(admits(patterns, '   ')).toBe(false);
    expect(findSiteCandidatesQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('documents the image proxy’s url as an encoded Commons file address, and the route fetches every one the pattern admits', () => {
    const patterns = patternsOf('getAdminImageProxy', 'url');
    // An imported region map as the Wikivoyage extractor stores it, a percent-encoded thumbnail with
    // its width, and an original file.
    for (const url of [
      'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png',
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/K%C3%B6ln.jpg/250px-K%C3%B6ln.jpg',
      'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin_(Mitte)_map.svg?width=960',
      'https://upload.wikimedia.org/wikipedia/commons/a/a8/Berlin_Altes_Museum.jpg',
    ]) {
      expect(admits(patterns, url)).toBe(true);
      expect(imageProxyQuerySchema.safeParse({ url }).success).toBe(true);
    }
    // The route reads a raw character, and plain http it fetches over https, which the document does
    // not spell: the document is the narrower.
    for (const url of ['https://commons.wikimedia.org/wiki/Special:FilePath/Köln.jpg', 'http://upload.wikimedia.org/x.jpg']) {
      expect(admits(patterns, url)).toBe(false);
      expect(imageProxyQuerySchema.safeParse({ url }).success).toBe(true);
    }
    // Another host, a look-alike host, and a broken escape neither reads.
    for (const url of [
      'https://example.com/x.jpg', 'https://upload.wikimedia.org.example.com/x',
      'https://upload.wikimedia.org/wikipedia/commons/a/ab/K%C3.jpg',
    ]) {
      expect(admits(patterns, url)).toBe(false);
      expect(imageProxyQuerySchema.safeParse({ url }).success).toBe(false);
    }
  });
});
