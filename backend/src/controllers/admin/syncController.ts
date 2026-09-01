/**
 * Admin Sync Controller
 *
 * Handles sync operations for experience categories (UNESCO, etc.)
 */

import { Request, Response } from 'express';
import { isTerminalSyncStatus } from '../../services/sync/types.js';
import { isCancellable } from '../../services/sync/syncOrchestrator.js';
import { CHANGESET_LOST_MARKER } from '../../services/sync/syncLogMarkers.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { waitingCountsByCategory } from '../experience/waitingCounts.js';
import {
  syncUnescoSites,
  syncMuseums,
  fixMuseumImages,
  syncLandmarks,
  runningSyncs,
  getSyncStatus as getServiceSyncStatus,
  cancelSync as cancelServiceSync,
  assignExperiencesToRegions,
  getAssignmentStatus,
  cancelAssignment,
  getExperienceCountsByRegion,
} from '../../services/sync/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  cacheSummary, clearCache, setCacheTtl, CACHED_KINDS_BY_CATEGORY, type CacheKind,
} from '../../services/sync/wikidataCache.js';

const MUSEUM_CATEGORY_ID = 2;

/** Registry mapping category IDs to their sync functions */
const syncRegistry: Record<
  number,
  (triggeredBy: number | null, options: { dryRun?: boolean; refreshCache?: boolean }) => Promise<void>
> = {
  1: syncUnescoSites,
  2: syncMuseums,
  3: syncLandmarks,
};

/**
 * Start sync for a source
 * POST /api/admin/sync/categories/:categoryId/start
 */
export async function startSync(req: AuthenticatedRequest, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));

  // Validate source exists
  const source = await pool.query(
    'SELECT id, name, is_active FROM experience_categories WHERE id = $1',
    [categoryId]
  );

  if (source.rows.length === 0) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  if (!source.rows[0].is_active) {
    res.status(400).json({ error: 'Source is not active' });
    return;
  }

  // Check if already running
  const existing = runningSyncs.get(categoryId);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    res.status(409).json({ error: 'Sync already in progress for this source' });
    return;
  }

  // Get triggering user ID
  const triggeredBy = req.user?.id || null;

  const dryRun = req.body.dryRun === true;
  // Asked for per run rather than configured per source: the reason to ignore
  // the cache is always about *this* attempt — the source published something a
  // moment ago, or a cached answer is suspected of being wrong.
  const refreshCache = req.body.refreshCache === true;

  // Start sync based on source type
  const syncFn = syncRegistry[categoryId];
  if (!syncFn) {
    res.status(400).json({ error: `Sync not implemented for source: ${source.rows[0].name}` });
    return;
  }

  syncFn(triggeredBy, { dryRun, refreshCache }).catch((err) => {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- categoryId is a parseInt result, so it cannot carry a format specifier
    console.error(`[Sync Controller] Sync error for category ${categoryId}:`, err);
  });

  res.json({
    started: true,
    categoryId,
    categoryName: source.rows[0].name,
    dryRun,
    refreshCache,
    message: buildStartMessage({ dryRun, refreshCache }),
  });
}

function buildStartMessage(mode: { dryRun: boolean; refreshCache: boolean }): string {
  // The cache half is said second and always, because it changes how long the
  // run takes rather than what it writes: a curator who asked for fresh answers
  // and sees the usual quarter-hour should know the two are connected.
  const cache = mode.refreshCache
    ? ' Cached answers from the source are ignored, so the collection runs at full length.'
    : '';
  if (mode.dryRun) {
    return `Dry run started: the changeset will be recorded, experiences will not be written.${cache}`;
  }
  return `Sync started. Poll /status endpoint for progress.${cache}`;
}

/**
 * What answers we are keeping from the source, and how old they are.
 * GET /api/admin/sync/categories/:categoryId/cache
 */
export async function getWikidataCache(req: Request, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));
  res.json({ kinds: await cacheSummary(categoryId) });
}

/**
 * Forget them — all, or one kind.
 * DELETE /api/admin/sync/categories/:categoryId/cache?kind=classes
 *
 * A delete rather than an expiry stamp: an admin pressing this means "ask the
 * source again", and a row marked expired reads the same as one that aged out.
 */
export async function clearWikidataCache(req: Request, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const removed = await clearCache(categoryId, kind);
  res.json({ removed, kind: kind ?? null });
}

