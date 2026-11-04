/**
 * Where each famous work of the place pass's gather of works lies (#1821),
 * kept whatever any kind then shows of it: a work no kind shows is still in
 * its place, and the catalogue check that names a place no kind offers holding
 * a famous work reads it (`works-in-no-offered-place` in
 * `controllers/admin/dataAssertions/workAssertions.ts`).
 *
 * A workbench table (ADR-0124), replaced whole by each pass that reads works.
 * A failed write is logged and the run goes on: it is a by-product of the
 * gather, and no kind's run reads it.
 */

// ADR-0064: raw parameterized SQL on the pool.
import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { ICONIC_RELEASE } from '../museum/tier1.js';
import type { GatheredWorks } from '../museum/worksGather.js';
import { currentValues, whereaboutsUnknown } from '../museum/placement.js';

/** The works kept: at the line a famous work holds a place by (Art Museums' stay line). */
export const GATHERED_WORK_FLOOR = ICONIC_RELEASE;

export interface GatheredWorkVenue {
  workQid: string;
  workLabel: string;
  sitelinks: number;
  venueQid: string;
  property: 'P195' | 'P276';
}

/**
 * Every venue a famous work's statements name now: a work at the floor or
 * above, not lost, and not of unknown whereabouts (#868: a work whose current
 * location is unknown is not hung at the older venue its other statements
 * still remember), each property read by the placement's rule, its preferred
 * values where it has any, so a residue normal-rank value is dropped beside a
 * preferred one.
 */
export function gatheredWorkVenues(gathered: GatheredWorks): GatheredWorkVenue[] {
  const rows: GatheredWorkVenue[] = [];
  for (const work of gathered.pool.values()) {
    if (work.sitelinks < GATHERED_WORK_FLOOR || gathered.lostPool.has(work.qid)) continue;
    const statements = gathered.statements.get(work.qid) ?? [];
    if (whereaboutsUnknown(statements)) continue;
    for (const property of ['P195', 'P276'] as const) {
      // No venue graph here, so any named value counts as one a resolver would answer.
      for (const venueQid of new Set(currentValues(statements, property, (qid) => qid))) {
        rows.push({ workQid: work.qid, workLabel: work.label, sitelinks: work.sitelinks, venueQid, property });
      }
    }
  }
  return rows;
}

/** Replace the table with this gather's famous works and their venues; the count written, or null where it failed. */
export async function writeGatheredWorkVenues(gathered: GatheredWorks, logPrefix: string): Promise<number | null> {
  const rows = gatheredWorkVenues(gathered);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM workbench.gathered_work_venues');
    await client.query(
      `INSERT INTO workbench.gathered_work_venues (work_qid, work_label, sitelinks, venue_qid, property)
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[])`,
      [
        rows.map((r) => r.workQid), rows.map((r) => r.workLabel), rows.map((r) => r.sitelinks),
        rows.map((r) => r.venueQid), rows.map((r) => r.property),
      ],
    );
    await client.query('COMMIT');
    console.log(`${logPrefix} Kept where ${new Set(rows.map((r) => r.workQid)).size} famous works lie: ${rows.length} venues named`);
    return rows.length;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    console.error('%s Could not keep where the famous works lie; the run goes on:', logPrefix, error);
    return null;
  } finally {
    client?.release();
  }
}
