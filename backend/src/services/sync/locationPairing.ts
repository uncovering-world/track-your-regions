/**
 * How a run decides that a stored point is the point the source is offering, and
 * what it says about one it kept.
 *
 * Split out of `locationWriter.ts` when the per-point diff took that file well
 * past the eight-hundred-line line `docs/tech/development-guide.md` draws (#569).
 * The vocabulary here is what the writer's statements are *built from* rather
 * than what they do: identity (`samePointSql`, `claimedPointSql`), the guard that
 * keeps a claimed column (`claimed`), and the reading of what a kept row's own
 * columns say happened to it (`keptChanges`). `contentsChangeSet.ts` already
 * consumed the last of those from outside the file, which is the seam this
 * follows.
 *
 * **Identity is the point together with the reference.** Neither alone works,
 * and the data says so in both directions:
 *
 * - the reference alone is not unique — UNESCO's reference names a *component*,
 *   and a component crossing a border is listed once per country, so
 *   `749ter-001` appears three times on W-Arly-Pendjari with three distinct
 *   points; eight experiences are like that;
 * - the point alone is not unique either — the source repeats a coordinate
 *   across distinct components. Checked against UNESCO's own API rather than
 *   assumed: site 874 offers 758 components at 546 distinct points, 97 of them
 *   shared, and the worst is one coordinate given to seventeen separately named
 *   and separately referenced rock shelters. It is not a rounding artefact —
 *   the published values carry ten decimals and are identical. Treating those
 *   as one row would discard 336 named components across the catalogue.
 *
 * The pair is unique across all 6677 stored rows, with no collisions. The
 * remaining candidate, the `(experience_id, ordinal)` unique key, is positional:
 * if the source reorders `components_list`, ordinal 3 becomes a different place
 * and keeping its assignment would be worse than rebuilding it.
 *
 * For the region assignment this is the right question either way: a component
 * that kept its point kept its region, and one that moved has to be recomputed
 * whatever it is called. Keying on the pair only adds that a *renumbered*
 * component is treated as new — which errs towards recomputing, the safe side.
 *
 * Every comparison happens in PostGIS rather than on JavaScript numbers.
 * Round-tripping a coordinate through a JS float to compare it risks calling an
 * unmoved point moved, which would throw away a good assignment for nothing.
 */

import { LOCATION_UNCHANGED_METERS } from './changeSet.js';
import type { ContentItem, ContentItemChange, ContentsDelta } from './types.js';
import { pointChanges } from './contentsChangeSet.js';

/**
 * When a stored row is the point the source is offering (ADR-0027).
 *
 * One fragment for both halves of the question, because they are one rule and
 * separating them is the way it gets broken: **the reference decides which row is
 * a candidate, and the geometry decides whether the source means the same place.**
 * A tolerance applied without the reference would be a nearest-point search over
 * an object's own points, and 4172 pairs of points of one experience lie within a
 * kilometre of each other — many at 0.000 m, because what distinguishes two
 * rock-art shelters in one cliff is the component number, not the metres between
 * them. Every site that asks this question composes this, so no site can ask half
 * of it.
 *
 * Ten metres, from `changeSet.ts`, where it already answers the same question
 * about the experience's own coordinate. Below the width of the thing being
 * pointed at — a museum's door against its centroid — so a source re-centring a
 * park still reads as a move and still raises a card; what it absorbs is
 * arithmetic. 1642 of 6680 stored points sit on a coordinate rounded to six
 * decimals, which is what the World Heritage list's degrees-minutes-seconds
 * become, so a single re-publication at full precision would otherwise withdraw a
 * quarter of the catalogue's pins in one run.
 *
 * Exact where the incoming point carries no reference: without one there is
 * nothing to be a candidate *of*, so the tolerance would have nothing to hold it
 * to one component.
 *
 * `LOCATION_UNCHANGED_METERS` is interpolated rather than parameterised because it
 * is a module constant and never reaches here from a request; the coordinates
 * beside it are parameters, bound by `locationIncoming.ts` as everywhere here.
 */
export function samePointSql(alias: string): string {
  return `${alias}.external_ref IS NOT DISTINCT FROM i.external_ref
        AND (CASE WHEN i.external_ref IS NULL
                  THEN ${alias}.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
                  ELSE ST_DWithin(${alias}.location::geography,
                                  ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)::geography,
                                  ${LOCATION_UNCHANGED_METERS})
             END)`;
}

