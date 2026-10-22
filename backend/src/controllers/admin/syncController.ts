/**
 * Admin Sync Controller
 *
 * Handles sync operations for experience sources (UNESCO, etc.)
 */

import { operationAnswer } from '../../services/operationProgress.js';
import { SUBSET_READY_SOURCES, wikidataReaderOf, type WikidataReader } from '../../services/sync/subset/reader.js';
import { mergeArrivalsOfRun } from '../experience/equalItemMerges.js';
import { proposeMergesOfRun } from '../../services/sync/mergeProposalFinder.js';
import type { z } from 'zod/v4';
import type {
  AssignmentCancelled,
  AssignmentStarted,
  AssignmentStatus,
  ExperienceSources,
  ComponentItemSearchStarted,
  PictureRepairStarted,
  PlacementCounts,
  SourcesReordered,
  SyncCancelled,
  SyncChanges,
  SyncLogDetail,
  SyncLogs,
  SyncStarted,
  SyncStatus,
  WikidataCache,
  WikidataCacheCleared,
  WikidataCacheTtlSet,
} from '../../api/responses/admin.js';
import type { ExperienceSourcesRow, WorldViewsRow } from '../../db/schema.generated.js';
import {
  experienceSourceOf,
  syncChangeOf,
  syncLogDetailOf,
  syncLogOf,
  type SourceRow,
  type SyncChangeRow,
  type SyncLogRow,
} from './syncAnswerRows.js';
import { isTerminalSyncStatus, type SyncRunOptions } from '../../services/sync/types.js';
import { heldRunStatusOf, idleStatusOf, rowRunStatusOf } from './syncStatusAnswer.js';
import { CHANGESET_LOST_MARKER, stoppedByRestartSql } from '../../services/sync/syncLogMarkers.js';
import { readLatestSyncLog } from '../../services/sync/syncUtils.js';
import { findUnescoComponentItems } from '../../services/sync/componentItemJob.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { waitingCountsBySource } from '../experience/waitingCounts.js';
import {
  syncUnescoSites,
  syncMuseums,
  fixMuseumImages,
  fixUnescoImages,
  syncPlacePass,
  fixWorshipImages,
  syncArchaeology,
  fixArchaeologyImages,
  runningSyncs,
  getSyncStatus as getServiceSyncStatus,
  cancelSync as cancelServiceSync,
  assignExperiencesToRegions,
  getAssignmentStatus,
  cancelAssignment,
  getExperienceCountsByRegion,
} from '../../services/sync/index.js';
import { badRequest, createError, notFound } from '../../middleware/errorHandler.js';
import type {
  cacheKindParamSchema, cacheTtlBodySchema, clearCacheQuerySchema, experienceCountsQuerySchema, logIdParamSchema,
  findComponentItemsQuerySchema, regionAssignmentStatusQuerySchema, reorderSourcesBodySchema, sourceIdParamSchema, startRegionAssignmentBodySchema,
  startSyncBodySchema, syncChangesQuerySchema, syncLogsQuerySchema,
} from '../../types/index.js';
import {
  cacheSummary, cachedKindsFor, clearCache, setCacheTtl, CACHED_KINDS_BY_SOURCE, type CacheKind,
} from '../../services/sync/wikidataCache.js';
import { latestSubset } from '../../services/dumps/wikidata/subsetTables.js';
import { passOf } from '../../services/sync/passes.js';
import { passIsRunning } from '../../services/sync/syncPass.js';

const UNESCO_SOURCE_ID = 1;
const MUSEUM_SOURCE_ID = 2;
const WORSHIP_SOURCE_ID = 4;
const ARCHAEOLOGY_SOURCE_ID = 5;

/**
 * Which sources a picture repair can be started for, and what it runs.
 *
 * A registry rather than two comparisons, for the reason `syncRegistry` is one:
 * the panel has to be able to ask the same question the route answers, and a
 * button offered where the route says 400 is a button that does nothing.
 */
const PICTURE_REPAIRS: Record<number, (triggeredBy: number | null) => Promise<void>> = {
  [UNESCO_SOURCE_ID]: fixUnescoImages,
  [MUSEUM_SOURCE_ID]: fixMuseumImages,
  [WORSHIP_SOURCE_ID]: fixWorshipImages,
  [ARCHAEOLOGY_SOURCE_ID]: fixArchaeologyImages,
};

/**
 * Which sources the panel can search Wikidata for their components' items
 * (#1272): the one whose objects are serial, with components a reference names.
 */
