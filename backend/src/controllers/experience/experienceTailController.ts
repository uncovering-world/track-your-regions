/**
 * A region's tail (ADR-0172, #2201): the places a crowded city crowds out of
 * the region's list, read on their own and ranked, never mixed into the list.
 * GET /api/experiences/by-region/:regionId/tail
 *
 * Read like the list: a curator sees the places they may curate marked, and
 * a reader the New chip, with no curator relaxation of what is offered.
 */

import type { z } from 'zod/v4';
import type { RegionTailResponse } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import type { regionIdParamSchema, regionTailQuerySchema } from '../../types/index.js';
import { experienceOf, type ExperienceListRow } from './experienceAnswerRows.js';
import { withDangerFields } from './experienceDanger.js';
import { buildRegionTailQueries } from './experienceTailQuery.js';

export async function getRegionTail(
  { params: { regionId }, query: q, caller }: {
    params: z.output<typeof regionIdParamSchema>;
    query: z.output<typeof regionTailQuerySchema>;
    caller: Express.User | undefined;
  },
): Promise<RegionTailResponse> {
  const { limit, offset } = q;
  const curateAs = caller?.role === 'admin' || caller?.role === 'curator' ? caller.role : undefined;
  const { query, countQuery, params, countParams } = buildRegionTailQueries({
    regionId,
    includeChildren: q.includeChildren !== 'false',
    kindId: q.kindId ?? null,
    limit,
    offset,
    userId: caller?.id,
    curateAs,
  });
  const [rows, count] = await Promise.all([
    pool.query(query, params),
    pool.query<{ total: number }>(countQuery, countParams),
  ]);
  return {
    experiences: rows.rows.map(row => experienceOf(withDangerFields(row) as ExperienceListRow)),
    total: count.rows[0].total,
    limit,
    offset,
  };
}
