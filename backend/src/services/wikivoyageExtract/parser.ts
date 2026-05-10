/**
 * Wikivoyage wikitext parser — pure functions, no I/O
 *
 * Ported from scripts/wikivoyage-regions.py.
 * All regex translations: Python re.S → JS `s` flag, re.I → `i` flag,
 * re.findall → matchAll().
 */

import type { WikiSection, RegionEntry, MapshapeEntry } from './types.js';

const COMMONS_FILE_URL = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

/** Section name prefixes that indicate sub-region content */
const REGION_SECTION_PREFIXES = [
  'regions', 'countries', 'states', 'provinces', 'districts',
  'islands', 'prefectures', 'counties', 'subregions', 'cantons',
  'municipalities', 'departments', 'territories', 'federal subjects',
];

// ─── Wikilink regex helpers ────────────────────────────────────────────────
// We cap repetition explicitly to bound backtracking. Wikilink target/display
// text is capped well above anything seen in real MediaWiki markup.

/** Upper bound on a wikilink target length (real-world max is ~200). */
const WIKILINK_TARGET_MAX = 500;

/** Upper bound on wikilink display text length. */
const WIKILINK_DISPLAY_MAX = 500;

/**
 * Matches [[Target]] or [[Target|Display]], capturing Target in group 1.
 * Bounded repetition prevents pathological backtracking on malformed input.
 */

const WIKILINK_RE_GLOBAL = new RegExp(
  `\\[\\[([^|\\]]{1,${WIKILINK_TARGET_MAX}})(?:\\|[^\\]]{0,${WIKILINK_DISPLAY_MAX}})?\\]\\]`,
  'g',
);

/** Single-match version of {@link WIKILINK_RE_GLOBAL}. */

const WIKILINK_RE_SINGLE = new RegExp(
  `\\[\\[([^|\\]]{1,${WIKILINK_TARGET_MAX}})(?:\\|[^\\]]{0,${WIKILINK_DISPLAY_MAX}})?\\]\\]`,
);

// ─── Section detection ──────────────────────────────────────────────────────

/** Find the "Regions" section index from a section list */
export function findRegionsSection(sections: WikiSection[]): string | null {
  for (const section of sections) {
    const name = section.line.trim().toLowerCase();
    if (REGION_SECTION_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      return section.index;
    }
  }
  return null;
}

// ─── Wikilink extraction ────────────────────────────────────────────────────

/** Extract ALL [[Target]] wikilinks from text, skipping namespace links */
export function extractAllWikilinks(text: string): string[] {
  const results: string[] = [];
  for (const m of text.trim().matchAll(WIKILINK_RE_GLOBAL)) {
    const target = m[1].trim();
    if (!target.includes(':')) {
      results.push(target);
    }
  }
  return results;
}

/** Extract the first wikilink from text */
function extractWikilink(text: string): string | null {
  const m = text.trim().match(WIKILINK_RE_SINGLE);
  return m ? m[1].trim() : null;
}

// ─── HTML comment stripping ─────────────────────────────────────────────────

/** Remove <!-- ... --> comments from wikitext */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

// ─── Map image extraction ───────────────────────────────────────────────────

/** Hard-skip patterns — blocks even strong keyword matches (these are NEVER maps) */
const HARD_SKIP = [
  'locator', 'flag', 'coat', 'seal', 'emblem', 'logo', 'icon', 'banner',
];
// eslint-disable-next-line security/detect-non-literal-regexp -- alternation built from module-level HARD_SKIP keyword array, escaped via escapeRegex
const hardSkipRe = new RegExp(`\\b(?:${HARD_SKIP.map(escapeRegex).join('|')})\\b`);

/** Soft-skip patterns — blocks weak keyword matches */
const SKIP_WORDS = [
  'flag', 'coat', 'banner', 'locator', 'location', 'icon',
  'logo', 'seal', 'emblem', 'wikivoyage', 'photo', 'castle',
  'church', 'temple', 'mosque', 'statue', 'monument', 'skyline',
  'beach', 'mountain', 'lake', 'river', 'waterfall', 'bridge',
  'airport', 'station', 'hotel', 'restaurant', 'museum',
  'portrait', 'panoram', 'sunset', 'sunrise', 'aerial',
  'street', 'square', 'pier', 'landing', 'ruins', 'harbor',
  'harbour', 'tower', 'palace', 'cathedral', 'basilica',
  'monastery', 'fortress', 'lighthouse',
];
// eslint-disable-next-line security/detect-non-literal-regexp -- alternation built from module-level SKIP_WORDS keyword array, escaped via escapeRegex
const skipRe = new RegExp(`\\b(?:${SKIP_WORDS.map(escapeRegex).join('|')})\\b`);