const COMPONENT_ITEM_SEARCHES: Record<number, typeof findUnescoComponentItems> = {
  [UNESCO_SOURCE_ID]: findUnescoComponentItems,
};

/** Registry mapping source IDs to their sync functions */
const syncRegistry: Record<
  number,
  (triggeredBy: number | null, options: SyncRunOptions) => Promise<void>
> = {
  1: syncUnescoSites,
  2: syncMuseums,
  // The place pass (ADR-0132, #1820): a start of any of them runs them all.
  3: syncPlacePass,
  6: syncPlacePass,
  4: syncPlacePass,
  5: syncArchaeology,
};

/**
 * Start sync for a source
 * POST /api/admin/sync/sources/:sourceId/start
 */
type SourceParams = z.output<typeof sourceIdParamSchema>;

/**
 * Refuse a start of a pass one of whose sources it would run wrongly. The pass
 * runs every source of it, so one switched off would run anyway. And the
 * gather reads its places through the first source's Wikidata reader while
 * the rest of each run reads through its own (#1820): a pass whose sources
 * read different copies would mix two dates of Wikidata in one run.
 */
function refuseAPassItCannotRun(
  pass: readonly number[],
  members: Pick<ExperienceSourcesRow, 'id' | 'name' | 'is_active' | 'wikidata_reader'>[],
): void {
  if (pass.length < 2) return;
  const off = members.filter((row) => !row.is_active).map((row) => row.name);
  if (off.length) {
    throw badRequest(`${off.join(' and ')} runs in one pass with this source and is not active`);
  }
  if (new Set(members.map((row) => row.wikidata_reader)).size > 1) {
    const readers = members.map((row) => `${row.name}: ${row.wikidata_reader === 'subset' ? 'local subset' : 'live service'}`);
    throw badRequest(
      `The sources of this pass read different copies of Wikidata (${readers.join(', ')}). `
      + 'Switch them to the same one: the pass reads its places through the first and the rest of each run through its own.',
    );
  }
}

export async function startSync(
  { params: { sourceId }, body, caller }: {
    params: SourceParams; body: z.output<typeof startSyncBodySchema>; caller: Express.User;
  },
): Promise<SyncStarted> {

  // The source and every source it runs with in one pass (ADR-0132).
  const pass = passOf(sourceId);
  const members = await pool.query<Pick<ExperienceSourcesRow, 'id' | 'name' | 'is_active' | 'wikidata_reader'>>(
    'SELECT id, name, is_active, wikidata_reader FROM experience_sources WHERE id = ANY($1::int[])',
    [[...pass]]
  );
  const source = members.rows.find((row) => row.id === sourceId);
  if (!source) throw notFound('Source not found');
  if (!source.is_active) throw badRequest('Source is not active');
  refuseAPassItCannotRun(pass, members.rows);

  // A source that shares a gather starts its whole pass, so the start is
  // refused while any source of the pass is running.
  if (passIsRunning(pass)) {
    throw createError(
      pass.length > 1 ? 'Sync already in progress for this source or one it runs with' : 'Sync already in progress for this source',
      409,
    );
  }

  const triggeredBy = caller.id;

  const dryRun = body.dryRun === true;
  // Asked for per run rather than configured per source: the reason to ignore
  // the cache is always about *this* attempt — the source published something a
  // moment ago, or a cached answer is suspected of being wrong.
  const refreshCache = body.refreshCache === true;
  // Asked for when a rule has changed (#1370): every pin the run disagrees with
  // becomes a question, not only the ones whose reason moved.
  const askAboutPins = body.askAboutPins === true;

  // Start sync based on source type
  const syncFn = syncRegistry[sourceId];
  if (!syncFn) throw badRequest(`Sync not implemented for source: ${source.name}`);

  syncFn(triggeredBy, { dryRun, refreshCache, askAboutPins })
    .catch((err) => {
      console.error('[Sync Controller] Sync error for source %s:', sourceId, err);
    })
    // A place the run created that another source already holds as the same
    // Wikidata item is that place (ADR-0046 decision 2, #1247), merged once
    // the run is over — here rather than inside it, since the merge is a
    // curation write the sync layer sits below. However the run ended: a run
    // cancelled or failed half-way still wrote the places it created and
    // recorded them, and a merge on one item is right whatever the run's
    // status. The run's progress is still the source's entry: nothing else
    // starts before this callback runs, and a pass holds every one of its
    // sources' entries until its last run ends (`runSyncPass`). Every run of a
    // pass wrote its own places, so each of their logs is merged.
    .then(async () => {
      // Every entry read before the first merge: a merge has no time limit,
      // and meanwhile the pass's release timers run out and, every entry being
      // closed, a new start may replace one.
      const runs = pass.map((id) => runningSyncs.get(id));
      for (const run of runs) {
        if (!run || run.dryRun || !run.logId) continue;
        await mergeArrivalsOfRun(run.logId);
        // Then the places it created that a reader can see are paired with near
        // places of similar names, as the admin's pass would pair them (#1800).
        await proposeMergesOfRun(run.logId);
      }
    });

  return {
    started: true,
    sourceId,
    sourceName: source.name,
    dryRun,
    refreshCache,
    askAboutPins,
    message: buildStartMessage({ dryRun, refreshCache, askAboutPins }),
  };
}

