/**
 * What a list read says about a site being in danger.
 *
 * The World Heritage membership stores the fact as UNESCO wrote it: a boolean
 * `inDanger` among its facts and the dated listing beside it, "Y 2013" for the
 * Ancient City of Aleppo (`db/inscription.ts`, #2068). The badge needs both —
 * whether to draw it, and since when — and the year is read out of the stored
 * string rather than stored a second time as a number, so the catalogue keeps
 * saying what the source said and one parser answers the question in both
 * directions (`parseDangerListing`, used by the importer that writes the flag
 * and by this read months later).
 *
 * One place, because more than one select list asks it: the by-region list and
 * its `includeChildren` twin, and the review queue's object context. The raw
 * listing does not leave the server — a client that had to parse "Y 2013" for
 * itself would be another copy of the same rule.
 */

import { inscriptionFactsSql } from '../../db/inscription.js';
import { parseDangerListing } from '../../services/sync/dangerListing.js';

/**
 * The column the fields below are read from, for a select list: the facts of
 * the World Heritage membership a reader is shown, or NULL where none is,
 * so a site judged former (delisted) or refused draws no badge.
 */
export function dangerSelectSql(alias = 'e'): string {
  return `${inscriptionFactsSql(alias)} AS inscription`;
}

/** A row as `pg` hands it back, carrying whatever else the select list asked for. */
type ExperienceRow = Record<string, unknown>;

/**
 * The row a reader gets: the flag as a boolean, the year as a number, and the
 * source's own facts left behind.
 */
export function withDangerFields<T extends ExperienceRow>(
  row: T,
): Omit<T, 'inscription'> & { in_danger: boolean; danger_since: number | null } {
  const { inscription, ...rest } = row;
  const facts = (inscription ?? {}) as { inDanger?: unknown; dangerList?: unknown };
  const flag = facts.inDanger === true;
  return {
    ...rest,
    in_danger: flag,
    // Only where the site is in danger: a year on a row whose flag is false
    // would be a date with nothing to date.
    danger_since: flag ? parseDangerListing(facts.dangerList)?.since ?? null : null,
  };
}