/** Strong map keywords — substring match */
const STRONG_MAP_KEYWORDS = ['map', 'mappa', 'mapa', 'karte', 'carte'];

/** Weak map keywords — word-boundary match with explicit plural forms */
const WEAK_MAP_KEYWORDS = [
  'region', 'regions', 'district', 'districts',
  'province', 'provinces', 'prefecture', 'prefectures',
  'county', 'counties', 'canton', 'cantons',
  'oblast', 'oblasts', 'kommune', 'kommuner',
  'comarca', 'comarcas', 'departement', 'departements',
  'department', 'departments',
];
// eslint-disable-next-line security/detect-non-literal-regexp -- alternation built from module-level WEAK_MAP_KEYWORDS array, escaped via escapeRegex
const weakRe = new RegExp(`\\b(?:${WEAK_MAP_KEYWORDS.map(escapeRegex).join('|')})\\b`);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert a filename to the canonical Commons URL. */
function toCommonsUrl(fname: string): string {
  return COMMONS_FILE_URL + fname.trim().replace(/ /g, '_');
}

/** Normalize a filename for keyword matching (lowercase, underscores → spaces). */
function normalizeFileName(fname: string): string {
  return fname.toLowerCase().replace(/_/g, ' ');
}

/** Extract [[File:...]] filenames from wikitext */
function extractFileNames(wikitext: string): string[] {
  // Filenames capped at 300 chars (well above real MediaWiki filename limits).
  const re = /\[\[(?:File|Image):([^|\]]{1,300}\.\w{1,10})/gi;
  const results: string[] = [];
  for (const m of wikitext.matchAll(re)) {
    results.push(m[1]);
  }
  return results;
}

/** Pass 1 — strong keyword (substring match), only hard-skip blocks. */
function findStrongMapKeyword(fileNames: string[]): string | null {
  for (const fname of fileNames) {
    const fnameNorm = normalizeFileName(fname);
    if (hardSkipRe.test(fnameNorm)) continue;
    if (STRONG_MAP_KEYWORDS.some((kw) => fnameNorm.includes(kw))) {
      return toCommonsUrl(fname);
    }
  }
  return null;
}

/** Pass 2 — SVG/PNG with weak map keyword, all skip words block. */
function findWeakMapKeyword(fileNames: string[]): string | null {
  for (const fname of fileNames) {
    const fnameNorm = normalizeFileName(fname);
    if (skipRe.test(fnameNorm)) continue;
    const isSvgOrPng = fnameNorm.endsWith('.svg') || fnameNorm.endsWith('.png');
    if (isSvgOrPng && weakRe.test(fnameNorm)) {
      return toCommonsUrl(fname);
    }
  }
  return null;
}

/** Pass 3 — any SVG in a Regionlist context. */
function findRegionlistSvg(wikitext: string, fileNames: string[]): string | null {
  if (!wikitext.includes('{{Regionlist') && !wikitext.includes('{{regionlist')) {
    return null;
  }
  for (const fname of fileNames) {
    const fnameNorm = normalizeFileName(fname);
    if (skipRe.test(fnameNorm)) continue;
    if (fnameNorm.endsWith('.svg')) {
      return toCommonsUrl(fname);
    }
  }
  return null;
}

/**
 * Extract a map image URL from [[File:...]] tags in the wikitext.
 *
 * Three-pass matching:
 *   1. Strong keywords (map/karte/carte/mappa/mapa) — substring match, any format.
 *      Only hard anti-patterns block.
 *   2. Weak keywords (region/district/county + plurals) — word-boundary, SVG/PNG only.
 *      All skip words block.
 *   3. Any SVG in Regionlist context.
 */
export function extractFileMapImage(wikitext: string): string | null {
  const fileNames = extractFileNames(wikitext);
  return (
    findStrongMapKeyword(fileNames) ??
    findWeakMapKeyword(fileNames) ??
    findRegionlistSvg(wikitext, fileNames)
  );
}

/**
 * Extract plausible map image candidates from [[File:...]] tags.
 *
 * Broader than extractFileMapImage() but still filters out obvious non-map images.
 * Strategy:
 *   - SVG/PNG: keep unless hard-skipped
 *   - JPG/JPEG: only keep if filename has map-related keywords
 */
export function extractImageCandidates(wikitext: string, maxCandidates = 15): string[] {
  const fileNames = extractFileNames(wikitext);

  const imgHardSkip = [
    'flag', 'coat', 'seal', 'emblem', 'logo', 'icon', 'banner', 'wikivoyage',
  ];
  // eslint-disable-next-line security/detect-non-literal-regexp -- alternation built from local imgHardSkip literal array, escaped via escapeRegex
  const imgHardSkipRe = new RegExp(`\\b(?:${imgHardSkip.map(escapeRegex).join('|')})\\b`);

  const mapKeywords = [
    'map', 'karte', 'carte', 'mappa', 'mapa',
    'region', 'regions', 'district', 'districts',
    'province', 'provinces', 'prefecture', 'prefectures',
    'county', 'counties', 'canton', 'cantons',
    'oblast', 'oblasts', 'department', 'departments',
    'administrative', 'division', 'divisions',
  ];
  // eslint-disable-next-line security/detect-non-literal-regexp -- alternation built from local mapKeywords literal array, escaped via escapeRegex
  const mapKwRe = new RegExp(`\\b(?:${mapKeywords.map(escapeRegex).join('|')})\\b`);

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const fname of fileNames) {
    const fnameNorm = normalizeFileName(fname);
    if (imgHardSkipRe.test(fnameNorm)) continue;
    // JPG/JPEG: only include if filename suggests a map
    if (fnameNorm.endsWith('.jpg') || fnameNorm.endsWith('.jpeg')) {
      if (!mapKwRe.test(fnameNorm)) continue;
    }
    const url = toCommonsUrl(fname);
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

// ─── Mapshape parsing ───────────────────────────────────────────────────────

const MAPSHAPE_OPEN = '{{mapshape|';

/** Map of StdColor codes (t1..t10) to approximate hex colors for display. */
const STD_COLORS: Record<string, string> = {
  t1: '#cfd48c', t2: '#b5d29b', t3: '#d4a76a', t4: '#c7b8d1',
  t5: '#8cc2c4', t6: '#d4a4a7', t7: '#b8c7d1', t8: '#d1c7a4',
  t9: '#a4b8d1', t10: '#c4c78c',
};

/**
 * Find the closing `}}` that balances the `{{mapshape|` starting at `startIdx`.
 * Returns the index of the first `}` of the balanced `}}`, or -1 if not found.
 */
function findBalancedMapshapeEnd(text: string, startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < text.length - 1; i++) {

    if (text[i] === '{' && text[i + 1] === '{') {
      depth++;
      i++;

    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      if (depth === 0) return i;
      i++;
    }
  }
  return -1;
}

/** Resolve `{{StdColor|code}}` templates inside mapshape body to hex placeholders. */
function resolveStdColors(inner: string): string {
  return inner.replace(
    /\{\{StdColor\|([^}]{1,100})\}\}/gi,
    (_m, code: string) => STD_COLORS[code.trim().toLowerCase()] ?? '#cccccc',
  );
}

