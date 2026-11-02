/**
 * #2276: a place kind refuses a World Heritage site of several components as
 * one place of its kind.
 *
 * A serial site's item names the whole series, and its components are places
 * of their own, parts of the site (ADR-0100, ADR-0156). A traveller visits a
 * church of the Troödos, not "the Painted Churches" as one point, and the
 * World Heritage kind already holds the series with its ten churches. Places
 * of worship admitted the series' item beside it: the Painted Churches of the
 * Troödos Region, the Kii Mountain Range's sacred sites, the Jesuit Missions of
 * Chiquitos and of the Guaraní, the Khajuraho Group of Monuments.
 *
 * Wikidata's classes cannot tell a series from a single site: Cologne
 * Cathedral is a World Heritage item and a cathedral. The World Heritage run's
 * own records can — the item a listed site resolves to (`wikidata_items` on its
 * World Heritage membership) and the components it parted it into
 * (`experience_parts`). Read from the catalogue, never from Wikidata.
 *
 * Two shapes are not the series' item, and the rule keeps them:
 * - a site that resolves to several items has no one item of its own. The
 *   Historic Centre of Macao resolves to twenty-one, the A-Ma Temple and the
 *   Ruins of St. Paul's among them: buildings within it, each a place;
 * - an item one of the site's own components holds, on its record in World
 *   Heritage components or on another kind's membership, is that component's.
 *   The Potala Palace is the item the Historic Ensemble of the Potala Palace
 *   resolves to, and the Potala Palace component holds it as a place of worship.
 */

import { pool } from '../../../db/index.js';
import { MEMBERSHIPS } from '../../../db/membership.js';
import { WORLD_HERITAGE_KIND_ID } from '../../../db/inscription.js';
import type { FilteredEntity } from '../syncContract.js';
import { isQid } from '../wikidataUtils.js';
import { moveRefused, type RefusedItemOf } from './lateRefusal.js';

/** A listed World Heritage site whose one item a kind's candidate is. */
export interface SerialSite {
  /** The site's name, as the catalogue holds its place. */
  site: string;
  /** How many components the World Heritage run parted it into. */
  components: number;
}

/** The fewest components that make a site a series rather than one place. */
export const SERIES_MIN_COMPONENTS = 2;

/**
 * How far apart a site's components must lie, at the most, for it to be a
 * series a traveller visits part by part rather than one place: the display
 * rule's own 10 km (ADR-0172). The Painted Churches of the Troödos, the Kii
 * Mountain Range's sites and Stonehenge with Avebury (28 km) span more;
 * Maulbronn Monastery with its ponds (6.6 km), Khajuraho's temples (3.9 km)
 * and the Hōryū-ji area (1.4 km) are each one visit.
 */
export const SERIES_MIN_SPAN_KM = 10;

/**
 * The item each listed site resolves to, alone, with the site's name and its
 * count of components, where the site has `SERIES_MIN_COMPONENTS` or more,
 * spread more than `SERIES_MIN_SPAN_KM` apart, and no component of its own
 * holds the item. A site the list no longer holds
 * (`source_membership`, a curator's confirmed delisting) is no series of it.
 */
export const SERIAL_SITE_ITEMS_SQL = `
  SELECT item, e.name AS site, count(p.id)::int AS components
    FROM ${MEMBERSHIPS} site
    JOIN experiences e ON e.id = site.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(site.wikidata_items) AS item
    JOIN experience_parts p ON p.membership_id = site.id AND p.reason = 'component'
    JOIN experiences part ON part.id = p.part_id
   WHERE site.kind_id = $2
     AND site.source_membership = 'present'
     AND site.wikidata_items && $1::text[]
     AND cardinality(site.wikidata_items) = 1
     AND NOT EXISTS (
       SELECT 1 FROM experience_parts own
         JOIN ${MEMBERSHIPS} held ON held.experience_id = own.part_id
        WHERE own.membership_id = site.id AND own.reason = 'component'
          AND (held.external_id = item OR held.wikidata_items @> ARRAY[item]))
   GROUP BY item, e.id, e.name
  HAVING count(p.id) >= $3
     AND ST_Length(ST_LongestLine(ST_Collect(part.location), ST_Collect(part.location))::geography) > $4 * 1000`;

/** The serial site each of `qids` is the item of; an item of no such site is absent. */
export async function serialSiteItems(qids: readonly string[]): Promise<Map<string, SerialSite>> {
  const asked = [...new Set(qids.filter(isQid))];
  const out = new Map<string, SerialSite>();
  if (!asked.length) return out;
  const { rows } = await pool.query<{ item: string; site: string; components: number }>(
    SERIAL_SITE_ITEMS_SQL, [asked, WORLD_HERITAGE_KIND_ID, SERIES_MIN_COMPONENTS, SERIES_MIN_SPAN_KM],
  );
  // An item two listed sites resolve to alone is refused under the larger.
  for (const row of rows) {
    const known = out.get(row.item);
    if (!known || row.components > known.components) out.set(row.item, { site: row.site, components: row.components });
  }
  return out;
}

/** Why a kind refuses the item of a serial site. */
export function serialSiteReason(series: SerialSite): string {
  return `a World Heritage site of ${series.components} components (${series.site}): each component is a place of its own`;
}

/**
 * Refuse, by name and with the reason, every item the run would write that is
 * a World Heritage site of several components, after the kind's rule and its
 * tiers have decided, so it binds every tier and door. A place the catalogue
 * already offers is refused as any refusal of it is: held for a curator, never
 * deleted. Returns how many it refused, for the run's log.
 */
export async function refuseSerialSites<T>(
  items: T[], filtered: FilteredEntity[], of: RefusedItemOf<T>, logPrefix: string,
): Promise<number> {
  const series = await serialSiteItems(items.map(of.id));
  const refused = moveRefused(items, filtered, of, (item) => {
    const known = series.get(of.id(item));
    return known ? serialSiteReason(known) : null;
  });
  if (refused.length) console.log(`${logPrefix} Refused as a World Heritage series (#2276): ${refused.join(', ')}`);
  return refused.length;
}