function buildStartMessage(mode: { dryRun: boolean; refreshCache: boolean; askAboutPins: boolean }): string {
  // The cache half is said second and always, because it changes how long the
  // run takes rather than what it writes: a curator who asked for fresh answers
  // and sees the usual quarter-hour should know the two are connected.
  const cache = mode.refreshCache
    ? ' Cached answers from the source are ignored, so the collection runs at full length.'
    : '';
  const pins = mode.askAboutPins
    ? ' Every pinned row the run disagrees with is asked about again.'
    : '';
  if (mode.dryRun) {
    return `Dry run started: the changeset will be recorded, experiences will not be written.${cache}${mode.askAboutPins ? ' The pins it would ask about again are counted, not asked.' : ''}`;
  }
  return `Sync started. Poll /status endpoint for progress.${cache}${pins}`;
}

/**
 * What answers we are keeping from the source, and how old they are.
 * GET /api/admin/sync/sources/:sourceId/cache
 *
 * With which Wikidata the source's runs read, and, for the subset, the dump
 * it was built from: that is where a switched source's Wikidata answers come
 * from instead of the cache (ADR-0119).
 */
export async function getWikidataCache({ params: { sourceId } }: { params: SourceParams }): Promise<WikidataCache> {
  const reader = await wikidataReaderOf(sourceId);
  const subsetDumpDate = reader === 'subset' ? (await latestSubset())?.dumpDate ?? null : null;
  return { reader, subsetDumpDate, kinds: await cacheSummary(sourceId, reader) };
}

/**
 * Forget them — all, or one kind.
 * DELETE /api/admin/sync/sources/:sourceId/cache?kind=classes
 *
 * A delete rather than an expiry stamp: an admin pressing this means "ask the
 * source again", and a row marked expired reads the same as one that aged out.
 */
export async function clearWikidataCache(
  { params: { sourceId }, query: { kind } }: { params: SourceParams; query: z.output<typeof clearCacheQuerySchema> },
): Promise<WikidataCacheCleared> {
  const removed = await clearCache(sourceId, kind);
  return { removed, kind: kind ?? null };
}

/**
 * Change how long one kind stays fresh.
 * PUT /api/admin/sync/sources/:sourceId/cache/:kind/ttl  { hours }
 *
 * Answers with how many kept answers were re-stamped, because that is the part
 * an admin cannot predict: shortening a lifetime can expire everything of that
 * kind at once, and the number says whether the next run re-fetches five things
 * or five hundred.
 */
export async function setWikidataCacheTtl(
  { params: { sourceId, kind }, body: { hours } }: {
    params: z.output<typeof cacheKindParamSchema>; body: z.output<typeof cacheTtlBodySchema>;
  },
): Promise<WikidataCacheTtlSet> {

  // The hours are already bounded by Zod (a minute to a month), but the kind is
  // any string the schema's length allows. An unknown one would write a policy
  // row no collector ever reads — a lifetime in the table, nothing obeying it,
  // and a panel that never shows it because the panel lists the kinds a source
  // declares rather than the rows that exist. Refused by name, so the caller
  // learns which kinds this source actually has.
  const declared = CACHED_KINDS_BY_SOURCE[sourceId] ?? [];
  if (!declared.includes(kind as CacheKind)) {
    throw badRequest(declared.length === 0
      ? 'This source caches nothing, so it has no lifetimes to set'
      : `Unknown cache kind "${kind}". This source caches: ${declared.join(', ')}`);
  }

  const { restamped } = await setCacheTtl(sourceId, kind, Math.round(hours * 60 * 60 * 1000));
  return { kind, hours, restamped };
}

/**
 * Get sync status for a source
 * GET /api/admin/sync/sources/:sourceId/status
 */