/**
 * Extract the title value from a mapshape body, with [[wikilink]] stripping.
 * Accepts both `title=` and `name=` aliases.
 */
function extractMapshapeTitle(resolved: string): string {
  const raw =
    resolved.match(/title\s*=\s*([^|]{1,500})/i)?.[1] ??
    resolved.match(/name\s*=\s*([^|]{1,500})/i)?.[1];
  if (!raw) return '';
  // Strip [[Target]] and [[Target|Display]] → Target.
  // Bounded repetition to cap backtracking.
  return raw
    .trim()
    .replace(
      // eslint-disable-next-line security/detect-unsafe-regex -- bounded character classes ({1,500} and {0,500}) with non-overlapping anchors; no nested quantifiers
      /\[\[([^\]|]{1,500})(?:\|[^\]]{0,500})?\]\]/g,
      '$1',
    );
}

/** Parse one balanced mapshape body into an entry (or null if unusable). */
function parseMapshapeEntry(inner: string): MapshapeEntry | null {
  const resolved = resolveStdColors(inner);

  const fill = resolved.match(/fill\s*=\s*([#\w]{1,50})/i)?.[1] ?? '';
  const title = extractMapshapeTitle(resolved);
  const wikidata =
    resolved.match(/wikidata\s*=\s*([^|]{1,500})/i)?.[1]?.trim() ?? '';
  const wikicommons =
    resolved.match(/wikicommons\s*=\s*([^|]{1,500})/i)?.[1]?.trim() ?? '';

  if (title && wikidata) {
    return {
      title,
      color: fill,
      wikidataIds: wikidata.split(',').map((id) => id.trim()).filter(Boolean),
    };
  }
  if (wikicommons) {
    // Commons map data file — title/color may be filled later from the fetched GeoJSON
    return {
      title,
      color: fill,
      wikidataIds: [],
      commonsFile: wikicommons,
    };
  }
  return null;
}

/**
 * Parse {{mapshape}} templates from wikitext.
 *
 * These templates define color-coded geographic regions on Kartographer maps,
 * referencing Wikidata entities for geoshape boundaries.
 *
 * Example: {{mapshape|type=geoshape|fill=#cfd48c|title=Coast and Mayombe|wikidata=Q223920,Q855327}}
 */
export function parseMapshapes(wikitext: string): MapshapeEntry[] {
  const cleanText = stripHtmlComments(wikitext);
  const results: MapshapeEntry[] = [];
  // Match {{mapshape|...}} handling nested templates like {{StdColor|t1}}.
  // Find each {{mapshape| start, then scan forward counting braces for balanced close.
  const lower = cleanText.toLowerCase();
  let searchFrom = 0;
  while (true) {
    const startIdx = lower.indexOf(MAPSHAPE_OPEN, searchFrom);
    if (startIdx === -1) break;
    const endIdx = findBalancedMapshapeEnd(cleanText, startIdx);
    if (endIdx === -1) break;

    const inner = cleanText.substring(startIdx + MAPSHAPE_OPEN.length, endIdx);
    searchFrom = endIdx + 2;

    const entry = parseMapshapeEntry(inner);
    if (entry) results.push(entry);
  }
  return results;
}

// ─── Multi-link classification ──────────────────────────────────────────────

/**
 * Classify a multi-link region name to decide how to handle it.
 *
 * Returns:
 * - 'linked': single link target (possessive or parenthetical detected)
 * - 'grouping': plain-text grouping node with all links as children
 */
export function classifyMultiLink(
  coreLinks: string[],
  rawText: string,
): { type: 'linked'; target: string } | { type: 'grouping'; name: string; children: string[] } {
  // Strip display text from wikilinks for pattern matching
  const stripped = rawText.replace(
    /\[\[([^|\]]{1,500})\|[^\]]{0,500}\]\]/g,
    '[[$1]]',
  );

  if (/\]\]'s\s+\[\[/.test(stripped)) {
    // Possessive — last link is the target
    return { type: 'linked', target: coreLinks[coreLinks.length - 1] };
  }

  if (/\]\]\s*\(/.test(stripped)) {
    // Parenthetical — first link is the target
    return { type: 'linked', target: coreLinks[0] };
  }

  // Conjunction — grouping node
  let cleanName = rawText.replace(
    /\[\[([^|\]]{1,500})\|[^\]]{0,500}\]\]/g,
    '$1',
  );
  cleanName = cleanName.replace(/\[\[|\]\]/g, '').trim();
  return { type: 'grouping', name: cleanName, children: coreLinks };
}