/**
 * Change how long one kind stays fresh.
 * PUT /api/admin/sync/categories/:categoryId/cache/:kind/ttl  { hours }
 *
 * Answers with how many kept answers were re-stamped, because that is the part
 * an admin cannot predict: shortening a lifetime can expire everything of that
 * kind at once, and the number says whether the next run re-fetches five things
 * or five hundred.
 */
export async function setWikidataCacheTtl(req: Request, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));
  const kind = String(req.params.kind);
  const hours = Number((req.body as { hours: number }).hours);

  // The hours are already bounded by Zod (a minute to a month), but the kind is
  // any string the schema's length allows. An unknown one would write a policy
  // row no collector ever reads — a lifetime in the table, nothing obeying it,
  // and a panel that never shows it because the panel lists the kinds a source
  // declares rather than the rows that exist. Refused by name, so the caller
  // learns which kinds this source actually has.
  const declared = CACHED_KINDS_BY_CATEGORY[categoryId] ?? [];
  if (!declared.includes(kind as CacheKind)) {
    res.status(400).json({
      error: declared.length === 0
        ? 'This source caches nothing, so it has no lifetimes to set'
        : `Unknown cache kind "${kind}". This source caches: ${declared.join(', ')}`,
    });
    return;
  }

  const { restamped } = await setCacheTtl(categoryId, kind, Math.round(hours * 60 * 60 * 1000));
  res.json({ kind, hours, restamped });
}

/**
 * Get sync status for a source
 * GET /api/admin/sync/categories/:categoryId/status
 */
export async function getSyncStatus(req: Request, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));

  // Get in-memory sync status (generic for all categories)
  const status = getServiceSyncStatus(categoryId);

  if (status) {
    const isRunning = !isTerminalSyncStatus(status.status);
    // Whether a Cancel press would actually be acted on. Sent rather than
    // re-derived in the panel: the rule has moved twice in this change alone,
    // and a copy that lags shows up as a button promising what the server
    // refuses.
    const cancellable = isCancellable(status);
    res.json({
      running: isRunning,
      cancellable,
      status: status.status,
      statusMessage: status.statusMessage,
      progress: status.progress,
      total: status.total,
      percent: status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0,
      created: status.created,
      updated: status.updated,
      unchanged: status.unchanged,
      missing: status.missing,
      curatedConflicts: status.curatedConflicts,
      held: status.held,
      filtered: status.filtered,
      errors: status.errors,
      currentItem: status.currentItem,
      logId: status.logId,
      dryRun: status.dryRun,
    });
    return;
  }

  // No in-memory status - check the database for last sync status
  const source = await pool.query(
    'SELECT last_sync_at, last_sync_status FROM experience_categories WHERE id = $1',
    [categoryId]
  );

  if (source.rows.length === 0) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  res.json({
    running: false,
    lastSyncAt: source.rows[0].last_sync_at,
    lastSyncStatus: source.rows[0].last_sync_status,
  });
}

/**
 * Cancel sync for a source
 * POST /api/admin/sync/categories/:categoryId/cancel
 */
export async function cancelSync(req: Request, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));

  const source = await pool.query(
    'SELECT id FROM experience_categories WHERE id = $1',
    [categoryId]
  );
  if (source.rows.length === 0) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  const cancelled = cancelServiceSync(categoryId);
  res.json({ cancelled });
}

/**
 * Fix missing images for a source
 * POST /api/admin/sync/categories/:categoryId/fix-images
 */
export async function fixImages(req: AuthenticatedRequest, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));
  const triggeredBy = req.user?.id || null;

  if (categoryId === MUSEUM_CATEGORY_ID) {
    fixMuseumImages(triggeredBy).catch((err) => {
      console.error('[Sync Controller] Fix museum images error:', err);
    });
    res.json({ started: true, message: 'Fixing missing images. Poll /status endpoint for progress.' });
  } else {
    res.status(400).json({ error: 'Fix images not implemented for this source' });
  }
}

/**
 * Get sync history/logs
 * GET /api/admin/sync/logs
 */
