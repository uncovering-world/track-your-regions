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
// eslint-disable-next-line security/detect-unsafe-regex
const DMS_PATTERN = /(-?\d+)[°]\s*(\d+)[′']\s*(\d+(?:\.\d+)?)[″"]\s*([NSEW])/i;

/** Try to parse a decimal+direction component like "48.8566N" */
const DECIMAL_DIR_PATTERN = /(-?\d+\.?\d*)\s*°?\s*([NSEW])/i;

/**
 * Parse a coordinate string in multiple formats.
 * Returns { lat, lng } or null if unparseable.
 *
 * Heuristic: if no direction letters (N/S/E/W), assume lat, lng order.
 */
export function parseCoordinates(input: string): Coords | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // --- Google Maps URL: @lat,lng, ---
  const gmapsMatch = trimmed.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+)/);
  if (gmapsMatch) {
    const lat = parseFloat(gmapsMatch[1]);
    const lng = parseFloat(gmapsMatch[2]);
    if (isValidCoords(lat, lng)) return { lat, lng };
  }

  // --- Labeled format: "lat: 48.8566, lng: 2.3522" or "lng: 2.3522, lat: 48.8566" ---
  const labeledMatch = trimmed.match(
    /(?:lat(?:itude)?)\s*[:=]\s*(-?\d+\.?\d*)\s*[,;]\s*(?:lng|lon(?:gitude)?)\s*[:=]\s*(-?\d+\.?\d*)/i
  );
  if (labeledMatch) {
    const lat = parseFloat(labeledMatch[1]);
    const lng = parseFloat(labeledMatch[2]);
    if (isValidCoords(lat, lng)) return { lat, lng };
  }
  const labeledMatchReversed = trimmed.match(
    /(?:lng|lon(?:gitude)?)\s*[:=]\s*(-?\d+\.?\d*)\s*[,;]\s*(?:lat(?:itude)?)\s*[:=]\s*(-?\d+\.?\d*)/i
  );
  if (labeledMatchReversed) {
    const lng = parseFloat(labeledMatchReversed[1]);
    const lat = parseFloat(labeledMatchReversed[2]);
    if (isValidCoords(lat, lng)) return { lat, lng };
  }

  // --- DMS: "48°51'24"N, 2°21'8"E" ---
  const dmsMatches = [...trimmed.matchAll(new RegExp(DMS_PATTERN, 'gi'))];
  if (dmsMatches.length === 2) {
    const vals = dmsMatches.map((m) => ({
      decimal: dmsToDecimal(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4].toUpperCase()),
      dir: m[4].toUpperCase(),
    }));

    const latVal = vals.find((v) => v.dir === 'N' || v.dir === 'S');
    const lngVal = vals.find((v) => v.dir === 'E' || v.dir === 'W');
    if (latVal && lngVal && isValidCoords(latVal.decimal, lngVal.decimal)) {
      return { lat: latVal.decimal, lng: lngVal.decimal };
    }
  }

  // --- Decimal with direction: "48.8566N, 2.3522E" ---
  const decDirMatches = [...trimmed.matchAll(new RegExp(DECIMAL_DIR_PATTERN, 'gi'))];
  if (decDirMatches.length === 2) {
    const vals = decDirMatches.map((m) => {
      const dir = m[2].toUpperCase();
      const sign = dir === 'S' || dir === 'W' ? -1 : 1;
      return { decimal: sign * Math.abs(parseFloat(m[1])), dir };
    });

    const latVal = vals.find((v) => v.dir === 'N' || v.dir === 'S');
    const lngVal = vals.find((v) => v.dir === 'E' || v.dir === 'W');
    if (latVal && lngVal && isValidCoords(latVal.decimal, lngVal.decimal)) {
      return { lat: latVal.decimal, lng: lngVal.decimal };
    }
  }

  // --- Plain decimal: "48.8566, 2.3522" or "48.8566 2.3522" ---
  const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
  if (parts.length === 2) {
    const a = parseFloat(parts[0]);
    const b = parseFloat(parts[1]);
    if (isValidCoords(a, b)) return { lat: a, lng: b };
  }

  return null;
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