export async function getSyncStatus({ params: { sourceId } }: { params: SourceParams }): Promise<SyncStatus> {
  // The run this process holds answers first: it is the one a cancel reaches.
  const status = getServiceSyncStatus(sourceId);
  if (status) return heldRunStatusOf(status);

  const source = await pool.query<Pick<ExperienceSourcesRow, 'last_sync_at' | 'last_sync_status'>>(
    'SELECT last_sync_at, last_sync_status FROM experience_sources WHERE id = $1',
    [sourceId]
  );
  if (source.rows.length === 0) throw notFound('Source not found');

  // Then the rows (#1131): a run another process holds, or the last one, with
  // how far it got when a restart stopped it.
  const latest = await readLatestSyncLog(sourceId);
  if (latest?.status === 'running') return rowRunStatusOf(latest);
  return idleStatusOf(source.rows[0], latest);
}

/**
 * Cancel sync for a source
 * POST /api/admin/sync/sources/:sourceId/cancel
 */
export async function cancelSync({ params: { sourceId } }: { params: SourceParams }): Promise<SyncCancelled> {

  const source = await pool.query(
    'SELECT id FROM experience_sources WHERE id = $1',
    [sourceId]
  );
  if (source.rows.length === 0) throw notFound('Source not found');

  const cancelled = cancelServiceSync(sourceId);
  return { cancelled };
}

/**
 * Fix missing images for a source
 * POST /api/admin/sync/sources/:sourceId/fix-images
 *
 * Two sources answer it, and they answer different questions. For museums it is
 * a picture that was never found; for World Heritage sites it is a picture that
 * was found and may not be shown — the World Heritage Centre's own photographs,
 * which its terms do not license to this product, replaced from Commons or taken
 * away (ADR-0043, #557). Both write now rather than proposing: a repair of the
 * catalogue is an operator's decision, and under a gated source a proposal
 * would be a thousand cards nobody asked for.
 */
export async function fixImages(
  { params: { sourceId }, caller }: { params: SourceParams; caller: Express.User },
): Promise<PictureRepairStarted> {
  await startBesideSync(sourceId, caller.id, PICTURE_REPAIRS[sourceId], 'Fix images');
  return { started: true, message: 'Fixing pictures. Poll /status endpoint for progress.' };
}

/**
 * Search Wikidata for the items of a source's components that no item records
 * the reference of, and propose each to a curator (#1272) — for every site, or
 * for the one `experienceId` names (#1429), which has to be one of the source's
 * own sites.
 * POST /api/admin/sync/sources/:sourceId/find-component-items[?experienceId=]
 */
export async function findComponentItems(
  { params: { sourceId }, query: { experienceId }, caller }: {
    params: SourceParams; query: z.output<typeof findComponentItemsQuerySchema>; caller: Express.User;
  },
): Promise<ComponentItemSearchStarted> {
  const search = COMPONENT_ITEM_SEARCHES[sourceId];
  let site: { id: number; name: string } | undefined;
  // Asked after the source's own doors, so a site sent to a source that does
  // not exist or does not search is told that, not that the site is unknown.
  const siteOf = async () => {
    if (experienceId === undefined) return;
    const found = await pool.query<{ id: number; name: string }>(
      `SELECT e.id, e.name FROM experiences e
        WHERE e.id = $1 AND EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = e.id AND m.source_id = $2)`,
      [experienceId, sourceId],
    );
    if (!found.rows[0]) throw notFound('No site of this source has that id');
    site = found.rows[0];
  };
  await startBesideSync(
    sourceId, caller.id, search && ((triggeredBy) => search(triggeredBy, site)), 'Find component items', siteOf,
  );
  return {
    started: true,
    message: site
      ? `Searching for the component items of ${site.name}. Poll /status endpoint for progress.`
      : 'Searching for component items. Poll /status endpoint for progress.',
  };
}

/**
 * Starts a job that reports through a source's sync status, after the three
 * doors `startSync` stands at, in its order: a source that does not exist, one
 * switched off, and a run already in flight. The job refuses that last case
 * itself — by throwing before it registers — but a throw lands in the catch
 * below after the handler has already answered, so without this check a press
 * during a sync got `started: true`, the panel followed the *sync*, and it ended
 * in a sync's sentence with nothing done and nothing saying so.
 */