// ─── Regionlist parsing ─────────────────────────────────────────────────────

/**
 * Extract the `regionmap=` value from inside a Regionlist template, or fall
 * back to scanning [[File:...map...]] tags in the surrounding wikitext.
 */
function extractRegionlistMapImage(cleanText: string): string | null {
  const mapMatch = cleanText.match(/\|\s*regionmap\s*=\s*([^\n|{}]{1,500})/);
  if (mapMatch) {
    const fname = mapMatch[1].trim();
    if (fname && !fname.startsWith('{{')) {
      return COMMONS_FILE_URL + fname.replace(/ /g, '_');
    }
  }
  return extractFileMapImage(cleanText);
}

/**
 * Build the regionN → items[] lookup from `regionNitems=` parameters.
 * Uses [^\n]* (not .*) to avoid leaking into regionNdescription fields.
 */
function buildRegionItemsLookup(cleanText: string): Map<string, string[]> {
  // Items value capped at 2000 chars (line length sanity bound).
  const itemsPattern = /region(\d{1,4})items\s*=[ \t]*([^\n]{0,2000})/g;
  const itemsByNum = new Map<string, string[]>();
  for (const m of cleanText.matchAll(itemsPattern)) {
    const num = m[1];
    const itemsText = m[2];
    const items: string[] = [];
    for (const wl of itemsText.matchAll(WIKILINK_RE_GLOBAL)) {
      const item = wl[1].trim();
      if (!item.includes(':')) {
        items.push(item);
      }
    }
    itemsByNum.set(num, items);
  }
  return itemsByNum;
}

