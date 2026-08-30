/**
 * Shared sync utilities
 *
 * Common database operations used by UNESCO, museum, and landmark sync services.
 */

import { eq } from 'drizzle-orm';
import { pool, db } from '../../db/index.js';
import { experienceSyncLogs, experienceCategories } from '../../db/schema.js';
import { writeExperienceLocations, type LocationWriteResult } from './locationWriter.js';
import { pointHeldProposalAt } from './heldProposalPointer.js';
import {
  computeChangeSet, METADATA_CLAIM_PREFIX, SYNC_OWNED_METADATA_KEYS,
  type ChangeSetResult, type ExperienceSnapshot,
} from './changeSet.js';

// =============================================================================
// Experience Upsert
// =============================================================================

export interface ExperienceUpsertParams {
  categoryId: number;
  externalId: string;
  name: string;
  nameLocal: Record<string, string>;
  description: string | null;
  shortDescription: string | null;
  category: string | null;
  tags: string[];
  lon: number;
  lat: number;
  countryCodes: string[];
  countryNames: string[];
  imageUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface UpsertOutcome {
  experienceId: number;
  changeSet: ChangeSetResult;
  nameSnapshot: string;
  /**
   * The source has produced a row it had stopped offering — either one still
   * carrying `missing_since`, or one a curator had already called `former`,
   * whose verdict is what cleared the flag.
   */
  returnedFromMissing: boolean;
}

/**
 * The hold, as one SQL expression over the **stored** row: a gated source may not
 * overwrite what a reader can already see (ADR-0025 decision 5). A row still
 * `pending` has nothing to protect, so it keeps being refreshed in place and the
 * curator reviews the newest state rather than whatever arrived first.
 *
 * A function, because the two statements below reach the gate flag differently —
 * the upsert has a `gate` CTE it can also use in `VALUES`, the preview has one
 * SELECT and no CTE — and because the rule itself must exist exactly once. It
 * used to be written out in SQL for the write and again in TypeScript for the
 * report, and the two could disagree about the same run: the SQL reads the row
 * under the lock while a CTE reads the statement's snapshot, so a publish landing
 * between the two made the statement hold a write the report called applied
 * (#519 again, for one run). Now the statement answers the question once and
 * hands the answer back.
 *
 * `experiences.` is not decoration: inside `ON CONFLICT DO UPDATE` both
 * `experiences` and `excluded` are in scope, so an unqualified column there is
 * ambiguous — and `excluded.curation_state` is what this statement's own CASE
 * just computed, which would make the guard `true AND false` for everyone.
 */
const heldSql = (gate: string) => `(${gate} AND experiences.curation_state <> 'pending')`;

/** The upsert's form, off its `gate` CTE. */
const HELD = heldSql('(SELECT requires_curation FROM gate)');
/** The preview's form: one SELECT, so the flag is fetched inline. */
const PREVIEW_HELD = heldSql('(SELECT requires_curation FROM experience_categories WHERE id = $1)');

/**
 * The part of the incoming metadata this run owns outright, as an object to
 * merge over whatever the guards above decided (#571).
 *
 * `$16` is `SYNC_OWNED_METADATA_KEYS`, bound rather than spelled into the
 * statement so the key list stays one constant and no SQL is assembled by
 * concatenation. `jsonb_object_agg` over an empty set is NULL, which is what the
 * COALESCE is for; the presence guard is what keeps a source that sends none of
 * these keys from writing a null-valued one into every row, since the aggregate
 * rejects a null key and accepts a null value.
 */
const SYNC_OWNED_SLICE = `COALESCE((
                 SELECT jsonb_object_agg(owned.k, EXCLUDED.metadata -> owned.k)
                 FROM unnest($16::text[]) AS owned(k)
                 WHERE EXCLUDED.metadata ? owned.k
               ), '{}'::jsonb)`;

/** Columns the diff reads. Declared once; the SQL below is built from them. */
const SNAPSHOT_COLUMNS = [
  'name', 'name_local', 'description', 'short_description', 'category', 'tags',
  'country_codes', 'country_names', 'image_url', 'metadata',
] as const;

function snapshotFromRow(row: Record<string, unknown>, prefix: '' | 'old_'): ExperienceSnapshot {
  const get = (column: string) => row[`${prefix}${column}`];
  return {
    name: (get('name') as string) ?? '',
    nameLocal: (get('name_local') as Record<string, string> | null) ?? null,
    description: (get('description') as string | null) ?? null,
    shortDescription: (get('short_description') as string | null) ?? null,
    category: (get('category') as string | null) ?? null,
    tags: (get('tags') as string[] | null) ?? null,
    lon: Number(get('lon')),
    lat: Number(get('lat')),
    countryCodes: (get('country_codes') as string[] | null) ?? null,
    countryNames: (get('country_names') as string[] | null) ?? null,
    imageUrl: (get('image_url') as string | null) ?? null,
    metadata: (get('metadata') as Record<string, unknown> | null) ?? null,
  };
}

function snapshotFromParams(params: ExperienceUpsertParams): ExperienceSnapshot {
  return {
    name: params.name,
    nameLocal: params.nameLocal,
    description: params.description,
    shortDescription: params.shortDescription,
    category: params.category,
    tags: params.tags,
    lon: params.lon,
    lat: params.lat,
    countryCodes: params.countryCodes,
    countryNames: params.countryNames,
    imageUrl: params.imageUrl,
    metadata: params.metadata,
  };
}

/**
 * Read the stored row and diff it against the incoming record without writing.
 *
 * Backs dry runs: a preview has to be able to say what would change without
 * spending the change.
 */
async function previewUpsert(params: ExperienceUpsertParams): Promise<UpsertOutcome> {
  const result = await pool.query(
    `SELECT id, curated_fields, missing_since, source_membership,
            ${PREVIEW_HELD} AS was_held,
            ${SNAPSHOT_COLUMNS.join(', ')},
            ST_X(location) AS lon, ST_Y(location) AS lat
     FROM experiences
     WHERE category_id = $1 AND external_id = $2`,
    [params.categoryId, params.externalId]
  );

  const incoming = snapshotFromParams(params);

  if (result.rows.length === 0) {
    return {
      experienceId: 0,
      // No stored row, so nothing to hold: the insert writes every column, and
      // `pending` is what the gate does about a new row.
      changeSet: computeChangeSet(null, incoming, [], false),
      nameSnapshot: params.name,
      returnedFromMissing: false,
    };
  }

  const row = result.rows[0];
  const curatedFields: string[] = row.curated_fields ?? [];

  // What the run this preview stands in for would refuse to write, asked of the
  // same expression that run's own guards are built from. Asked at all because
  // the whole point of a preview is to say what that run would do, and a preview
  // reporting a rename the run would refuse would mislabel it in the one
  // direction that matters. No lock and one snapshot here, so this row's answer
  // cannot go stale between reads the way the write path's could.
  const heldFromView = Boolean(row.was_held);

  return {
    experienceId: row.id,
    // The change set still reports what the source proposes, held or not: under
    // a gate the proposal is what a curator is being asked about, so a preview
    // that reported "nothing would change" would hide the question. The hold
    // rides along so it lands in the bucket that says it was refused.
    changeSet: computeChangeSet(snapshotFromRow(row, ''), incoming, curatedFields, heldFromView),
    nameSnapshot: curatedFields.includes('name') || heldFromView
      ? (row.name as string)
      : params.name,
    returnedFromMissing: row.missing_since !== null || row.source_membership === 'former',
  };
}

/**
 * Upsert an experience record with curated_fields-aware conflict handling,
 * returning both the prior and resulting state.
 *
 * The `before` CTE is what makes provenance possible: RETURNING can only hand
 * back the row as it now stands, so the previous values are captured in the
 * same statement or they are gone.
 */
export async function upsertExperienceRecord(
  params: ExperienceUpsertParams,
  options: { dryRun?: boolean; syncLogId?: number | null } = {},
): Promise<UpsertOutcome> {
  if (options.dryRun) return previewUpsert(params);

  // `HELD` guards every content column below but tags, and answers for the report in
  // `RETURNING`. Inside `ON CONFLICT DO UPDATE`, `experiences.curation_state` is
  // the PRE-update value as re-read under the row lock — which is what makes the
  // rule expressible in SQL at all, and what makes this the version the report
  // has to agree with.
  const result = await pool.query(
    `WITH before AS (
      SELECT id, curated_fields, missing_since, source_membership,
             ${SNAPSHOT_COLUMNS.join(', ')},
             ST_X(location) AS lon, ST_Y(location) AS lat
      FROM experiences
      WHERE category_id = $1 AND external_id = $2
    ), gate AS (
      SELECT requires_curation FROM experience_categories WHERE id = $1
    ), ins AS (
      INSERT INTO experiences (
        category_id, external_id, name, name_local, description, short_description,
        category, tags, location, country_codes, country_names, image_url, metadata,
        first_seen_sync_log_id, last_seen_sync_log_id, last_seen_at, created_at, updated_at,
        curation_state, published_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        ST_SetSRID(ST_MakePoint($9, $10), 4326),
        $11, $12, $13, $14, $15, $15, NOW(), NOW(), NOW(),
        -- A gated source's arrival waits for a person; a trusted source's is
        -- live the moment it lands, and says so (ADR-0025). Read from the
        -- category rather than passed in, so the check and the write cannot
        -- disagree.
        CASE WHEN (SELECT requires_curation FROM gate) THEN 'pending' ELSE 'auto' END,
        CASE WHEN (SELECT requires_curation FROM gate) THEN NULL ELSE NOW() END
      )
      ON CONFLICT (category_id, external_id) DO UPDATE SET
        name = CASE WHEN experiences.curated_fields ? 'name' OR ${HELD} THEN experiences.name ELSE EXCLUDED.name END,
        name_local = CASE WHEN experiences.curated_fields ? 'name_local' OR ${HELD} THEN experiences.name_local ELSE EXCLUDED.name_local END,
        description = CASE WHEN experiences.curated_fields ? 'description' OR ${HELD} THEN experiences.description ELSE EXCLUDED.description END,
        short_description = CASE WHEN experiences.curated_fields ? 'short_description' OR ${HELD} THEN experiences.short_description ELSE EXCLUDED.short_description END,
        category = CASE WHEN experiences.curated_fields ? 'category' OR ${HELD} THEN experiences.category ELSE EXCLUDED.category END,
        -- Behind a claim but not behind the gate. Tags are labels the import
        -- derives from facts it also stores by name -- the criteria, the danger
        -- listing, the landmark's type -- and no reader-facing read returns
        -- them (the by-id read did, rendered by nothing, until #570 took the
        -- column out of it), so there is nothing a reader can already see for
        -- the gate to protect (#570, the rule #571 stated: a person is asked only about
        -- what a reader can eventually see). Held, they filed 3785 rows in
        -- this database's log that restated the row beside them. A claim still
        -- holds, unlike the run-owned counters in metadata: a curator can set
        -- tags through the edit endpoint, and a person's deliberate write is
        -- not a measurement the run can be right about. computeChangeSet
        -- reports tags nowhere, so nothing written here waits on anybody.
        -- One consequence is owned rather than hidden: the in_danger tag now
        -- moves ahead of the metadata flag it mirrors while that flag is
        -- held, and the Catalogue Check comparing the two leaves out a row
        -- whose held proposal holds the flag itself.
        tags = CASE WHEN experiences.curated_fields ? 'tags' THEN experiences.tags ELSE EXCLUDED.tags END,
        location = CASE WHEN experiences.curated_fields ? 'location' OR ${HELD} THEN experiences.location ELSE EXCLUDED.location END,
        country_codes = CASE WHEN experiences.curated_fields ? 'country_codes' OR ${HELD} THEN experiences.country_codes ELSE EXCLUDED.country_codes END,
        country_names = CASE WHEN experiences.curated_fields ? 'country_names' OR ${HELD} THEN experiences.country_names ELSE EXCLUDED.country_names END,
        image_url = CASE WHEN experiences.curated_fields ? 'image_url' OR ${HELD} THEN experiences.image_url ELSE EXCLUDED.image_url END,
        -- Two claim shapes reach this column, and only one of them used to work.
        -- editExperience claims per key -- 'metadata.website',
        -- 'metadata.wikipediaUrl' -- and ? 'metadata' is false for those, so
        -- the guard never fired and EXCLUDED replaced the object, curator's link
        -- included (#488). A claim on 'metadata' itself still holds the whole
        -- column; a per-key claim now re-applies just those keys over whatever
        -- the source sent, so an unclaimed key still updates.
        --
        -- The keys a run computes about its own pass stand outside both guards:
        -- a claim cannot hold them because nobody can be right about a
        -- measurement, and the gate does not hold them because they are not
        -- content a reader sees. That is the standing last_seen_at has here,
        -- and the one the treasures upsert gives sitelinks_count. Refusing them
        -- froze the Louvre's stored fame sum at the value it had when the gate
        -- went up, while every run went on asking a curator about the difference
        -- (#571). Each arm reaches that its own way: the refusing arm merges the
        -- slice over the stored object, and the writing arm has it already,
        -- inside the source's own object, provided the claimed-key
        -- re-application below leaves it alone. computeChangeSet keeps the
        -- identical keys out of the diff, so nothing written here is reported as
        -- a change or waits on anybody.
        metadata = CASE
          WHEN experiences.curated_fields ? 'metadata' OR ${HELD}
            THEN COALESCE(experiences.metadata, '{}'::jsonb) || ${SYNC_OWNED_SLICE}
          ELSE COALESCE(EXCLUDED.metadata, '{}'::jsonb) || COALESCE((
                 SELECT jsonb_object_agg(claimed.k, experiences.metadata -> claimed.k)
                 FROM (
                   SELECT substring(key FROM ${METADATA_CLAIM_PREFIX.length + 1}) AS k
                   FROM jsonb_array_elements_text(experiences.curated_fields) AS t(key)
                   WHERE key LIKE '${METADATA_CLAIM_PREFIX}%'
                 ) AS claimed
                 -- The exclusion claimedMetadataKeys applies on the other side.
                 -- Re-applying a claimed counter here would put the stored value
                 -- back over the source's while the diff reported neither, and
                 -- the row would keep a number no run could ever correct.
                 WHERE experiences.metadata ? claimed.k
                   AND claimed.k <> ALL($16::text[])
               ), '{}'::jsonb)
        END,
        -- The pointer says which run's proposal is being held, so the curator's
        -- screen can find it. This statement can only ever clear it: whether a
        -- proposal exists at all is a question about whether anything actually
        -- differs, and the CASE guards above fire either way — the same reason
        -- the decay below is resolved in TypeScript. So a held row keeps the
        -- pointer it has and a row that is not held loses it, because a run that
        -- is free to write the content leaves nothing waiting. Setting it is
        -- done after this statement, and only for a run that proposed something.
        pending_change_sync_log_id = CASE WHEN ${HELD}
                                         THEN experiences.pending_change_sync_log_id
                                         ELSE NULL END,
        last_seen_sync_log_id = COALESCE(EXCLUDED.last_seen_sync_log_id, experiences.last_seen_sync_log_id),
        last_seen_at = NOW(),
        missing_since = NULL,
        -- The source listing a row is evidence about membership, exactly as
        -- its absence was. A curator's 'former' was a claim about the source's
        -- collection, and the source has just contradicted it; leaving it
        -- would mark as delisted an object the source currently offers, with
        -- nothing anywhere to say so. Existence is untouched: a listing says
        -- nothing about whether the thing still stands. Only ever toward more
        -- visibility, so a source outage still cannot hide anything (ADR-0020).
        source_membership = 'present',
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted, curated_fields, pending_change_sync_log_id,
                -- The guards' own expression, so the report cannot disagree with
                -- the write about whether the write happened. Evaluated here on
                -- the row this statement locked, exactly as the CASE arms were:
                -- curation_state is never assigned on conflict (pinned by a
                -- test), so RETURNING's value for it is the one they read. A
                -- second copy computed from the before CTE would read the
                -- statement's snapshot instead, and a publish landing between the
                -- two reads would have the write hold what the report called
                -- applied (#519) -- or, with the guards moved to the snapshot,
                -- have the run overwrite a row a curator had just published,
                -- permanently and with nothing anywhere to say so.
                ${HELD} AS was_held,
                ${SNAPSHOT_COLUMNS.join(', ')},
                ST_X(location) AS lon, ST_Y(location) AS lat
    )
    SELECT ins.*,
           ${SNAPSHOT_COLUMNS.map(column => `before.${column} AS old_${column}`).join(', ')},
           before.lon AS old_lon, before.lat AS old_lat,
           before.missing_since AS old_missing_since,
           before.source_membership AS old_source_membership
    FROM ins LEFT JOIN before ON before.id = ins.id`,
    [
      params.categoryId,
      params.externalId,
      params.name,
      JSON.stringify(params.nameLocal),
      params.description,
      params.shortDescription,
      params.category,
      JSON.stringify(params.tags),
      params.lon,
      params.lat,
      params.countryCodes,
      params.countryNames,
      params.imageUrl,
      JSON.stringify(params.metadata),
      options.syncLogId ?? null,
      // The key list the metadata arms read twice, bound once. A text[] rather
      // than a literal built into the statement, so the constant in
      // `changeSet.ts` stays the only place these names are written down.
      [...SYNC_OWNED_METADATA_KEYS],
    ]
  );

  const row = result.rows[0];
  const before = row.inserted ? null : snapshotFromRow(row, 'old_');
  const changeSet = computeChangeSet(
    before, snapshotFromParams(params), row.curated_fields ?? [], Boolean(row.was_held));

  // A curator's pass covered the object that was there; a changed object has not
  // been passed (ADR-0025). Resolved here rather than in SQL because the
  // statement cannot tell a content change from a provenance-only pass — its
  // CASE guards fire either way — and resolved inside this function rather than
  // in the three sync services, which would be three places to forget.
  //
  // Only a **trusted** source's change retires a pass, and the reason is the
  // hold above: under a gated source the changed values were not written, so
  // what a reader sees is still exactly what the curator passed. Decaying there
  // would retire a pass over a change the same statement had just refused to
  // apply, on every run, for as long as the proposal went unanswered. Two things
  // now say so — the change set files those values as held rather than changed,
  // so `wroteContent` is false and no statement is even sent, and the statement
  // carries the gate check itself for the case where something did get written.
  //
  // Scoped to `verified` so it can only ever move one way. A `pending` row is
  // untouched: it is not published, so there is nothing to decay.
  //
  // Its own statement, so a failure here throws after the content is already
  // committed and the run reports that object as failed. Deliberate: the
  // alternative is to swallow the error, which leaves a row saying `verified`
  // about content nobody passed, and the next run finds nothing changed and so
  // never decays it. A failed item is visible in the run's report; a silent one
  // is not.
  //
  // Fields this statement actually wrote, which is now exactly what
  // `changedFields` holds: `computeChangeSet` files a refused write under the
  // reason it was refused instead (#519). So the decay below stays keyed to
  // written content without having to subtract anything.
  const wroteContent = changeSet.changedFields.length > 0;
  // The pointer follows every proposal this statement refused, not only the ones
  // it wrote — and both kinds of refusal are proposals. A field a curator claimed
  // lands in `curatedConflicts`, a field the gate held in `heldFields`, and
  // either way `changedFields` is empty; keying the pointer on that alone would
  // clear it on a run whose proposal is still standing and still unanswered —
  // "nothing is held" about a row that is holding something, and about the
  // gate-held case that is the whole reason the pointer exists. `significance` in
  // `changeSet.ts` weighs all three buckets for the same reason: the refused half
  // is the half needing a decision, so it cannot be the hidden one.
  const proposedAnything = wroteContent
    || changeSet.curatedConflicts.length > 0
    || changeSet.heldFields.length > 0;

  if (wroteContent) {
    await pool.query(
      `UPDATE experiences SET curation_state = 'auto'
        WHERE id = $1 AND curation_state = 'verified'
          AND NOT EXISTS (
            SELECT 1 FROM experience_categories
             WHERE id = $2 AND requires_curation
          )`,
      [row.id, params.categoryId],
    );
  }

  if (proposedAnything) {
    // And the mirror image of the decay: where the source IS gated and the row
    // was visible, the statement above kept the stored content and this run's
    // proposal is what a curator will be shown, so the row points at this run.
    // Only here, because only here is it known that something was actually
    // proposed — the upsert cannot tell a content change from a pass that
    // touched nothing, and a pointer set on every pass would tell a curator that
    // 1200 rows were waiting on a decision when none of them were.
    //
    // The statement is shared with the two content writers, which set the same
    // pointer for a held field of a point or a work (ADR-0037); the predicate —
    // a visible row under a gated source, and never from a run with no log id —
    // lives there so the three cannot drift.
    await pointHeldProposalAt(pool, row.id as number, options.syncLogId ?? null);
  } else if (row.pending_change_sync_log_id !== null) {
    // The complement, and the reason the column can be trusted to mean what its
    // comment says. A run that proposed nothing at all — nothing written and
    // nothing refused — has nothing held: the source has come back to what is
    // stored, so a pointer left in place would name a proposal that no longer
    // exists, a decision waiting on a curator's screen that the source has
    // already withdrawn. Only reached when the row actually carries a pointer,
    // which is why the upsert returns it: otherwise every unchanged row in every
    // run would spend a statement on this.
    await pool.query(
      `UPDATE experiences SET pending_change_sync_log_id = NULL
        WHERE id = $1 AND curation_state <> 'pending'
          AND EXISTS (
            SELECT 1 FROM experience_categories
             WHERE id = $2 AND requires_curation
          )`,
      [row.id, params.categoryId],
    );
  }

  return {
    experienceId: row.id,
    changeSet,
    // RETURNING carries the name after the curated_fields guards, so a
    // protected name labels the changeset row with what is actually stored.
    nameSnapshot: (row.name as string) ?? params.name,
    // A curator's verdict takes the row out of `missing_since`, so the flag
    // alone would miss the return of an object someone had already called
    // former — which is the only reason it stopped being flagged.
    returnedFromMissing: row.old_missing_since != null || row.old_source_membership === 'former',
  };
}

// =============================================================================
// Single-Location Upsert
// =============================================================================

/**
 * Write the one location a venue has.
 *
 * Used by museum and landmark syncs; UNESCO has its own multi-location path.
 * Both go through `writeExperienceLocations`, which keeps the row — and so the
 * region assignments — of a point that has not moved. This used to delete and
 * re-insert, which is why every run needed a full re-assignment afterwards.
 */
export async function upsertSingleLocation(
  experienceId: number,
  externalRef: string,
  lon: number,
  lat: number,
): Promise<LocationWriteResult> {
  return writeExperienceLocations(experienceId, [
    { name: null, externalRef, lon, lat },
  ]);
}

// =============================================================================
// Sync Log Operations
// =============================================================================

/**
 * Create a new sync log entry with status 'running'.
 */
export async function createSyncLog(
  categoryId: number,
  triggeredBy: number | null,
  isDryRun: boolean = false,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (category_id, triggered_by, status, is_dry_run)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [categoryId, triggeredBy, isDryRun]
  );
  return result.rows[0].id;
}

