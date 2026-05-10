/**
 * Coordinate Parser — Multi-format coordinate string parsing.
 *
 * Supports:
 * - Decimal: "48.8566, 2.3522" or "48.8566 2.3522"
 * - With labels: "lng: 2.3522, lat: 48.8566"
 * - DMS: "48°51'24\"N, 2°21'8\"E"
 * - Signed with directions: "48.8566N, 2.3522E" or "-33.8688, 151.2093"
 * - Google Maps URL: extract from "@48.8566,2.3522," pattern
 */

interface Coords {
  lat: number;
  lng: number;
}

/** Convert DMS (degrees, minutes, seconds) to decimal degrees */
function dmsToDecimal(degrees: number, minutes: number, seconds: number, direction: string): number {
  const sign = direction === 'S' || direction === 'W' ? -1 : 1;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}

function isValidCoords(lat: number, lng: number): boolean {
  return isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Try to parse a DMS component like "48°51'24\"N" or "48°51'24.5\"N" */
// eslint-disable-next-line security/detect-unsafe-regex, sonarjs/slow-regex -- bounded character classes between literal anchors (°, ′/', ″/", NSEW); no nested/overlapping quantifiers, so no catastrophic backtracking
const DMS_PATTERN = /(-?\d+)°\s*(\d+)[′']\s*(\d+(?:\.\d+)?)[″"]\s*([NSEW])/i;

/** Try to parse a decimal+direction component like "48.8566N" */
// eslint-disable-next-line sonarjs/slow-regex -- numeric character classes only; ends at a literal NSEW. Input is a user-typed coordinate string (≤ a few hundred chars), so any worst-case backtracking is bounded.
const DECIMAL_DIR_PATTERN = /(-?\d+\.?\d*)\s*°?\s*([NSEW])/i;

function tryParseGoogleMaps(trimmed: string): Coords | null {
  // Numeric character classes only between literal `@` and `,`; user-typed
  // Google Maps URLs are a few hundred chars at most.
  // eslint-disable-next-line sonarjs/slow-regex -- bounded between literal anchors
  const m = trimmed.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return isValidCoords(lat, lng) ? { lat, lng } : null;
}

function tryParseLabeled(trimmed: string): Coords | null {
  const m = trimmed.match(
    // eslint-disable-next-line sonarjs/slow-regex, sonarjs/regex-complexity -- bounded user input; alternations over fixed words
    /(?:lat(?:itude)?)\s*[:=]\s*(-?\d+\.?\d*)\s*[,;]\s*(?:lng|lon(?:gitude)?)\s*[:=]\s*(-?\d+\.?\d*)/i,
  );
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (isValidCoords(lat, lng)) return { lat, lng };
  }
  const reversed = trimmed.match(
    // eslint-disable-next-line sonarjs/slow-regex, sonarjs/regex-complexity -- mirror of the labeled-match regex above
    /(?:lng|lon(?:gitude)?)\s*[:=]\s*(-?\d+\.?\d*)\s*[,;]\s*(?:lat(?:itude)?)\s*[:=]\s*(-?\d+\.?\d*)/i,
  );
  if (reversed) {
    const lng = parseFloat(reversed[1]);
    const lat = parseFloat(reversed[2]);
    if (isValidCoords(lat, lng)) return { lat, lng };
  }
  return null;
}

function pickLatLngFromDirected(vals: Array<{ decimal: number; dir: string }>): Coords | null {
  const latVal = vals.find(v => v.dir === 'N' || v.dir === 'S');
  const lngVal = vals.find(v => v.dir === 'E' || v.dir === 'W');
  if (!latVal || !lngVal) return null;
  if (!isValidCoords(latVal.decimal, lngVal.decimal)) return null;
  return { lat: latVal.decimal, lng: lngVal.decimal };
}

function tryParseDMS(trimmed: string): Coords | null {
  // eslint-disable-next-line sonarjs/slow-regex -- DMS_PATTERN is bounded between literal anchors
  const matches = [...trimmed.matchAll(new RegExp(DMS_PATTERN, 'gi'))];
  if (matches.length !== 2) return null;
  const vals = matches.map(m => ({
    decimal: dmsToDecimal(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4].toUpperCase()),
    dir: m[4].toUpperCase(),
  }));
  return pickLatLngFromDirected(vals);
}

function tryParseDecimalWithDirection(trimmed: string): Coords | null {
  // eslint-disable-next-line sonarjs/slow-regex -- DECIMAL_DIR_PATTERN is bounded between literal anchors
  const matches = [...trimmed.matchAll(new RegExp(DECIMAL_DIR_PATTERN, 'gi'))];
  if (matches.length !== 2) return null;
  const vals = matches.map(m => {
    const dir = m[2].toUpperCase();
    const sign = dir === 'S' || dir === 'W' ? -1 : 1;
    return { decimal: sign * Math.abs(parseFloat(m[1])), dir };
  });
  return pickLatLngFromDirected(vals);
}

function tryParsePlainDecimal(trimmed: string): Coords | null {
  const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const a = parseFloat(parts[0]);
  const b = parseFloat(parts[1]);
  return isValidCoords(a, b) ? { lat: a, lng: b } : null;
}

/**
 * Parse a coordinate string in multiple formats.
 * Returns { lat, lng } or null if unparseable.
 *
 * Heuristic: if no direction letters (N/S/E/W), assume lat, lng order.
 */
export function parseCoordinates(input: string): Coords | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  return tryParseGoogleMaps(trimmed)
    ?? tryParseLabeled(trimmed)
    ?? tryParseDMS(trimmed)
    ?? tryParseDecimalWithDirection(trimmed)
    ?? tryParsePlainDecimal(trimmed);
}

/**
 * Format coordinates for display.
 * Example: "48.8566°N, 2.3522°E"
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

