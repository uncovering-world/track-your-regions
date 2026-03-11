/**
 * Parse Wikivoyage {{marker}} and {{geo}} templates from wikitext.
 * Pure functions, no I/O.
 */

export interface ParsedMarker {
  name: string;
  lat: number | null;
  lon: number | null;
  wikidataId: string | null;
}

/**
 * Extract {{marker}} templates from wikitext.
 * Returns markers with explicit coords and/or Wikidata IDs for resolution.
 * Only includes markers that have a name (city/region markers, not POI-only).
 */
export function parseMarkers(text: string): ParsedMarker[] {
  const results: ParsedMarker[] = [];
  const re = /\{\{marker\s*\|([^}]+)\}\}/gi;

  for (const match of text.matchAll(re)) {
    const params = parseTemplateParams(match[1]);
    const rawName = params.get('name');
    if (!rawName) continue;

    // Strip wikilinks: [[São Tomé]] → São Tomé, [[São Tomé|display]] → display
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded character classes, no catastrophic backtracking
    const name = rawName.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').trim();
    if (!name) continue;

    const lat = params.has('lat') ? parseFloat(params.get('lat')!) : null;
    const lon = params.has('long') ? parseFloat(params.get('long')!) : null;
    const wikidataId = params.get('wikidata') ?? null;

    results.push({
      name,
      lat: lat != null && !isNaN(lat) ? lat : null,
      lon: lon != null && !isNaN(lon) ? lon : null,
      wikidataId,
    });
  }

  return results;
}

/**
 * Extract {{geo}} tag from wikitext. Returns center coordinate or null.
 * Supports both named params (lat=/long=) and positional ({{geo|lat|lon|...}}).
 */
export function parseGeoTag(text: string): { lat: number; lon: number } | null {
  const re = /\{\{geo\s*\|([^}]+)\}\}/i;
  const match = text.match(re);
  if (!match) return null;

  const params = parseTemplateParams(match[1]);

  // Try named params first
  if (params.has('lat') && params.has('long')) {
    const lat = parseFloat(params.get('lat')!);
    const lon = parseFloat(params.get('long')!);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }

  // Try positional: {{geo|lat|lon|...}}
  const parts = match[1].split('|').map(p => p.trim());
  const positional = parts.filter(p => !p.includes('='));
  if (positional.length >= 2) {
    const lat = parseFloat(positional[0]);
    const lon = parseFloat(positional[1]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }

  return null;
}

/** Parse pipe-separated template params into a Map */
function parseTemplateParams(paramStr: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of paramStr.split('|')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      map.set(part.slice(0, eqIdx).trim().toLowerCase(), part.slice(eqIdx + 1).trim());
    }
  }
  return map;
}