export interface SyncLogStats {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  missing: number;
  curatedConflicts: number;
  /** Rows the gate held whole; a subset of `unchanged`, counted again (#523). */
  held: number;
  filtered: number;
  errors: number;
  detectionSkippedReason?: string | null;
}

/**
 * Update a sync log entry with final status and stats.
 *
 * Also updates the experience_categories table with last sync info — except
 * after a dry run, which synced nothing. Claiming otherwise there would make
 * the category's own record of its last sync a lie.
 */
export async function updateSyncLog(
  categoryId: number,
  logId: number,
  status: string,
  stats: SyncLogStats,
  errorDetails?: unknown[],
): Promise<void> {
  const result = await pool.query(
    `UPDATE experience_sync_logs SET
      completed_at = NOW(),
      status = $2,
      total_fetched = $3,
      total_created = $4,
      total_updated = $5,
      total_errors = $6,
      error_details = $7,
      total_unchanged = $8,
      total_missing = $9,
      total_curated_conflicts = $10,
      detection_skipped_reason = $11,
      total_filtered = $12,
      total_held = $13
     WHERE id = $1
     RETURNING is_dry_run`,
    [logId, status, stats.fetched, stats.created, stats.updated, stats.errors,
     errorDetails ? JSON.stringify(errorDetails) : null,
     stats.unchanged, stats.missing, stats.curatedConflicts,
     stats.detectionSkippedReason ?? null, stats.filtered, stats.held]
  );

  if (result.rows[0]?.is_dry_run) return;

  await pool.query(
    `UPDATE experience_categories SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [categoryId, status, status === 'failed' ? 'See sync log for details' : null]
  );
}

/**
 * Note on an already-closed run that a follow-up step failed.
 *
 * Deliberately narrow. `updateSyncLog` is a full rewrite — it sets every stat
 * column and `detection_skipped_reason` unconditionally — so calling it again
 * to change two fields would clobber the ten it is not being asked about. Two
 * of those genuinely differ between the caller's view and what the run wrote:
 * `total_fetched` is the source's item count rather than the processed one, and
 * `detection_skipped_reason` is produced by `detectMissing`, which a later
 * caller has no reason to recompute.
 *
 * Touches only `status` and `error_details`, and mirrors the status onto the
 * category the same way `updateSyncLog` does, since that is what both admin
 * surfaces read.
 */
export async function annotateClosedSyncLog(
  categoryId: number,
  logId: number,
  status: string,
  errorDetails: unknown[],
): Promise<void> {
  // ADR-0004: Drizzle over raw SQL. These are ordinary relational updates with
  // no PostGIS in them, which is where the raw `pool` is reserved for.
  //
  // One transaction, because the two rows are one statement of fact: the log
  // marked and the category not would leave the admin surfaces disagreeing
  // about the run they both read.
  await db.transaction(async (tx) => {
    const [log] = await tx
      .update(experienceSyncLogs)
      .set({ status, errorDetails })
      .where(eq(experienceSyncLogs.id, logId))
      .returning({ isDryRun: experienceSyncLogs.isDryRun });

    if (log?.isDryRun) return;

    // `last_sync_error` carries the same mapping `updateSyncLog` applies, or a
    // downgrade would leave a stale message from an earlier failed run standing
    // next to this run's new status.
    await tx
      .update(experienceCategories)
      .set({
        lastSyncStatus: status,
        lastSyncError: status === 'failed' ? 'See sync log for details' : null,
      })
      .where(eq(experienceCategories.id, categoryId));
  });
}

