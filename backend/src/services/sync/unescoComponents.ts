/**
 * A World Heritage run's components, resolved to their Wikidata items (#1269).
 *
 * A component of a serial site is a point with a name, a coordinate and its
 * UNESCO reference; Wikidata records many components as items of their own,
 * carrying that reference as their World Heritage Site ID (P757). The run
 * records the item on the point, site by site (`resolveComponents`,
 * `recordComponentItems`), and keeps a count for its own log: how many
 * components of each site resolved, and which references more than one item
 * carries, read where an admin reads the run. What the item says about the
 * component — its picture and its description — becomes the point's own
 * (#1270, `writePointContents`).
 */

import { pool } from '../../db/index.js';
import { isCommonsPictureUrl } from '../../types/urlSafety.js';
import type { ImageCredit } from './imageCredit.js';
import { recordComponentItems, type LocationWriteRun } from './locationWriter.js';
import { writePointContents } from './pointContentWriter.js';
import type { ComponentItemsReport } from './syncUtils.js';
import type { ContentItemChange } from './types.js';
import { componentContents, resolveComponents, type WorldHeritageIndex } from './unescoWikidata.js';

/** The part of a processed site this reads: its components' references. */
interface SiteComponents {
  locations: ReadonlyArray<{ externalRef: string | null }>;
}

/** The World Heritage source, as seeded. */
const UNESCO_SOURCE_ID = 1;

/** The run's record of its components' items, as it accumulates. */
export function newComponentReport(): ComponentItemsReport {
  return { resolved: 0, total: 0, failedSites: 0, ambiguous: [], unresolvedSites: [] };
}

/** The sites listed with components left without an item: the fifty that left most. */
const UNRESOLVED_SITES_LISTED = 50;

export function finishComponentReport(report: ComponentItemsReport): ComponentItemsReport {
  const unresolvedSites = [...report.unresolvedSites]
    .sort((a, b) => (b.total - b.resolved) - (a.total - a.resolved) || a.name.localeCompare(b.name))
    .slice(0, UNRESOLVED_SITES_LISTED);
  return { ...report, unresolvedSites };
}

/**
 * The component pictures this run is about to write that no point holds a
 * credit for yet (#1270): the run asks Commons about those only, beside the
 * sites' own pictures, and a point receiving one of the others takes the
 * credit a point already holds for that file (`writePointContents`).
 */
export async function componentPicturesToCredit(
  facts: WorldHeritageIndex,
  sites: ReadonlyArray<string | number>,
): Promise<string[]> {
  const offered = new Set<string>();
  for (const site of sites) {
    for (const candidate of facts.bySite.get(String(site))?.component ?? []) {
      if (candidate.image && !candidate.deprecated && isCommonsPictureUrl(candidate.image)) offered.add(candidate.image);
    }
  }
  if (offered.size === 0) return [];
  const credited = await pool.query<{ image_url: string }>(
    `SELECT DISTINCT image_url FROM experience_locations
      WHERE image_url = ANY($1::text[]) AND metadata ? 'imageCredit'`,
    [[...offered]],
  );
  for (const row of credited.rows) offered.delete(row.image_url);
  return [...offered];
}

/**
 * Resolve a serial site's components to their Wikidata items and record them
 * on the points (#1269), counting what resolved for the run's log, then write
 * what each item says about its component — picture, credit, description — on
 * the point (#1270). Answers what that write changed or held, for the run's
 * contents record. A site of one point has no component reference and nothing
 * to resolve.
 */
export async function resolveSiteComponents(
  facts: WorldHeritageIndex,
  record: { id_no: number | string; name_en?: string | null },
  processed: SiteComponents,
  experienceId: number,
  report: ComponentItemsReport,
  run: LocationWriteRun,
  credits: ReadonlyMap<string, ImageCredit>,
): Promise<ContentItemChange[]> {
  const refs = processed.locations.map(loc => loc.externalRef).filter((ref): ref is string => !!ref);
  if (refs.length === 0) return [];
  const site = String(record.id_no);
  const resolution = resolveComponents(facts, site, refs);
  let changed: ContentItemChange[];
  try {
    await recordComponentItems(experienceId, resolution.items, UNESCO_SOURCE_ID);
    changed = await writePointContents(experienceId, componentContents(facts, site, resolution.items).map(one => ({
      ref: one.ref,
      imageUrl: one.image,
      imageCredit: (one.image && credits.get(one.image)) || null,
      description: one.description,
    })), run);
  } catch (error) {
    // The site and its points are written already; a side record that failed
    // is counted on the report and the site is not turned into an error.
    console.error('[UNESCO Sync] Could not record the components of site %s:', site, error);
    report.failedSites += 1;
    return [];
  }
  report.total += resolution.points;
  report.resolved += resolution.resolved;
  report.ambiguous.push(...resolution.ambiguous.map(one => ({ site, ...one })));
  if (resolution.resolved < resolution.points) {
    report.unresolvedSites.push({
      site, name: record.name_en || `Site ${site}`, resolved: resolution.resolved, total: resolution.points,
    });
  }
  return changed;
}
