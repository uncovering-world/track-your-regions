import type { SparqlBinding } from './wikidataUtils.js';

/**
 * A year the Wikidata Query Service gives, in the item's own numbering (#2564,
 * ADR-0214).
 *
 * Wikidata's JSON, and so the subset, numbers a year before the common era
 * with no year zero: the Lion Capital of Ashoka's inception is `-0250`, 250
 * BC. The query service writes a date it knows to the year or finer as an
 * `xsd:dateTime`, which numbers years astronomically, so the same inception
 * comes back as `-0249` and `YEAR()` as -249; a decade, a century or anything
 * coarser it leaves as the item states it. Every live reader that stores or
 * compares a year turns it back with this one function, so a year read live
 * and the same year read from the subset (`yearOf`, `subset/values.ts`) are
 * one number.
 */

/** Wikidata's precision of a date given to the year: 9. A finer date (10 a month, 11 a day) is shifted too. */
const YEAR_PRECISION = 9;

/**
 * The item's own year for a year the query service gave at `precision`
 * (Wikidata's scale; a year's where the service bound none): 1 BC for the
 * service's 0, 250 BC for its -249, and an AD year or a coarser BC one as it
 * came.
 */
export function itemYearOf(serviceYear: number, precision: number | null | undefined): number {
  const precise = (precision ?? YEAR_PRECISION) >= YEAR_PRECISION;
  return precise && serviceYear <= 0 ? serviceYear - 1 : serviceYear;
}

/**
 * The year of an inception a live pool query bound as `?year` (`YEAR(?inception)`)
 * beside its `?inceptionPrecision`, in the item's own numbering, or null where
 * it bound none (#2564): the Lion Capital of Ashoka's -249 at year precision
 * reads -250, as the subset reads it.
 */
export function inceptionYearOf(row: SparqlBinding): number | null {
  const year = row.year?.value;
  if (!year) return null;
  const precision = row.inceptionPrecision?.value;
  return itemYearOf(parseInt(year, 10), precision ? parseInt(precision, 10) : null);
}