/**
 * The pairing a claimed coordinate needs, and the reason the tolerance cannot
 * serve it.
 *
 * Identity is the point together with the reference, and the point half is a ten
 * metre window (ADR-0027). A curator's correction is the opposite of a rewrite
 * inside that window — the motivating case is 2.0 km — so a corrected row falls
 * out of `samePointSql` against the coordinate the source keeps offering. Out of
 * the pairing it is out of every arm that could protect it: the source's point is
 * inserted as a new row, the curator's is marked withdrawn, and the guard below
 * never runs. The claim would then hold for exactly the corrections too small to
 * need it.
 *
 * So a claimed row pairs on the reference alone. It keeps its real `metres`, so
 * where another stored row sits on the source's coordinate that row still wins
 * the pairing — a claim buys the corrected point its place in the list, not
 * priority over a better match.
 *
 * `IS NOT DISTINCT FROM`, so a referenceless row is covered too, and the reason
 * is worth stating because the null-safe form usually deserves suspicion. Made
 * strict, this fragment excludes exactly the row it most needs to protect: with
 * no reference `samePointSql` falls back to *exact* coordinate equality, so a
 * corrected referenceless point matches nothing, is withdrawn, and the source's
 * pin returns — the defect this whole branch exists to close, on the one row the
 * strict form declines to cover. And because that row is its experience's only
 * point, the anchor moved with the correction, so the object would end with its
 * coordinate on the curator's point and its only visible point on the source's:
 * #550, made by the endpoint written to close it.
 *
 * What the null-safe form costs is bounded by the data and by the pairing.
 * Measured 2026-08-21: the catalogue holds exactly one location with no
 * reference (Routes of Santiago de Compostela in France, 868) and no object holds
 * two, so "any referenceless incoming point" is one point. Were there two, the
 * second `DISTINCT ON` still makes the pairing one-to-one, and it breaks that
 * collision by `ordinal` — the source's own order, distance unread, the greedy
 * rule `locationWriter.ts` states where it builds that relation — so the
 * first-listed point takes the claimed row and the other arrives as new.
 */
export function claimedPointSql(alias: string): string {
  return `${alias}.curated_fields ? 'location'
        AND ${alias}.external_ref IS NOT DISTINCT FROM i.external_ref`;
}

/**
 * The opening of a `CASE` that keeps a stored value a curator has claimed.
 *
 * The same guard `syncUtils` puts on an experience's columns (#488), one level
 * down: a point is a thing a curator can be right about, and before this every
 * arm in `locationWriter.ts` wrote the source's name and coordinate over
 * whatever they had decided, on the next run, silently.
 *
 * Only `name` and `location` are ever claimed. `external_ref` is the source's
 * handle on the row and `ordinal` is its place in the source's list — both are
 * what the pairing above reads to decide whether a point moved or was replaced,
 * so a claim on either would not protect a judgement, it would make the writer
 * unable to recognise the row it is holding.
 */
export function claimed(column: 'name' | 'location'): string {
  return `CASE WHEN el.curated_fields ? '${column}'`;
}

/** An empty delta, for the paths on which the writer performed nothing. */
export const NO_CHANGE: ContentsDelta = { added: [], withdrawn: [], returned: [], changed: [] };

/** One row of the keeping arm, which returns both sides of what it wrote. */
export interface KeptRow {
  old_name: string | null;
  old_lon: number;
  old_lat: number;
  old_curated_fields: string[] | null;
  new_name: string | null;
  new_lon: number;
  new_lat: number;
  external_ref: string | null;
}

/**
 * What the run rewrote about the points it kept.
 *
 * A claimed column is reported rather than hidden: the guard kept the curator's
 * value, and `curatedConflict` is how the object's diff says exactly that — the
 * source proposed something and did not get it. A run that quietly dropped those
 * would leave a curator unable to see that their point is still being argued with.
 */
export function keptChanges(rows: KeptRow[]): ContentItemChange[] {
  const out: ContentItemChange[] = [];
  for (const row of rows) {
    const fields = pointChanges(
      { name: row.old_name, lon: Number(row.old_lon), lat: Number(row.old_lat) },
      { name: row.new_name, lon: Number(row.new_lon), lat: Number(row.new_lat) },
      row.old_curated_fields ?? [],
    );
    if (fields.length > 0) {
      // Named by what it was called before the run rewrote it, like every other
      // item in the record: the name a curator saw is the one they can find.
      out.push({ item: { name: row.old_name, ref: row.external_ref }, fields });
    }
  }
  return out;
}

/** Name a row the way the record names it: what the source calls it, not its id. */
export function named(rows: Array<{ name?: string | null; external_ref?: string | null }>): ContentItem[] {
  return rows.map(r => ({ name: r.name ?? null, ref: r.external_ref ?? null }));
}