async function startBesideSync(
  sourceId: number,
  triggeredBy: number,
  job: ((triggeredBy: number | null) => Promise<void>) | undefined,
  name: string,
  /** A check of the job's own, asked once the source's doors have let it through. */
  beforeStart?: () => Promise<void>,
): Promise<void> {
  const source = await pool.query(
    'SELECT id, is_active FROM experience_sources WHERE id = $1',
    [sourceId],
  );
  if (source.rows.length === 0) throw notFound('Source not found');
  if (!source.rows[0].is_active) throw badRequest('Source is not active');
  if (!job) throw badRequest(`${name} is not implemented for this source`);
  // Before the in-flight check, never between it and the job: the job registers
  // in the same tick as the check, so a second press cannot pass it meanwhile.
  await beforeStart?.();
  const existing = runningSyncs.get(sourceId);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    throw createError('Sync already in progress for this source', 409);
  }

  job(triggeredBy).catch((err) => {
    console.error('[Sync Controller] %s error for source %s:', name, sourceId, err);
  });
}

/**
 * A run's columns as both log reads select them.
 *
 * The counters are read through `COALESCE(…, 0)`: every writer sets them and
 * the columns default to 0, so they are nullable only because the schema never
 * said NOT NULL, and a null would be a count of nothing rather than a count
 * nobody took.
 */
const SYNC_LOG_COLUMNS_SQL = `
      l.id,
      l.source_id,
      s.name as source_name,
      l.started_at,
      l.completed_at,
      l.status,
      COALESCE(l.total_fetched, 0) AS total_fetched,
      COALESCE(l.total_created, 0) AS total_created,
      COALESCE(l.total_updated, 0) AS total_updated,
      COALESCE(l.total_unchanged, 0) AS total_unchanged,
      COALESCE(l.total_missing, 0) AS total_missing,
      COALESCE(l.total_curated_conflicts, 0) AS total_curated_conflicts,
      COALESCE(l.total_held, 0) AS total_held,
      COALESCE(l.total_filtered, 0) AS total_filtered,
      COALESCE(l.total_errors, 0) AS total_errors,
      l.is_dry_run,
      l.detection_skipped_reason,
      l.withdrawal_skipped_reason,
      l.admission_sweep_skipped_reason,
      l.triggered_by,
      u.display_name as triggered_by_name,
      -- A run from before change provenance: its total_updated counted every
      -- row the upsert touched, so it is not comparable with later ones. After
      -- slice 1 any run that changed something also wrote a changeset, so the
      -- absence of one alongside a non-zero count is the marker -- unless the
      -- changeset insert threw, which is the next column.
      EXISTS (SELECT 1 FROM experience_sync_changes c WHERE c.sync_log_id = l.id) AS has_changeset,
      -- The changeset insert threw, so the record is missing or short: it goes
      -- in batches with no transaction around them. Read from the marker the
      -- orchestrator leaves, because has_changeset alone cannot tell a lost
      -- record from an old run, nor a partial landing from a whole one.
      COALESCE(l.error_details @> '[${JSON.stringify(CHANGESET_LOST_MARKER)}]', FALSE) AS changeset_lost,
      -- The startup sweep closed the run: the server was restarted under it,
      -- so its counters are how far it got and its changeset never left
      -- memory, which has_changeset alone would read as a run from before
      -- change provenance.
      ${stoppedByRestartSql('l')} AS stopped_by_restart,
      -- The pass this run was part of (ADR-0132), named by its first run's
      -- source; ps is joined through SYNC_LOG_PASS_JOIN_SQL.
      l.pass_log_id,
      ps.name AS pass_source_name
`;

/** The first run of a log's pass and its source, for `SYNC_LOG_COLUMNS_SQL`. */
const SYNC_LOG_PASS_JOIN_SQL = `
    LEFT JOIN experience_sync_logs p ON p.id = l.pass_log_id
    LEFT JOIN experience_sources ps ON ps.id = p.source_id
`;

/**
 * Get sync history/logs
 * GET /api/admin/sync/logs
 */
export async function getSyncLogs(
  { query: { sourceId, limit, offset } }: { query: z.output<typeof syncLogsQuerySchema> },
): Promise<SyncLogs> {

  let query = `
    SELECT ${SYNC_LOG_COLUMNS_SQL}
    FROM experience_sync_logs l
    JOIN experience_sources s ON l.source_id = s.id
    LEFT JOIN users u ON l.triggered_by = u.id
    ${SYNC_LOG_PASS_JOIN_SQL}
  `;

  const params: (number | string)[] = [];
  let paramIndex = 1;

  if (sourceId) {
    query += ` WHERE l.source_id = $${paramIndex++}`;
    params.push(sourceId);
  }

  // A pass reads as one run: newest pass first, its runs in the order they ran.
  query += ` ORDER BY COALESCE(p.started_at, l.started_at) DESC, COALESCE(l.pass_log_id, l.id) DESC, l.started_at ASC`
    + ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query<SyncLogRow>(query, params);

  // Get total count
  let countQuery = 'SELECT COUNT(*) FROM experience_sync_logs';
  const countParams: number[] = [];
  if (sourceId) {
    countQuery += ' WHERE source_id = $1';
    countParams.push(sourceId);
  }
  const countResult = await pool.query(countQuery, countParams);

  return {
    logs: result.rows.map(syncLogOf),
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  };
}

