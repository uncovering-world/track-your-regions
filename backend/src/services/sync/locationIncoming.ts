/**
 * The source's list, made into something a statement can join against.
 *
 * Split out of `locationWriter.ts` with the pairing vocabulary beside it (#569),
 * for the same reason: that file had grown past the length the development guide
 * gives as its one numeric trigger. This half is about the *incoming* rows —
 * turning them into a CTE, binding their values, and removing the duplicates the
 * source itself ships — and it decides nothing about what is stored, which is
 * the whole of the writer's own subject.
 */

import { LOCATION_UNCHANGED_METERS } from './changeSet.js';

/** One point as the source offers it, before anything is known about the store. */
export interface IncomingLocation {
  name: string | null;
  externalRef: string | null;
  lon: number;
  lat: number;
}

/**
 * Build the incoming list as a relation the query can join against.
 *
 * `$1` is always the experience id; each location contributes four parameters
 * after it. The empty case still has to produce a well-typed relation, because
 * `locationWriter.ts`'s statements join against it either way — and an untyped
 * `NULL` column would leave Postgres unable to infer the join's types.
 */
export function incomingCte(count: number): string {
  if (count === 0) {
    return `incoming(ordinal, external_ref, name, lon, lat) AS (
              SELECT NULL::int, NULL::text, NULL::text, NULL::float8, NULL::float8
              WHERE FALSE)`;
  }
  const rows = Array.from({ length: count }, (_, i) => {
    const b = i * 4 + 2;
    return `(${i + 1}, $${b}::text, $${b + 1}::text, $${b + 2}::float8, $${b + 3}::float8)`;
  });
  return `incoming(ordinal, external_ref, name, lon, lat) AS (VALUES ${rows.join(', ')})`;
}

/**
 * Drop repeats of the same place under the same reference, keeping the first.
 *
 * Two entries with the same reference at the same point — or, since ADR-0027,
 * within the ten metres that make it the same point — carry no information to
 * tell them apart, so collapsing them is the only reading available. That is a
 * different case from a coordinate two components share — the shape
 * `locationPairing.ts` measures — since those differ by reference and stay
 * separate rows, however close they sit.
 *
 * It matters because a repeated pair would make the writer's join many-to-many —
 * both stored rows could take the same incoming ordinal, and the write would die
 * on the `(experience_id, ordinal)` unique key, rolling that experience back on
 * every subsequent sync. Deduping here keeps every claim the writer makes true at
 * once: the CTE is one row per identity, the UPDATE matches at most one entry
 * per stored row, and the fast path compares two counts that mean the same
 * thing.
 */
export function dedupeByIdentity(incoming: IncomingLocation[]): IncomingLocation[] {
  const seen = new Set<string>();
  const kept: IncomingLocation[] = [];
  return incoming.filter(loc => {
    // JSON rather than a joined string: `null` and `''` are different
    // references to `IS NOT DISTINCT FROM`, and a key that flattened them would
    // drop one of a pair the SQL then treats as two — the mark would take the
    // survivor's stored row and hide a point the source still offers.
    const key = JSON.stringify([loc.lon, loc.lat, loc.externalRef]);
    if (seen.has(key)) return false;
    // And the same question the matcher asks, or the promise above is only true of
    // exact repeats: two entries carrying one reference nine metres apart are both
    // within the tolerance of one stored row. What that costs is not silence — the
    // pairing is one-to-one, so the lower ordinal takes the row and the other is
    // *inserted*, deterministically. It costs the run creating a second row nine
    // metres from the first under one reference: exactly the pair ADR-0027 exists to
    // remove and migration 026 exists to repair, manufactured fresh, for the next run
    // to pair one of them and mark the other. With no stored row yet they both insert
    // and reach the same place. Deduping is cheaper than either.
    //
    // Two such entries are indistinguishable to every rule this file has: the
    // reference is the same and the geometry says one place. So one place is
    // what they become, which is the existing rule widened rather than a new
    // one — and points that really are apart stay apart, the catalogue's
    // multi-point references standing 14 km and more from each other.
    if (loc.externalRef !== null && loc.externalRef !== undefined
      && kept.some(other => other.externalRef === loc.externalRef
        && metresBetween(other, loc) <= LOCATION_UNCHANGED_METERS)) return false;
    seen.add(key);
    kept.push(loc);
    return true;
  });
}

/**
 * Metres between two incoming points, near enough for a ten-metre question.
 *
 * The one place in this file that measures in JavaScript, and it is allowed here
 * for the reason the rest is not: this compares two entries of the *source's own
 * list* to decide which of two indistinguishable ones to carry, and writes
 * nothing to the database on its answer. Every comparison against a stored row
 * still happens in PostGIS, where a rounding error would cost a region
 * assignment.
 *
 * Equirectangular rather than haversine: over ten metres the two agree to well
 * under a millimetre at any latitude this catalogue holds, and the cosine keeps
 * a degree of longitude honest at 78°N, where it is a quarter of what it is at
 * the equator.
 *
 * The haversine it replaces was antimeridian-safe for free — `sin(dLon/2)` reads
 * 360° − ε as ε — and a raw subtraction is not, so the difference is normalised
 * to (−180, 180]. Without it, two entries either side of the line and a metre
 * apart measure 40 000 km, both survive the dedupe, both answer the tolerance
 * against one stored row, and the object gains a second row for one place under
 * one reference. Latent rather than live: the catalogue's Pacific sites all sit
 * clear of the line. It is the repo's standing rule regardless (CLAUDE.md
 * § Antimeridian Handling), and this is the file's only distance in JavaScript.
 */
function metresBetween(a: IncomingLocation, b: IncomingLocation): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLon = ((b.lon - a.lon + 540) % 360) - 180;
  const x = dLon * toRad * Math.cos((a.lat + b.lat) / 2 * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.sqrt(x * x + y * y) * R;
}

export function bindParams(experienceId: number, incoming: IncomingLocation[]): unknown[] {
  const params: unknown[] = [experienceId];
  for (const loc of incoming) params.push(loc.externalRef, loc.name, loc.lon, loc.lat);
  return params;
}
