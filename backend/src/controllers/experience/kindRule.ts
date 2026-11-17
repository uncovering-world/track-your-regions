/**
 * A kind's rule, read from its code and its last run (#2185): what a curator
 * deciding "Is this a tower?" opens behind ⓘ, so the rule they check is the one
 * the run applies and never a summary someone wrote of it.
 *
 * GET /api/experiences/review/kind-rule/:kindId
 *
 * - **Kept out**: what the kind's declaration refuses, in its own words, for a
 *   kind declared as data (Towers, Bridges & engineering marvels, Squares &
 *   streets); null for a kind whose rule is code of its own.
 * - **World**: the three bars the kind's last real run read off its pool
 *   (`experience_sync_logs.world_bars`, ADR-0175), with the quantiles and the
 *   stay share of `admissionRegister.ts`; null where no run read one.
 * - **Surroundings**: the surroundings tier's neighbourhood, floors and tests
 *   from the same register, with the conditions of a kind's own: Bridges'
 *   types that need a guide, Squares & streets' venue test, Archaeology's map.
 */

import type { z } from 'zod/v4';
import type { KindRule } from '../../api/responses/kindRule.js';
import { pool } from '../../db/index.js';
import { notFound } from '../../middleware/errorHandler.js';
import { BRIDGES_DECLARATION } from '../../services/sync/bridges/classes.js';
import { BRIDGES_SOURCE_ID } from '../../services/sync/bridges/source.js';
import { ARCHAEOLOGY_SOURCE_ID } from '../../services/sync/archaeology/runDoors.js';
import {
  ARCHAEOLOGY_SURROUNDINGS_REGISTER, ARCHAEOLOGY_WORLD_REGISTER, SURROUNDINGS_REGISTER, WORLD_FRAME,
} from '../../services/sync/places/admissionRegister.js';
import { keptOutOf, type PlaceKindDeclaration } from '../../services/sync/places/declaredKind.js';
import type { WorldBars } from '../../services/sync/places/worldBars.js';
import { SQUARES_DECLARATION } from '../../services/sync/squares/classes.js';
import { SQUARES_SOURCE_ID } from '../../services/sync/squares/kind.js';
import { TOWERS_DECLARATION } from '../../services/sync/towers/classes.js';
import { TOWERS_SOURCE_ID } from '../../services/sync/towers/kind.js';
import type { kindRuleParamSchema } from '../../types/kindRuleSchema.js';

/** The kinds whose rule is a declaration, by the source that runs it. */
const DECLARED: ReadonlyMap<number, PlaceKindDeclaration<string>> = new Map<number, PlaceKindDeclaration<string>>([
  [TOWERS_SOURCE_ID, TOWERS_DECLARATION],
  [BRIDGES_SOURCE_ID, BRIDGES_DECLARATION],
  [SQUARES_SOURCE_ID, SQUARES_DECLARATION],
]);

/** The surroundings tier's lines from the register, with the conditions of a kind's own. */
function surroundingsOf(
  sources: readonly number[], declaration: PlaceKindDeclaration<string> | undefined,
): NonNullable<KindRule['surroundings']> {
  const bridges = sources.includes(BRIDGES_SOURCE_ID);
  const R = SURROUNDINGS_REGISTER;
  return {
    radiusKm: R.radiusKm.value,
    best: R.best.value,
    minLanguages: R.minLanguages.value,
    minReaders: R.minReaders.value.yieldedThen,
    guideShare: R.guideShare.value,
    guideGroupFloor: R.guideGroupFloor.value,
    editionsShare: R.editionsShare.value,
    editionsGroupFloor: R.editionsGroupFloor.value,
    readersShare: R.readersShare.value,
    readersGroupFloor: R.readersGroupFloor.value,
    // The register's types are Bridges' vocabulary: they bind that kind alone.
    guideOnlyTypes: bridges ? [...R.guideForTypes.value] : [],
    heritageTypes: bridges ? [...R.heritageForTypes.value] : [],
    venues: declaration?.venues
      ? { radiusM: R.venueRadiusM.value, share: R.venueShare.value, groupFloor: R.venueGroupFloor.value }
      : null,
    mapped: sources.includes(ARCHAEOLOGY_SOURCE_ID) && ARCHAEOLOGY_SURROUNDINGS_REGISTER.mapped.value ? {
      listedStands: ARCHAEOLOGY_SURROUNDINGS_REGISTER.listedStandsForTheMap.value,
      namedRuinWithinM: ARCHAEOLOGY_SURROUNDINGS_REGISTER.namedRuinWithinMetres.value,
    } : null,
  };
}

export async function getKindRule(
  { params: { kindId } }: { params: z.output<typeof kindRuleParamSchema> },
): Promise<KindRule> {
  // $1 the kind. The bars are the last real, closed run's that read the pool,
  // as the coverage report reads them (`reportQueries.ts`).
  const found = await pool.query<{ source_ids: number[] | null; world_bars: WorldBars | null }>(
    `SELECT (SELECT array_agg(s.id ORDER BY s.id) FROM experience_sources s
              WHERE s.kind_id = k.id AND s.is_active) AS source_ids,
            (SELECT l.world_bars
               FROM experience_sync_logs l
               JOIN experience_sources s ON s.id = l.source_id
              WHERE s.kind_id = k.id AND s.is_active
                AND NOT l.is_dry_run AND l.status IN ('success', 'partial')
                AND jsonb_typeof(l.world_bars->'editions') = 'number'
              ORDER BY l.id DESC LIMIT 1) AS world_bars
       FROM experience_kinds k
      WHERE k.id = $1`,
    [kindId],
  );
  if (found.rowCount === 0) throw notFound('Kind not found');
  const { source_ids: sourceIds, world_bars: bars } = found.rows[0];
  const sources = sourceIds ?? [];
  const declaration = sources.map((id) => DECLARED.get(id)).find(Boolean);
  const archaeology = sources.includes(ARCHAEOLOGY_SOURCE_ID);
  return {
    keptOut: declaration ? keptOutOf(declaration).map((k) => ({ ...k, unlessTypes: [...k.unlessTypes] })) : null,
    world: bars ? {
      pool: bars.pool,
      editions: bars.editions,
      editionsQuantile: WORLD_FRAME.editionsQuantile,
      readers: bars.readers ?? null,
      readersQuantile: WORLD_FRAME.readersQuantile,
      guidedReaders: bars.guidedReaders ?? null,
      guidedQuantile: WORLD_FRAME.guidedQuantile,
      year: bars.year ?? null,
      stayShare: WORLD_FRAME.stayShare,
      marks: [
        'wikivoyage' as const,
        ...(WORLD_FRAME.atlasObscura ? ['atlasObscura' as const] : []),
        ...(archaeology && ARCHAEOLOGY_WORLD_REGISTER.listedIsAMark.value ? ['worldHeritageList' as const] : []),
      ],
    } : null,
    surroundings: bars ? surroundingsOf(sources, declaration) : null,
  };
}