export async function getSyncLogs(req: Request, res: Response): Promise<void> {
  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId)) : null;
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  const offset = parseInt(String(req.query.offset)) || 0;

  let query = `
    SELECT
      l.id,
      l.category_id,
      s.name as category_name,
      l.started_at,
      l.completed_at,
      l.status,
      l.total_fetched,
      l.total_created,
      l.total_updated,
      l.total_unchanged,
      l.total_missing,
      l.total_curated_conflicts,
      l.total_held,
      l.total_filtered,
      l.total_errors,
      l.is_dry_run,
      l.detection_skipped_reason,
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
      COALESCE(l.error_details @> '[${JSON.stringify(CHANGESET_LOST_MARKER)}]', FALSE) AS changeset_lost
    FROM experience_sync_logs l
    JOIN experience_categories s ON l.category_id = s.id
    LEFT JOIN users u ON l.triggered_by = u.id
  `;

  const params: (number | string)[] = [];
  let paramIndex = 1;

  if (categoryId) {
    query += ` WHERE l.category_id = $${paramIndex++}`;
    params.push(categoryId);
  }

  query += ` ORDER BY l.started_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Get total count
  let countQuery = 'SELECT COUNT(*) FROM experience_sync_logs';
  const countParams: number[] = [];
  if (categoryId) {
    countQuery += ' WHERE category_id = $1';
    countParams.push(categoryId);
  }
  const countResult = await pool.query(countQuery, countParams);

  res.json({
    logs: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  });
}

/**
 * Get single sync log with error details
 * GET /api/admin/sync/logs/:logId
 */
export async function getSyncLogDetails(req: Request, res: Response): Promise<void> {
  const logId = parseInt(String(req.params.logId));

  const result = await pool.query(
    `SELECT
      l.*,
      s.name as category_name,
      u.display_name as triggered_by_name,
      EXISTS (SELECT 1 FROM experience_sync_changes c WHERE c.sync_log_id = l.id) AS has_changeset,
      COALESCE(l.error_details @> '[${JSON.stringify(CHANGESET_LOST_MARKER)}]', FALSE) AS changeset_lost
     FROM experience_sync_logs l
     JOIN experience_categories s ON l.category_id = s.id
     LEFT JOIN users u ON l.triggered_by = u.id
     WHERE l.id = $1`,
    [logId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Sync log not found' });
    return;
  }

  res.json(result.rows[0]);
}

/**
 * List what a run did, object by object.
 * GET /api/admin/sync/logs/:logId/changes
 *
 * Rows that came through unchanged are not here — they are a count on the log.
 * Ordering puts the significant ones first, since that is what a reviewer came
 * for.
 */
export async function getSyncLogChanges(req: Request, res: Response): Promise<void> {
  const logId = parseInt(String(req.params.logId));
  const { type, significance, significantOnly, limit = 50, offset = 0 } = req.query as {
    type?: string; significance?: string; significantOnly?: 'true' | 'false';
    limit?: number; offset?: number;
  };

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
  // `shortDescription` beside an applied `nameLocal.en` computes 'minor' and the first
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

  const rowsResult = await pool.query(
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

  res.json({
    changes: rowsResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    limit: Number(limit),
    offset: Number(offset),
  });
}

/**
 * List all experience sources with assignment status
 * GET /api/admin/sync/categories
 *
 * Reports each source's curation gate and what it is holding; the switch that *writes*
 * the gate is `curationGateController.ts`, because this file is about starting, watching
 * and cancelling runs while that is about what a run is allowed to show.
 */
export async function getCategories(req: Request, res: Response): Promise<void> {
  // Get sources
  const sourcesResult = await pool.query(`
    SELECT
      id,
      name,
      description,
      is_active,
      requires_curation,
      last_sync_at,
      last_sync_status,
      display_priority,
      created_at
    FROM experience_categories
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
  // scan on a grown catalogue is enough. A throw used to reject `getCategories`
  // entirely, and the panel that reads it destructures only `data`: no sources, no
  // Start Sync, no Cancel and no message saying why, on all three screens that share
  // the query. `null` costs three numbers and says so; the alternative cost the
  // screen.
  let waiting: Awaited<ReturnType<typeof waitingCountsByCategory>> | null = null;
  try {
    waiting = await waitingCountsByCategory();
  } catch (error) {
    console.error('[sync/categories] waiting counts failed:', error);
  }

  // No `assignment_needed` flag any more, and no `last_assignment_at` either.
  //
  // The flag meant "a sync happened after the last full re-assignment", which
  // stopped being a question a sync can leave open: the run places what moved
  // before it finishes. Kept as a computed field it would have been permanently
  // true — a full rebuild is now only for changed region geometry, so nothing a
  // sync does could ever satisfy it.
  //
  // `last_assignment_at` went with it rather than being ported to Drizzle: it
  // existed to feed that comparison and no client ever read it on its own. The
  // column is still written by `assignExperiencesToRegions` and still available
  // to whatever wants it later.
  res.json(sourcesResult.rows.map(source => ({
    ...source,
    // Three zeros for a source the aggregate returned no row for — it groups, so a
    // source with nothing waiting is absent rather than zero — but `null` when the
    // aggregate itself did not answer. A zero there would be a claim about the source
    // that nothing checked, which is the same reason `heldLeftForReview` is nullable.
    waiting: waiting === null
      ? null
      : waiting.get(source.id) ?? { arrivals: 0, held: 0, contents: 0 },
    // Whether this source keeps anything between runs, which decides whether
    // "Sync without cache" is a real offer. Only the museum collector describes
    // its questions (ADR-0030 decision 4), so on the other two that button
    // would promise to bypass something that does not exist — the same
    // pretence the cache panel below it refuses to make.
    caches: (CACHED_KINDS_BY_CATEGORY[source.id as number] ?? []).length > 0,
  })));
}