/**
 * Get single sync log with error details
 * GET /api/admin/sync/logs/:logId
 */
type LogParams = z.output<typeof logIdParamSchema>;

export async function getSyncLogDetails({ params: { logId } }: { params: LogParams }): Promise<SyncLogDetail> {

  const result = await pool.query<SyncLogRow & { error_details: unknown; component_items: unknown }>(
    `SELECT ${SYNC_LOG_COLUMNS_SQL}, l.error_details, l.component_items
     FROM experience_sync_logs l
     JOIN experience_sources s ON l.source_id = s.id
     LEFT JOIN users u ON l.triggered_by = u.id
     ${SYNC_LOG_PASS_JOIN_SQL}
     WHERE l.id = $1`,
    [logId]
  );

  if (result.rows.length === 0) throw notFound('Sync log not found');

  return syncLogDetailOf(result.rows[0]);
}

/**
 * List what a run did, object by object.
 * GET /api/admin/sync/logs/:logId/changes
 *
 * Rows that came through unchanged are not here — they are a count on the log.
 * Ordering puts the significant ones first, since that is what a reviewer came
 * for.
 */
export async function getSyncLogChanges(
  { params: { logId }, query: { type, significance, significantOnly, limit, offset } }: {
    params: LogParams; query: z.output<typeof syncChangesQuerySchema>;
  },
): Promise<SyncChanges> {

  const conditions = ['sync_log_id = $1'];
  const params: unknown[] = [logId];

  if (type) {
    params.push(type);
    conditions.push(`change_type = $${params.length}`);
  }
  if (significance) {
    params.push(significance);
    conditions.push(`significance = $${params.length}`);
  }
  // "Significant" means "worth a reviewer's attention", which is not the same as
  // significance = 'major': created, missing, returned, conflict, contents and failed
  // rows carry no significance at all — `changeSet.ts` leaves it null when nothing was
  // weighed, and a contents row is the clearest case, since what moved was not a field
  // — and hiding them would empty the view of
  // everything a run is actually reporting. What drops out is a minor field edit that
  // moved nothing else.
  //
  // A contents delta is not a field edit and `significance` never weighs one
  // (`changeSet.ts` weighs `changedFields`, `curatedConflicts` and `heldFields`), so
  // without the third term a row is dropped exactly when a component arrived *beside*
  // a minor edit — UNESCO 1239 gaining Waldsiedlung Zehlendorf in a run that also
  // rewrote its `nameLocal.en` — and that row is the only record anywhere that the
  // component arrived (ADR-0026).
  //
  // The fourth term is the same shape for a curator's claim (#516). A row where the
  // source ran into one is `conflict` only when nothing else on it moved; when the
  // run also applied an ordinary edit it is `updated`, and `significance` weighs the
  // refused field like any other — so a claimed `metadata.website` or
  // `description` beside an applied `nameLocal.en` computes 'minor' and the first
  // three terms drop it. That row is the one in the run where a machine and a person
  // disagreed, which is exactly what an admin opens the report to find. The
  // containment test is the idiom the queue and the two verdict endpoints already
  // read the stored field with.
  if (significantOnly === 'true') {
    conditions.push(
      `(significance = 'major' OR change_type <> 'updated' OR contents IS NOT NULL`
      + ` OR changed_fields @> '[{"curatedConflict": true}]')`,
    );
  }
  // Assembled from literal fragments only; every value travels as a parameter.
  const where = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM experience_sync_changes WHERE ${where}`,
    params
  );

  const rowsResult = await pool.query<SyncChangeRow>(
    // `contents` travels with the rest: a `contents` row carries no `changed_fields`
    // at all — every field of the object came through — so without this column the
    // report would name an object and give no reason it is in the list (ADR-0026).
    `SELECT id, experience_id, external_id, name_snapshot, change_type,
            changed_fields, contents, significance, error
     FROM experience_sync_changes
     WHERE ${where}
     ORDER BY CASE
                WHEN significance = 'major' THEN 0
                WHEN change_type <> 'updated' THEN 1
                -- Beside the other kinds a reviewer came for, not with the routine
                -- edits: a contents delta is the row's news, and under
                -- significantOnly it is the only reason the row is in the list at all.
                WHEN contents IS NOT NULL THEN 1
                -- Likewise a refused claim on an otherwise routine edit: beside the
                -- conflict rows, since it is one (#516).
                WHEN changed_fields @> '[{"curatedConflict": true}]' THEN 1
                ELSE 2
              END, change_type, external_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    changes: rowsResult.rows.map(syncChangeOf),
    total: Number(countResult.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

/**
 * List all experience sources with assignment status
 * GET /api/admin/sync/sources
 *
 * Reports each source's curation gate and what it is holding; the switch that *writes*
 * the gate is `curationGateController.ts`, because this file is about starting, watching
 * and cancelling runs while that is about what a run is allowed to show.
 */
export async function getSources(): Promise<ExperienceSources> {
  // Get sources
  const sourcesResult = await pool.query<SourceRow>(`
    SELECT
      id,
      name,
      description,
      is_active,
      requires_curation,
      wikidata_reader,
      last_sync_at,
      last_sync_status,
      display_priority,
      created_at,
      (api_config->>'enterSitelinks')::int AS enter_sitelinks,
      (api_config->>'staySitelinks')::int AS stay_sitelinks,
      -- The second door's pair, and NULL for the sources that have one door.
      -- Archaeology admits both the site a traveller stands on and the famous
      -- find a museum holds, and a find is written up in fewer languages than
      -- its museum, so its row carries a lower finds line beside the main one
      -- (ADR-0058 decision 5). This is the only way the panel can tell that a
      -- source has a finds line at all: without it an admin can move the line
      -- a run reads for the museums and not the one it reads for the finds.
      (api_config->>'findEnterSitelinks')::int AS find_enter_sitelinks,
      (api_config->>'findStaySitelinks')::int AS find_stay_sitelinks
    FROM experience_sources
    WHERE is_active = true
    ORDER BY display_priority, id
  `);

  // What each source is holding, in the three kinds the review queue asks about
  // (ADR-0025). Sent with the list rather than fetched per source: the panel's
  // question is "which of these needs a person", and one number per row arriving
  // after the rows would render as an empty state that fills in.
  //
  // Zero for every source on the database as it stands today, since no gate has ever
  // been switched on. Not a rule, and the difference matters here more than anywhere:
  // none of the three predicates reads `requires_curation`, so a source gated, left to
  // accumulate and then un-gated has a false flag and a real backlog — the state this
  // whole feature is built around, and the one `publish-waiting` exists to clear. A
  // reader who took the flag as a licence and skipped this call for ungated sources
  // would zero that backlog on the one screen that reports it.
  //
  // In its own `try`, and the asymmetry is the same one `publishWaitingController`
  // argues: the counts are this endpoint's addition, the sources list is what it is
  // for. This aggregate walks every row of `experiences` with three `EXISTS` filters,
  // one of them a `LATERAL` into a run's changeset — a lock, a pool error or a slow
  // scan on a grown catalogue is enough. A throw here rejects `getSources`
  // entirely, and the panel that reads it destructures only `data`: no sources, no
  // Start Sync, no Cancel and no message saying why, on all three screens that share
  // the query. `null` costs three numbers and says so; the alternative cost the
  // screen.
  let waiting: Awaited<ReturnType<typeof waitingCountsBySource>> | null = null;
  try {
    waiting = await waitingCountsBySource();
  } catch (error) {
    console.error('[sync/sources] waiting counts failed:', error);
  }

  // No `assignment_needed` flag any more, and no `last_assignment_at` either.
  //
  // The flag meant "a sync happened after the last full re-assignment", which
  // stopped being a question a sync can leave open: the run places what moved
  // before it finishes. Kept as a computed field it would have been permanently
  // true — a full rebuild is now only for changed region geometry, so nothing a
  // sync does could ever satisfy it.
  //
  // `last_assignment_at` went with it rather than being kept in the response: it
  // existed to feed that comparison and no client ever read it on its own. The
  // column is still written by `assignExperiencesToRegions` and still available
  // to whatever wants it later.
  return sourcesResult.rows.map(source => experienceSourceOf(source, {
    // Three zeros for a source the aggregate returned no row for — it groups, so a
    // source with nothing waiting is absent rather than zero — but `null` when the
    // aggregate itself did not answer. A zero there would be a claim about the source
    // that nothing checked, which is the same reason `heldLeftForReview` is nullable.
    waiting: waiting === null
      ? null
      : waiting.get(source.id) ?? { arrivals: 0, held: 0, contents: 0 },
    // Whether this source keeps anything between runs, which decides whether
    // "Sync without cache" is a real offer. The Wikidata collectors
    // describe their questions (ADR-0030 decision 4); the UNESCO run reads
    // its own API and does not, and a source that reads the local subset
    // keeps only what it still asks live (ADR-0119). On either, that button
    // would promise to bypass something that does not exist — the same
    // pretence the cache panel below it refuses to make.
    caches: cachedKindsFor(source.id, source.wikidata_reader as WikidataReader).length > 0,
    // Whether this source's pictures can be repaired from here, read from the
    // same registry the route answers from — the museums' missing pictures, and
    // the World Heritage ones the Centre's terms do not let us show (ADR-0043).
    repairsPictures: source.id in PICTURE_REPAIRS,
    findsComponentItems: source.id in COMPONENT_ITEM_SEARCHES,
    // Whether every question this source asks has a twin in the local subset,
    // which decides whether its runs may be switched to read it (#1459).
    subsetReady: SUBSET_READY_SOURCES.has(source.id),
    // The pass a start of this one runs, from the same registry the start
    // reads (ADR-0132), so the panel draws the pass as the one run it is.
    pass: passOf(source.id).length > 1 ? [...passOf(source.id)] : [],
  }));
}

// =============================================================================
// Region Assignment Endpoints
// =============================================================================

/**
 * Start region assignment for a world view
 * POST /api/admin/experiences/assign-regions
 */
export async function startRegionAssignment(
  { body: { worldViewId, sourceId } }: { body: z.output<typeof startRegionAssignmentBodySchema> },
): Promise<AssignmentStarted> {

  // Validate world view exists
  const worldView = await pool.query<Pick<WorldViewsRow, 'id' | 'name'>>(
    'SELECT id, name FROM world_views WHERE id = $1',
    [worldViewId]
  );

  if (worldView.rows.length === 0) throw notFound('World view not found');

  // Start assignment in background
  assignExperiencesToRegions(worldViewId, sourceId).catch((err) => {
    console.error('[Sync Controller] Region assignment error:', err);
  });

  return {
    started: true,
    worldViewId,
    worldViewName: worldView.rows[0].name,
    sourceId: sourceId || null,
    message: 'Region assignment started. Poll /status endpoint for progress.',
  };
}

/**
 * Get region assignment status
 * GET /api/admin/experiences/assign-regions/status
 */
export async function getRegionAssignmentStatus(
  { query: { worldViewId } }: { query: z.output<typeof regionAssignmentStatusQuerySchema> },
): Promise<AssignmentStatus> {
  const status = getAssignmentStatus(worldViewId);
  if (!status) return { running: false };

  const isRunning = !isTerminalSyncStatus(status.status);

  return {
    running: isRunning,
    status: status.status,
    statusMessage: status.statusMessage,
    directAssignments: status.directAssignments,
    ancestorAssignments: status.ancestorAssignments,
    totalAssignments: status.directAssignments + status.ancestorAssignments,
    errors: status.errors,
    operation: operationAnswer(status.operation.progress),
  };
}

/**
 * Cancel region assignment
 * POST /api/admin/experiences/assign-regions/cancel
 */
export async function cancelRegionAssignment(
  { body: { worldViewId } }: { body: z.output<typeof startRegionAssignmentBodySchema> },
): Promise<AssignmentCancelled> {
  const cancelled = cancelAssignment(worldViewId);
  return { cancelled };
}

/**
 * Get experience counts by region
 * GET /api/admin/experiences/counts-by-region
 */
export async function getExperienceCounts(
  { query: { worldViewId, sourceId } }: { query: z.output<typeof experienceCountsQuerySchema> },
): Promise<PlacementCounts> {
  return getExperienceCountsByRegion(worldViewId, sourceId);
}

/**
 * Reorder experience sources (set display_priority)
 * PUT /api/admin/sync/sources/reorder
 * Body: { sourceIds: [1, 3, 2] }  -- array of source IDs in desired order
 */
export async function reorderSources(
  { body: { sourceIds } }: { body: z.output<typeof reorderSourcesBodySchema> },
): Promise<SourcesReordered> {

  // One client, not pool.query('BEGIN') — see the note in curationEditController:
  // pg.Pool hands out an arbitrary idle client per call, so a transaction has
  // to be pinned or its statements land on different connections. The order is
  // written one row at a time, so a half-applied run leaves two sources sharing
  // a display_priority and one with none.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < sourceIds.length; i++) {
      await client.query(
        'UPDATE experience_sources SET display_priority = $1 WHERE id = $2',
        [i + 1, sourceIds[i]]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw err;
  } finally {
    client.release(unusable);
  }

  return { success: true, order: sourceIds };
}