/**
 * Strip parenthetical annotations like `([[USA]])` before counting links.
 *
 * Done in two passes to avoid a single regex with nested optional repetition,
 * which triggers SonarJS's super-linear-backtracking heuristic:
 *   1. Remove fully-closed `( ... )` groups whose interior is composed
 *      entirely of wikilinks + comma/whitespace separators.
 *   2. Remove any remaining unclosed trailing `( ... ` tail of the same shape.
 */
function stripParentheticalAnnotations(nameText: string): string {
  // Matches `(` + one-or-more wikilinks (each followed by optional ", " or whitespace) + `)`.
  // All repetitions bounded ({0,5}, {0,500}, {1,10}, outer {1,10}); ']]' literal grounds inner backtracking.
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded as documented above
  const closed = /\s{0,5}\((?:\[\[[^\]]{0,500}\]\](?:[,\s]{1,10})?){1,10}\)/g;
  // Matches a trailing unclosed `(` + wikilink run (no closing `)`). Same bounded structure as `closed`.
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded as documented above
  const unclosed = /\s{0,5}\((?:\[\[[^\]]{0,500}\]\](?:[,\s]{1,10})?){1,10}$/;
  return nameText.replace(closed, '').replace(unclosed, '');
}

/**
 * Clean a plain-text region name: drop `{{templates}}`, bold markers, stray
 * brackets, external links, and bare URLs.
 */
