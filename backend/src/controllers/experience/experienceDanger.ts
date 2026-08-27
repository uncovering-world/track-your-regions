/**
 * What a list read says about a site being in danger.
 *
 * The row stores the fact as UNESCO wrote it: a boolean in `metadata.inDanger`
 * and the dated listing beside it, "Y 2013" for the Ancient City of Aleppo. The
 * badge needs both — whether to draw it, and since when — and the year is read
 * out of the stored string rather than stored a second time as a number, so the
 * catalogue keeps saying what the source said and one parser answers the
 * question in both directions (`parseDangerListing`, used by the importer that
 * writes the flag and by this read months later).
 *
 * One place, because three select lists and two reads ask it: the by-region
 * list, its `includeChildren` twin, and the flat list. The raw listing does not
 * leave the server — a client that had to parse "Y 2013" for itself would be a
 * third copy of the same rule.
 */

import { parseDangerListing } from '../../services/sync/dangerListing.js';

/**
 * The two columns the fields below are read from, for a select list.
 *
 * `metadata->>'inDanger'` comes back as the string `'true'`, which is why the
 * mapping below exists at all rather than the column being sent straight out.
 */
export function dangerSelectSql(alias = 'e'): string {
  return `${alias}.metadata->>'inDanger' as in_danger,
        ${alias}.metadata->>'dangerList' as danger_list`;
}

/** A row as `pg` hands it back, carrying whatever else the select list asked for. */
type ExperienceRow = Record<string, unknown>;

/**
 * The row a reader gets: the flag as a boolean, the year as a number, and the
 * source's own string left behind.
 */
export function withDangerFields<T extends ExperienceRow>(
  row: T,
): Omit<T, 'in_danger' | 'danger_list'> & { in_danger: boolean; danger_since: number | null } {
  const { danger_list: listing, in_danger: flag, ...rest } = row;
  return {
    ...rest,
    in_danger: flag === 'true',
    // Only where the site is in danger: a year on a row whose flag is false
    // would be a date with nothing to date.
    danger_since: flag === 'true' ? parseDangerListing(listing)?.since ?? null : null,
  };
}
