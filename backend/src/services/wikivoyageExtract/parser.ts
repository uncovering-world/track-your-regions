/**
 * Wikivoyage wikitext parser — pure functions, no I/O
 *
 * Ported from scripts/wikivoyage-regions.py.
 * All regex translations: Python re.S → JS `s` flag, re.I → `i` flag,
 * re.findall → matchAll().
 */

import type { WikiSection, RegionEntry } from './types.js';

const COMMONS_FILE_URL = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

/** Section name prefixes that indicate sub-region content */
const REGION_SECTION_PREFIXES = [
  'regions', 'countries', 'states', 'provinces', 'districts',
  'islands', 'prefectures', 'counties', 'subregions', 'cantons',
  'municipalities',
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

  // Match regionNitems parameters
  const itemsPattern = /region(\d+)items\s*=\s*(.+?)(?=\s*\n\s*\|?\s*region|\s*\n\s*\}|\s*\|\s*region)/gs;

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
    } else if (coreLinks.length > 1) {
      // Multiple wikilinks — detect pattern
      const classified = classifyMultiLink(coreLinks, strippedParens);
      if (classified.type === 'linked') {
        regions.push({ name: classified.target, items, hasLink: true });
      } else {
        // Grouping node — items are the children (the wikilinks)
        regions.push({
          name: classified.name,
          items: classified.children,
          hasLink: false,
        });
      }
    } else {
      // Plain text — strip bold markers, stray brackets, and templates
      let link = nameText.replace(/\{\{[^}]*\}\}/g, ''); // remove {{...}}
      link = link.replace(/\{\{.*/g, ''); // remove unclosed {{...
      link = link.replace(/'''?|\[\[|\]\]/g, '').trim();
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

