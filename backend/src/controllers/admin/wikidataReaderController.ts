/**
 * Which Wikidata a source's runs read (#1459, #1439): the live query service,
 * or the local subset built from the entities dump (ADR-0105). Its own file
 * beside the other source settings (the gate, the line), since it changes
 * where a run's answers come from rather than what a run may show.
 */

import type { z } from 'zod/v4';
import { pool } from '../../db/index.js';
import type { WikidataReaderSet } from '../../api/responses/admin.js';
import type { ExperienceSourcesRow } from '../../db/schema.generated.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { SUBSET_READY_SOURCES } from '../../services/sync/subset/reader.js';
import type { sourceIdParamSchema, wikidataReaderBodySchema } from '../../types/index.js';

/**
 * PUT /api/admin/sync/sources/:sourceId/wikidata-reader
 *
 * The subset is offered only for a source every question of which has a twin
 * (`SUBSET_READY_SOURCES`): a run that read some answers from the subset and
 * the rest from the live service would mix two dates of Wikidata, and the
 * run's door refuses a question with no twin anyway. Whether the subset is
 * built is the run's to check when it starts, where it can say so.
 */
export async function setWikidataReader(
  { params: { sourceId }, body: { reader }, caller }: {
    params: z.output<typeof sourceIdParamSchema>;
    body: z.output<typeof wikidataReaderBodySchema>;
    caller: Express.User;
  },
): Promise<WikidataReaderSet> {
  if (reader === 'subset' && !SUBSET_READY_SOURCES.has(sourceId)) {
    throw createError('This source still asks questions the local Wikidata subset has no answer for', 409);
  }
  const result = await pool.query<Pick<ExperienceSourcesRow, 'id' | 'name' | 'wikidata_reader'>>(
    `UPDATE experience_sources SET wikidata_reader = $1 WHERE id = $2 AND is_active RETURNING id, name, wikidata_reader`,
    [reader, sourceId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Source');
  // The audit of a source setting, as the gate and the line keep theirs: there is no per-source audit table.
  console.log('[wikidata-reader] %s (%s) -> %s by user %s', row.name, row.id, row.wikidata_reader, caller.id);
  return { sourceId: row.id, name: row.name, wikidataReader: row.wikidata_reader as WikidataReaderSet['wikidataReader'] };
}