function cleanPlainTextRegionName(nameText: string): string {
  let link = nameText.replace(/\{\{[^}]{0,500}\}\}/g, ''); // remove {{...}}
  link = link.replace(/\{\{[^\n]{0,500}/g, ''); // remove unclosed {{...
  // Convert external links [http://url.com/ Text] → Text
  link = link.replace(/\[https?:\/\/\S{1,500}\s+([^\]]{1,500})\]/g, '$1');
  link = link.replace(/'''?|\[\[|\]\]/g, '');
  link = link.replace(/https?:\/\/\S{1,500}/g, '').trim(); // strip bare URLs
  return link;
}

/**
 * Build a RegionEntry from a name field's text. Returns null if the plain-text
 * branch produces an empty string (meaning: skip this region).
 */
function buildRegionEntry(
  nameText: string,
  items: string[],
): RegionEntry | null {
  const strippedParens = stripParentheticalAnnotations(nameText);
  const coreLinks = extractAllWikilinks(strippedParens);

  if (coreLinks.length === 1) {
    // Single wikilink — normal linked child
    return { name: coreLinks[0], items, hasLink: true };
  }
  if (coreLinks.length === 2 && /\]\]'s\s*\[\[/.test(strippedParens)) {
    // Possessive pattern: [[A]]'s [[B]] → B is the actual region (A is context)
    return { name: coreLinks[1], items, hasLink: true };
  }
  if (coreLinks.length > 1) {
    // Multiple wikilinks — emit as unlinked so AI extraction handles it
    let cleanName = strippedParens.replace(
      /\[\[([^|\]]{1,500})\|[^\]]{0,500}\]\]/g,
      '$1',
    );
    cleanName = cleanName.replace(/\[\[|\]\]/g, '').trim();
    return { name: cleanName, items: coreLinks, hasLink: false };
  }
  // Plain text branch
  const link = cleanPlainTextRegionName(nameText);
  if (!link) return null;
  return { name: link, items, hasLink: false };
}

/**
 * Capture bullet links appearing after the Regionlist template's closing `}}`.
 * Locates the last `regionN<param>=` in the text, then scans for the next `}}`.
 */
function extractTrailingBulletLinks(cleanText: string): string[] {
  let lastRegionParam: number | undefined;
  // `\w{1,50}` caps the trailing parameter-name segment length.
  for (const m of cleanText.matchAll(/region\d{1,4}\w{1,50}\s*=/g)) {
    lastRegionParam = m.index! + m[0].length;
  }
  if (lastRegionParam === undefined) return [];
  const rlEnd = cleanText.indexOf('}}', lastRegionParam);
  if (rlEnd < 0) return [];
  return parseBulletLinks(cleanText.slice(rlEnd + 2));
}

/**
 * Parse {{Regionlist}}, return { mapImage, regions, extraLinks }.
 *
 * Each region includes a hasLink boolean indicating whether the name came from
 * a [[wikilink]] (True) or plain text (False).
 *
 * extraLinks are bullet-point wikilinks found AFTER the Regionlist template.
 */
export function parseRegionlist(wikitext: string): {
  mapImage: string | null;
  regions: RegionEntry[];
  extraLinks: string[];
} {
  const cleanText = stripHtmlComments(wikitext);
  const mapImage = extractRegionlistMapImage(cleanText);
  const itemsByNum = buildRegionItemsLookup(cleanText);

  // Match regionNname parameters. The value branch allows:
  //   - one or more [[wikilinks]] optionally interleaved with plain text, OR
  //   - a single non-delimited run of plain text up to the next pipe/brace/newline.
  // Both the wikilink body and the plain-text interleave are capped.
  // All repetitions bounded ({1,4}, {0,500}, {0,200}, {0,10}, {1,500}); literal anchors (`region`, `name=`, `]]`) prevent overlapping matches.
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded as documented above
  const namePattern = /region(\d{1,4})name\s*=\s*(\[\[[^\]]{0,500}\]\](?:[^|\n}]{0,200}\[\[[^\]]{0,500}\]\]){0,10}|[^|\n}]{1,500})/g;

  const regions: RegionEntry[] = [];
  for (const m of cleanText.matchAll(namePattern)) {
    const num = m[1];
    const nameText = m[2].trim();
    const items = itemsByNum.get(num) ?? [];
    const entry = buildRegionEntry(nameText, items);
    if (entry) regions.push(entry);
  }

  const extraLinks = extractTrailingBulletLinks(cleanText);
  return { mapImage, regions, extraLinks };
}

// ─── Bullet link parsing ────────────────────────────────────────────────────

const CROSS_REF_RE =
  /described\s+(separately|elsewhere|on\s+that\s+page|in\s+\[\[|as\s+\[\[)/i;

/** Split a bullet line on em-dash / en-dash / " - " separator. */
const BULLET_SEPARATOR_RE = /\s{0,5}[—–]\s{0,5}|\s{1,5}-\s{1,5}/;

/**
 * Extract wikilinks from bullet lists, but only from the link/name portion
 * before any dash separator — not from description text.
 *
 * Skips cross-reference bullets ("described separately/elsewhere").
 * Skips sub-bullets under a cross-reference parent.
 */
export function parseBulletLinks(wikitext: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  let skipDepth: number | null = null;

  for (const line of wikitext.split('\n')) {
    const stripped = line.trim();
    if (!stripped.startsWith('*') && !stripped.startsWith('#')) {
      skipDepth = null;
      continue;
    }

    // Determine bullet depth
    const depth = stripped.length - stripped.replace(/^[*#]+/, '').length;

    // If we're inside a skipped parent's sub-bullets, skip
    if (skipDepth !== null && depth > skipDepth) continue;
    skipDepth = null;

    // Skip cross-reference bullets
    if (CROSS_REF_RE.test(stripped)) {
      skipDepth = depth;
      continue;
    }

    // Only look for wikilinks before the first dash separator
    const namePart = stripped.split(BULLET_SEPARATOR_RE)[0];
    const link = extractWikilink(namePart);
    if (link && !link.includes(':') && !seen.has(link)) {
      links.push(link);
      seen.add(link);
    }
  }

  return links;
}
