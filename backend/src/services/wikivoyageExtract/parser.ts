/**
 * Wikivoyage wikitext parser — pure functions, no I/O
 *
 * Ported from scripts/wikivoyage-regions.py.
 * All regex translations: Python re.S → JS `s` flag, re.I → `i` flag,
 * re.findall → matchAll().
 */

/* eslint-disable security/detect-non-literal-regexp, security/detect-unsafe-regex -- patterns built from static keyword arrays, not user input */
import type { WikiSection, RegionEntry, MapshapeEntry } from './types.js';

const COMMONS_FILE_URL = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

/** Section name prefixes that indicate sub-region content */
const REGION_SECTION_PREFIXES = [
  'regions', 'countries', 'states', 'provinces', 'districts',
  'islands', 'prefectures', 'counties', 'subregions', 'cantons',
  'municipalities', 'departments', 'territories', 'federal subjects',
];

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
  const re = /\[\[([^|\]]+?)(?:\|[^\]]*?)?\]\]/g;
  for (const m of text.trim().matchAll(re)) {
    const target = m[1].trim();
    if (!target.includes(':')) {
      results.push(target);
    }
  }
  return results;
}

/** Extract the first wikilink from text */
function extractWikilink(text: string): string | null {
  const m = text.trim().match(/\[\[([^|\]]+?)(?:\|[^\]]*?)?\]\]/);
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
const weakRe = new RegExp(`\\b(?:${WEAK_MAP_KEYWORDS.map(escapeRegex).join('|')})\\b`);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract [[File:...]] filenames from wikitext */
function extractFileNames(wikitext: string): string[] {
  const re = /\[\[(?:File|Image):([^|\]]+\.\w+)/gi;
  const results: string[] = [];
  for (const m of wikitext.matchAll(re)) {
    results.push(m[1]);
  }
  return results;
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

  // First pass: strong keywords (substring match, only hard-skip blocks)
  for (const fname of fileNames) {
    const fnameNorm = fname.toLowerCase().replace(/_/g, ' ');
    if (hardSkipRe.test(fnameNorm)) continue;
    if (STRONG_MAP_KEYWORDS.some((kw) => fnameNorm.includes(kw))) {
      return COMMONS_FILE_URL + fname.trim().replace(/ /g, '_');
    }
  }

  // Second pass: SVG/PNG files with weak map keywords
  for (const fname of fileNames) {
    const fnameNorm = fname.toLowerCase().replace(/_/g, ' ');
    if (skipRe.test(fnameNorm)) continue;
    if (
      (fnameNorm.endsWith('.svg') || fnameNorm.endsWith('.png')) &&
      weakRe.test(fnameNorm)
    ) {
      return COMMONS_FILE_URL + fname.trim().replace(/ /g, '_');
    }
  }

  // Third pass: SVG files in Regionlist context
  if (wikitext.includes('{{Regionlist') || wikitext.includes('{{regionlist')) {
    for (const fname of fileNames) {
      const fnameNorm = fname.toLowerCase().replace(/_/g, ' ');
      if (skipRe.test(fnameNorm)) continue;
      if (fnameNorm.endsWith('.svg')) {
        return COMMONS_FILE_URL + fname.trim().replace(/ /g, '_');
      }
    }
  }

  return null;
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
  const imgHardSkipRe = new RegExp(`\\b(?:${imgHardSkip.map(escapeRegex).join('|')})\\b`);

  const mapKeywords = [
    'map', 'karte', 'carte', 'mappa', 'mapa',
    'region', 'regions', 'district', 'districts',
    'province', 'provinces', 'prefecture', 'prefectures',
    'county', 'counties', 'canton', 'cantons',
    'oblast', 'oblasts', 'department', 'departments',
    'administrative', 'division', 'divisions',
  ];
  const mapKwRe = new RegExp(`\\b(?:${mapKeywords.map(escapeRegex).join('|')})\\b`);

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const fname of fileNames) {
    const fnameNorm = fname.toLowerCase().replace(/_/g, ' ');
    if (imgHardSkipRe.test(fnameNorm)) continue;
    // JPG/JPEG: only include if filename suggests a map
    if (fnameNorm.endsWith('.jpg') || fnameNorm.endsWith('.jpeg')) {
      if (!mapKwRe.test(fnameNorm)) continue;
    }
    const url = COMMONS_FILE_URL + fname.trim().replace(/ /g, '_');
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

// ─── Mapshape parsing ───────────────────────────────────────────────────────

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
    const startIdx = lower.indexOf('{{mapshape|', searchFrom);
    if (startIdx === -1) break;
    // Find balanced closing }} by counting nesting depth
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < cleanText.length - 1; i++) {
      if (cleanText[i] === '{' && cleanText[i + 1] === '{') { depth++; i++; }
      else if (cleanText[i] === '}' && cleanText[i + 1] === '}') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
        i++;
      }
    }
    if (endIdx === -1) break;
    const inner = cleanText.substring(startIdx + '{{mapshape|'.length, endIdx);
    searchFrom = endIdx + 2;

    // Resolve nested {{StdColor|...}} templates to a placeholder color
    const resolved = inner.replace(/\{\{StdColor\|([^}]+)\}\}/gi, (_m, code: string) => {
      // Map StdColor codes to approximate hex colors for display
      const stdColors: Record<string, string> = {
        t1: '#cfd48c', t2: '#b5d29b', t3: '#d4a76a', t4: '#c7b8d1',
        t5: '#8cc2c4', t6: '#d4a4a7', t7: '#b8c7d1', t8: '#d1c7a4',
        t9: '#a4b8d1', t10: '#c4c78c',
      };
      return stdColors[code.trim().toLowerCase()] ?? '#cccccc';
    });

    const fill = resolved.match(/fill\s*=\s*([#\w]+)/i)?.[1] ?? '';
    const title = (resolved.match(/title\s*=\s*([^|]+)/i)?.[1] ?? resolved.match(/name\s*=\s*([^|]+)/i)?.[1])?.trim()
      ?.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') ?? '';  // strip [[...]] wikilinks
    const wikidata = resolved.match(/wikidata\s*=\s*([^|]+)/i)?.[1]?.trim() ?? '';
    if (title && wikidata) {
      results.push({
        title,
        color: fill,
        wikidataIds: wikidata.split(',').map(id => id.trim()).filter(Boolean),
      });
    }
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
  const stripped = rawText.replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, '[[$1]]');

  if (/\]\]'s\s+\[\[/.test(stripped)) {
    // Possessive — last link is the target
    return { type: 'linked', target: coreLinks[coreLinks.length - 1] };
  }

  if (/\]\]\s*\(/.test(stripped)) {
    // Parenthetical — first link is the target
    return { type: 'linked', target: coreLinks[0] };
  }

  // Conjunction — grouping node
  let cleanName = rawText.replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, '$1');
  cleanName = cleanName.replace(/\[\[|\]\]/g, '').trim();
  return { type: 'grouping', name: cleanName, children: coreLinks };
}

