/**
 * A box drawn on the map, as a predicate over a geometry column.
 *
 * One rule in one place, because the interesting half of it is a trap rather
 * than a formula. `west > east` is a box drawn across the antimeridian — the
 * convention `focus_bbox` already uses (CLAUDE.md § Antimeridian Handling) —
 * and a single envelope cannot hold one: ST_MakeEnvelope(170, -10, -170, 10)
 * does not fail, it silently normalises to xmin -170 / xmax 170, which is the
 * whole planet *except* the strip that was asked for. Measured on the
 * catalogue when the list endpoint was written: that box matched 290 places
 * between 10 S and 10 N where one is truly in it.
 *
 * So a crossing box is two envelopes meeting at the line, and every caller
 * that filters on a box gets the same answer to that question. The list
 * endpoint (experienceQueryController) asked it first and the world layer's
 * points read asks it second; a third spelling is what this module exists to
 * prevent.
 */

/** A box as the API spells it: west, south, east, north. */
export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The box a `west,south,east,north` query parameter names, or null when it
 * names none.
 *
 * Null rather than a throw for a malformed value, and rather than the whole
 * world: a caller decides what a box it cannot read means. Both current
 * callers drop the filter, which is what they did before this module existed.
 */
export function parseBbox(raw: unknown): Bbox | null {
  // A string, and only a string. Express parses a repeated parameter into an
  // array, and `String(['1,2', '3,4'])` is `'1,2,3,4'` — so `?bbox=1,2&bbox=3,4`
  // used to compose two halves nobody sent into a perfectly valid box, and
  // `String(['-10,35,30,60'])` passed a single-element array straight through.
  // Neither is a box a caller asked for, and the schema that guards this
  // endpoint calls this function, so the coercion was inside the validation
  // rather than in front of it.
  if (typeof raw !== 'string' || raw === '') return null;
  const fields = raw.split(',');
  // A blank segment is not a zero, which is what `map(Number)` alone makes it:
  // `1,2,,4` parsed as east 0 and named a box from the prime meridian, and the
  // list endpoint would have filtered on it without a word.
  if (fields.length !== 4 || fields.some(field => field.trim() === '')) return null;
  const parts = fields.map(Number);
  if (!parts.every(value => Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  return { west, south, east, north };
}

/** Where the four numbers sit in the caller's parameter list, 1-based. */
export interface BboxPlaceholders {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * `ST_Intersects(column, …)` over the one or two envelopes the box needs.
 *
 * The caller pushes the four numbers itself and says where they landed, so
 * that a query building its parameters in one array keeps doing so; a crossing
 * box reads three of them twice rather than pushing eight.
 *
 * Returned without outer parentheses around the whole disjunction is a mistake
 * waiting to happen for a caller appending it with AND, so the two-envelope
 * form is parenthesised here.
 */
export function bboxIntersectsSql(
  column: string,
  box: Bbox,
  at: BboxPlaceholders,
): string {
  const envelopes = box.west > box.east
    ? [`ST_MakeEnvelope($${at.west}, $${at.south}, 180, $${at.north}, 4326)`,
      `ST_MakeEnvelope(-180, $${at.south}, $${at.east}, $${at.north}, 4326)`]
    : [`ST_MakeEnvelope($${at.west}, $${at.south}, $${at.east}, $${at.north}, 4326)`];
  const tests = envelopes.map(envelope => `ST_Intersects(${column}, ${envelope})`);
  return tests.length === 1 ? tests[0] : `(${tests.join(' OR ')})`;
}
