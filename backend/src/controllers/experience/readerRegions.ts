/**
 * Where an object can be opened, as one JSON list a client turns into an
 * address.
 *
 * The search read (#592, ADR-0042) was the first to send it: every answer
 * carries the regions whose own lists will hold the object, in the world views
 * a visitor may see, most specific first, and the client opens the first one in
 * the world view already open — never another world view's. A link from one
 * card to another asks the same question of the object it names (a find's
 * museum, a work's find spot, #894), and the answer has to be the same list by
 * the same three rules, or a link would open a region whose list drops the
 * card on arrival — the dead click ADR-0042 says a row never gives.
 *
 * Published world views only, because the reads that send this carry no
 * session or answer the same to everyone: "visible" can mean nothing else on
 * such a route. The by-id read's `regions[]` is caller-shaped and stays its
 * own query.
 */

import { readerRegionMembershipSql } from '../../db/readerPredicates.js';

/**
 * The regions that name the object `experienceIdExpr` to a reader, as a JSON
 * array of `{ id, name, world_view_id, world_view_name }`, smallest first —
 * `'[]'` where nothing published places it.
 *
 * `experienceIdExpr` is a column reference from the enclosing query (`m.id`,
 * `t.id`); the fragment's own aliases are `er`, `r`, `wv` and `rej`, so it
 * cannot sit inside a query that already binds one of those.
 */
export function readerRegionsJsonSql(experienceIdExpr: string): string {
  return `COALESCE((
        SELECT json_agg(json_build_object(
                 'id', r.id,
                 'name', r.name,
                 'world_view_id', r.world_view_id,
                 'world_view_name', wv.name)
               -- Most specific first: an object hangs on the whole chain that
               -- holds it, and the Rijksmuseum is in Europe as truly as it is
               -- in Noord-Holland. The caller opens exactly one of these, so
               -- the smallest is the one that frames the object rather than the
               -- continent. Area rather than a walk up parent_region_id: the
               -- question is which is the smaller place, and a region whose
               -- geometry has not been computed sorts last rather than first.
               ORDER BY r.geom_area_km2 ASC NULLS LAST, r.id)
        FROM experience_regions er
        JOIN regions r ON r.id = er.region_id
        JOIN world_views wv ON wv.id = r.world_view_id
        WHERE er.experience_id = ${experienceIdExpr}
          AND wv.is_active = true
          AND wv.is_public = true
          -- Named to a reader only where a point they may see put the object
          -- there (#521), for the reason the by-id read gives: this list is a
          -- claim the caller acts on — it opens a card at one of these regions
          -- — so it has to name the regions whose own lists will hold it.
          AND ${readerRegionMembershipSql('er.experience_id')}
          -- And not a pair a curator turned down. A rejection leaves the
          -- membership row standing (curationController.ts upserts into
          -- experience_rejections and deletes nothing), while every
          -- region-facing read drops the pair -- the region list and its count
          -- through experienceRegionQuery.ts's rejectionFilter, region-counts
          -- through the join below. Without this the row would be a link to a
          -- region whose own list answers without the card, and the address
          -- would quietly drop the /e/ segment on arrival: the dead click
          -- ADR-0042 says a row never gives. The by-id read carries the same
          -- gap and it is informational there; here the array is the click.
          AND NOT EXISTS (
            SELECT 1 FROM experience_rejections rej
            WHERE rej.experience_id = er.experience_id
              AND rej.region_id = er.region_id)
      ), '[]'::json)`;
}
