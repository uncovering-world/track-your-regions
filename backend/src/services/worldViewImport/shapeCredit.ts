/**
 * The credit of a stored region shape (#2085): whose work the outline the
 * admin's import dialogs draw is, and under which licence. A Commons map data
 * file is its author's work under the licence the file declares, most often
 * ODbL for one drawn from OpenStreetMap; a shape under an item's own key is
 * cut from the OpenStreetMap layer (`refillRegionShapes`, ADR-0157) and is
 * OpenStreetMap's work under ODbL. Both licences ask for the credit wherever
 * the shape is shown (ADR-0059 decision 3 asks the same of a site's outline).
 * The store keeps the licence with the shape, and every answer that draws a
 * stored shape answers its credit beside it.
 */

import { pool } from '../../db/index.js';
import type { WikidataGeoshapesRow } from '../../db/schema.generated.js';
import type { ShapeCredit } from '../../api/responses/worldViewImport.js';

const COMMONS_KEY = 'commons:';
const COMMONS_DATA_PAGE = 'https://commons.wikimedia.org/wiki/Data:';
const ITEM_KEY = /^Q[1-9]\d*$/;
const OSM_CREDIT = { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' };

type CreditRow = Pick<WikidataGeoshapesRow, 'wikidata_id' | 'licence' | 'attribution'>;

/**
 * A stored shape's credit: for a Commons file, the file it was read from,
 * linked to its page, with its licence and what it says it was drawn from;
 * for an item's shape, OpenStreetMap's contributors, linked to its copyright
 * page. A shape with no licence has none.
 */
export function shapeCredit({ wikidata_id: key, licence, attribution }: CreditRow): ShapeCredit | null {
  if (!licence) return null;
  if (ITEM_KEY.test(key)) return { ...OSM_CREDIT, licence, attribution };
  if (!key.startsWith(COMMONS_KEY)) return null;
  const file = key.slice(COMMONS_KEY.length);
  return {
    label: `Data:${file}`,
    url: `${COMMONS_DATA_PAGE}${encodeURIComponent(file)}`,
    licence,
    attribution,
  };
}

/**
 * The credits of the stored shapes under these keys, in key order; a key with
 * no shape has none, and shapes under one credit (every OpenStreetMap shape)
 * are credited once.
 */
export async function shapeCreditsFor(keys: readonly string[]): Promise<ShapeCredit[]> {
  if (keys.length === 0) return [];
  const result = await pool.query<CreditRow>(
    `SELECT wikidata_id, licence, attribution FROM wikidata_geoshapes
     WHERE wikidata_id = ANY($1::text[]) AND NOT not_available AND geom IS NOT NULL
     ORDER BY array_position($1::text[], wikidata_id)`,
    [[...new Set(keys)]],
  );
  const credits = new Map<string, ShapeCredit>();
  for (const credit of result.rows.map(shapeCredit)) {
    if (credit && !credits.has(credit.url)) credits.set(credit.url, credit);
  }
  return [...credits.values()];
}
