/**
 * The standing sweep (#1719, ADR-0217 decision 2): a place may begin to stand
 * on a day still ahead, its opening day, and its standing today
 * (`experiences.stands_today`, `source_records.stands_today`) moves on that
 * day with no write to its periods. The schema's `refresh_standing_due()`
 * re-derives every place whose open standing period has begun while it, or
 * its membership in the period's kind, is still stored as not standing, only
 * where a column differs; this runs it at boot and every hour, so a place
 * opens within the hour its day begins at UTC+14, the latest day on Earth,
 * and a sweep missed for an hour or a year is caught by the next.
 */

import { pool } from '../db/index.js';

/** How often the sweep runs: a day begins at a whole hour in no zone the sweep keeps. */
export const STANDING_SWEEP_MS = 60 * 60 * 1000;

/** Re-derive today's standing of every place whose opening day has come. A failure is logged, never thrown. */
export async function sweepStanding(): Promise<void> {
  try {
    await pool.query('SELECT refresh_standing_due()');
  } catch (err) {
    console.error('Standing sweep failed:', err);
  }
}