// ─── Regionlist parsing ─────────────────────────────────────────────────────

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
  // Strip HTML comments
  const cleanText = stripHtmlComments(wikitext);

  // Extract regionmap filename from inside the template
  const mapMatch = cleanText.match(/\|\s*regionmap\s*=\s*([^\n|{}]+)/);
  let mapImage: string | null = null;
  if (mapMatch) {
    const fname = mapMatch[1].trim();
    if (fname && !fname.startsWith('{{')) {
      mapImage = COMMONS_FILE_URL + fname.replace(/ /g, '_');
    }
  }

  // Fallback: look for [[File:...map...]] tags outside the template
  if (!mapImage) {
    mapImage = extractFileMapImage(cleanText);
  }

  const regions: RegionEntry[] = [];

  // Match regionNname parameters
  const namePattern = /region(\d+)name\s*=\s*(\[\[[^\]]*\]\](?:[^|\n}]*\[\[[^\]]*\]\])*|[^|\n}]+)/g;

  // Match regionNitems parameters — capture only the same line.
  // Using [^\n]* (not .*) to avoid leaking into regionNdescription fields
  // (e.g., [[São Vicente]] in Cape Verde's description text).
  const itemsPattern = /region(\d+)items\s*=[ \t]*([^\n]*)/g;

  // Build items lookup
  const itemsByNum = new Map<string, string[]>();
  for (const m of cleanText.matchAll(itemsPattern)) {
    const num = m[1];
    const itemsText = m[2];
    const items: string[] = [];
    for (const wl of itemsText.matchAll(/\[\[([^|\]]+?)(?:\|[^\]]*?)?\]\]/g)) {
      const item = wl[1].trim();
      if (!item.includes(':')) {
        items.push(item);
      }
    }
    itemsByNum.set(num, items);
  }

  for (const m of cleanText.matchAll(namePattern)) {
    const num = m[1];
    const nameText = m[2].trim();
    const items = itemsByNum.get(num) ?? [];

    // Strip parenthetical annotations like "([[USA]])" before counting links
    const strippedParens = nameText.replace(
      /\s*\((?:\[\[[^\]]*\]\][,\s]*)+\)?/g,
      '',
    );
    const coreLinks = extractAllWikilinks(strippedParens);

    if (coreLinks.length === 1) {
      // Single wikilink — normal linked child
      regions.push({ name: coreLinks[0], items, hasLink: true });
    } else if (coreLinks.length === 2 && /\]\]'s\s*\[\[/.test(strippedParens)) {
      // Possessive pattern: [[A]]'s [[B]] → B is the actual region (A is context)
      regions.push({ name: coreLinks[1], items, hasLink: true });
    } else if (coreLinks.length > 1) {
      // Multiple wikilinks — emit as unlinked so AI extraction handles it
      let cleanName = strippedParens.replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, '$1');
      cleanName = cleanName.replace(/\[\[|\]\]/g, '').trim();
      regions.push({ name: cleanName, items: coreLinks, hasLink: false });
    } else {
      // Plain text — strip bold markers, stray brackets, templates, and external links
      let link = nameText.replace(/\{\{[^}]*\}\}/g, ''); // remove {{...}}
      link = link.replace(/\{\{.*/g, ''); // remove unclosed {{...
      // Convert external links [http://url.com/ Text] → Text
      link = link.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1');
      link = link.replace(/'''?|\[\[|\]\]/g, '');
      link = link.replace(/https?:\/\/\S+/g, '').trim(); // strip bare URLs
      if (!link) continue;
      regions.push({ name: link, items, hasLink: false });
    }
  }

  // Capture bullet links after the Regionlist closing }}
  let extraLinks: string[] = [];
  let lastRegionParam: number | undefined;
  for (const m of cleanText.matchAll(/region\d+\w+\s*=/g)) {
    lastRegionParam = m.index! + m[0].length;
  }
  if (lastRegionParam !== undefined) {
    const rlEnd = cleanText.indexOf('}}', lastRegionParam);
    if (rlEnd >= 0) {
      const afterText = cleanText.slice(rlEnd + 2);
      extraLinks = parseBulletLinks(afterText);
    }
  }

  return { mapImage, regions, extraLinks };
}

// ─── Bullet link parsing ────────────────────────────────────────────────────

const CROSS_REF_RE =
  /described\s+(separately|elsewhere|on\s+that\s+page|in\s+\[\[|as\s+\[\[)/i;

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
    const namePart = stripped.split(/\s*[—–]\s*|\s+-\s+/)[0];
    const link = extractWikilink(namePart);
    if (link && !link.includes(':') && !seen.has(link)) {
      links.push(link);
      seen.add(link);
    }
  }

  return links;
}

