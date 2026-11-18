/**
 * What a list read says about a site being in danger.
 *
 * The World Heritage membership holds each stay on the List of World Heritage
 * in Danger as a period (`record_danger_periods`, #2127): the Ancient City of
 * Aleppo's since 2013 is open, Cologne Cathedral's of 2004 to 2006 ended. The
 * badge needs whether an open stay is shown and since when; a stay that ended
 * draws nothing (`db/inscription.ts`).
 *
 * One place, because more than one select list asks it: the by-region list and
 * its `includeChildren` twin, and the review queue's object context.
 */

import { dangerStaySql } from '../../db/inscription.js';

/**
 * The column the fields below are read from, for a select list: the open stay
 * of the World Heritage membership a reader is shown, or NULL where none is,
 * so a site judged former (delisted), refused or out of danger draws no badge.
 */
export function dangerSelectSql(alias = 'e'): string {
  return `${dangerStaySql(alias)} AS danger_stay`;
}

/** A row as `pg` hands it back, carrying whatever else the select list asked for. */
type ExperienceRow = Record<string, unknown>;

/** The row a reader gets: the flag as a boolean and the year as a number, the stay itself left behind. */
export function withDangerFields<T extends ExperienceRow>(
  row: T,
): Omit<T, 'danger_stay'> & { in_danger: boolean; danger_since: number | null } {
  const { danger_stay: stay, ...rest } = row;
  const since = (stay as { since?: unknown } | null | undefined)?.since;
  return {
    ...rest,
    in_danger: stay != null,
    danger_since: typeof since === 'number' ? since : null,
  };
}