// =============================================================================
// Region Assignment Endpoints
// =============================================================================

/**
 * Start region assignment for a world view
 * POST /api/admin/experiences/assign-regions
 */
export async function startRegionAssignment(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.body.worldViewId || req.query.worldViewId));
  const categoryId = req.body.categoryId ? parseInt(String(req.body.categoryId)) : undefined;

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId is required' });
    return;
  }

  // Validate world view exists
  const worldView = await pool.query(
    'SELECT id, name FROM world_views WHERE id = $1',
    [worldViewId]
  );

  if (worldView.rows.length === 0) {
    res.status(404).json({ error: 'World view not found' });
    return;
  }

  // Start assignment in background
  assignExperiencesToRegions(worldViewId, categoryId).catch((err) => {
    console.error('[Sync Controller] Region assignment error:', err);
  });

  res.json({
    started: true,
    worldViewId,
    worldViewName: worldView.rows[0].name,
    categoryId: categoryId || null,
    message: 'Region assignment started. Poll /status endpoint for progress.',
  });
}

/**
 * Get region assignment status
 * GET /api/admin/experiences/assign-regions/status
 */
export async function getRegionAssignmentStatus(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.query.worldViewId));

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId query parameter is required' });
    return;
  }

  const status = getAssignmentStatus(worldViewId);
  if (!status) {
    res.json({ running: false });
    return;
  }

  const isRunning = !isTerminalSyncStatus(status.status);

  res.json({
    running: isRunning,
    status: status.status,
    statusMessage: status.statusMessage,
    directAssignments: status.directAssignments,
    ancestorAssignments: status.ancestorAssignments,
    totalAssignments: status.directAssignments + status.ancestorAssignments,
    errors: status.errors,
  });
}

/**
 * Cancel region assignment
 * POST /api/admin/experiences/assign-regions/cancel
 */
export async function cancelRegionAssignment(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.body.worldViewId || req.query.worldViewId));

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId is required' });
    return;
  }

  const cancelled = cancelAssignment(worldViewId);
  res.json({ cancelled });
}

/**
 * Get experience counts by region
 * GET /api/admin/experiences/counts-by-region
 */
export async function getExperienceCounts(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.query.worldViewId));
  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId)) : undefined;

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId query parameter is required' });
    return;
  }

  const counts = await getExperienceCountsByRegion(worldViewId, categoryId);
  res.json(counts);
}

/**
 * Reorder experience sources (set display_priority)
 * PUT /api/admin/sync/categories/reorder
 * Body: { categoryIds: [1, 3, 2] }  -- array of source IDs in desired order
 */
export async function reorderCategories(req: Request, res: Response): Promise<void> {
  const { categoryIds } = req.body as { categoryIds?: number[] };

  if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
    res.status(400).json({ error: 'categoryIds array is required' });
    return;
  }

  // One client, not pool.query('BEGIN') — see the note in curationController:
  // pg.Pool hands out an arbitrary idle client per call, so a transaction has
  // to be pinned or its statements land on different connections. The order is
  // written one row at a time, so a half-applied run leaves two sources sharing
  // a display_priority and one with none.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < categoryIds.length; i++) {
      await client.query(
        'UPDATE experience_categories SET display_priority = $1 WHERE id = $2',
        [i + 1, categoryIds[i]]
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

  res.json({ success: true, order: categoryIds });
}
