/**
 * Curator decisions about an experience's lifecycle.
 *
 * A sync run can observe that a source stopped listing an object, or that it
 * wants to change a field a curator has claimed. It cannot decide what either
 * means: a site absent from the list may be delisted or destroyed or simply
 * missed, and only a person can tell which. This is where that judgement is
 * recorded — see ADR-0020 for why the two axes are separate.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { CURATED_KEY_BY_FIELD } from '../../services/sync/changeSet.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';

/** How many items a queue page holds by default. */
const QUEUE_PAGE_SIZE = 25;

/**
 * Which of the fields a run can propose this endpoint will write back.
 *
 * Deliberately a subset. `location` and the country arrays need more than an
 * assignment, and `metadata` is claimed per key — `editExperience` writes
 * `metadata.website`, which is no column at all — so accepting it wholesale
 * would discard the keys the curator did not touch. These five are the ones
 * whose `curated_fields` entry happens to be exactly the column, which is why
 * `CURATED_KEY_BY_FIELD` can answer both questions for them without the two
 * ever drifting from what the upsert honours.
 */
const ACCEPTABLE_FIELDS = new Set(['name', 'shortDescription', 'description', 'category', 'imageUrl']);

/**
 * The `curated_fields` key that protects a field.
 *
 * Usually the column name, but not always: `editExperience` claims
 * `metadata.website` per key, and no column matches that — hence the fallback
 * to the field's own name for keys the map does not carry.
 */
function claimKeyFor(field: string): string {
  return CURATED_KEY_BY_FIELD[field] ?? field;
}

/** The column an accepted field writes to, or null if it is not acceptable. */
function columnFor(field: string): string | null {
  if (!ACCEPTABLE_FIELDS.has(field)) return null;
  return CURATED_KEY_BY_FIELD[field] ?? null;
}

type Membership = 'present' | 'former';
type Existence = 'extant' | 'lost';

/**
 * The decisions waiting for a curator, scoped to what they cover.
 * GET /api/experiences/review/queue?categoryId=&limit=&offset=
 *
 * Two kinds of item, and they are answered differently:
 *
 * - **gone from the source** — a run stamped `missing_since` and stopped there.
 *   Users still see the object exactly as before; nothing about it changes
 *   until someone says whether it was delisted, destroyed, or never gone.
 * - **the source disagrees with an edit** — `curated_fields` refused a change
 *   and the divergence has been accumulating since. The value the source
 *   proposed is carried in the changeset, so it can still be applied.
 */
export async function getReviewQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === 'admin';
  const { categoryId, limit = QUEUE_PAGE_SIZE, offset = 0 } = req.query as {
    categoryId?: number; limit?: number; offset?: number;
  };

  // The rows span categories, so the unrestricted check correlates on each
  // row's own category rather than on the optional request filter.
  const scopeFilter = isAdmin
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('e.category_id')} OR EXISTS (
         SELECT 1 FROM experience_regions er
         JOIN curator_scoped_regions s ON s.id = er.region_id
         WHERE er.experience_id = e.id
       ))`;

  // Only bind what the SQL references. A placeholder that appears in the
  // parameter list but in no expression has no inferable type, and Postgres
  // refuses the whole statement with "could not determine data type".
  const params: unknown[] = [userId];
  let categoryFilter = '';
  if (categoryId) {
    params.push(categoryId);
    categoryFilter = `AND e.category_id = $${params.length}`;
  }

  const missing = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           e.missing_since, e.source_membership, e.existence,
           'missing' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.missing_since IS NOT NULL
      AND e.source_membership = 'present'
      ${categoryFilter}
      AND ${scopeFilter}
    ORDER BY e.missing_since DESC, e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  // A conflict is worth answering only while it is still the source's current
  // position, so the newest changeset row for the experience wins — and only
  // while the curator still claims the field. Accepting the source releases
  // that claim, which is what takes the item out of the queue: the changeset
  // row stays as a record of what the run did, so nothing else would.
  //
  // The claim key is usually the column name, but not always: editing only a
  // website claims `metadata.website`, which is no column at all. Hence the
  // map, and hence the fallback to the field's own name for the keys it does
  // not carry. Each field also says whether `accept-source` can write it —
  // `location` and the rest are shown but not offered, since a button that
  // 409s would leave the item unanswerable.
  const keyMapIdx = params.length + 1;
  const acceptableIdx = keyMapIdx + 1;
  const conflicts = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT * FROM (
      SELECT DISTINCT ON (e.id)
             e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
             e.missing_since, e.source_membership, e.existence,
             'conflict' AS kind, ch.sync_log_id,
             (SELECT jsonb_agg(f || jsonb_build_object(
                       'acceptable', $${acceptableIdx}::jsonb ? (f->>'field')))
               FROM jsonb_array_elements(ch.changed_fields) f
               WHERE (f->>'curatedConflict')::boolean
                 AND e.curated_fields ? COALESCE($${keyMapIdx}::jsonb->>(f->>'field'), f->>'field')
             ) AS proposed
      FROM experience_sync_changes ch
      JOIN experiences e ON e.id = ch.experience_id
      JOIN experience_categories c ON c.id = e.category_id
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      WHERE l.is_dry_run = FALSE
        AND ch.changed_fields @> '[{"curatedConflict": true}]'
        -- A run that finds the source agreeing again writes no row at all
        -- (see worthRecording), so the absence of a newer conflict is not
        -- evidence the disagreement stands. What such a run does leave is
        -- last_seen_sync_log_id, and a value newer than this row's means a
        -- later run saw the object and had nothing to propose.
        --
        -- Only once that run has finished and its batch actually landed.
        -- last_seen is stamped per item inside the loop while the changeset is
        -- written in one batch after it, so mid-run the newer value exists and
        -- the rows it would be read against do not — every conflict in the
        -- category would vanish for the length of the run.
        --
        -- A closed log is not by itself proof the batch landed, and status
        -- cannot answer it either: a run that throws after the item loop
        -- records its changes and only then marks itself failed. What
        -- distinguishes the two runs that recorded nothing is the marker each
        -- leaves — see CHANGESET_LANDED_SQL. Without that the inference would
        -- silence a standing disagreement for a whole sync cycle.
        AND (e.last_seen_sync_log_id IS NULL
             OR ch.sync_log_id >= e.last_seen_sync_log_id
             OR NOT EXISTS (
               SELECT 1 FROM experience_sync_logs prev
               WHERE prev.id = e.last_seen_sync_log_id AND ${CHANGESET_LANDED_SQL}))
        ${categoryFilter}
        AND ${scopeFilter}
      ORDER BY e.id, ch.id DESC
    ) q
    WHERE q.proposed IS NOT NULL
    ORDER BY q.id
    LIMIT $${acceptableIdx + 1} OFFSET $${acceptableIdx + 2}
  `, [...params, JSON.stringify(CURATED_KEY_BY_FIELD), JSON.stringify([...ACCEPTABLE_FIELDS]), limit, offset]);

  res.json({
    missing: missing.rows,
    conflicts: conflicts.rows,
    limit: Number(limit),
    offset: Number(offset),
  });
}

/**
 * Record what a curator decided about an object's lifecycle.
 * POST /api/experiences/:id/state
 * Body: { membership?: 'present'|'former', existence?: 'extant'|'lost', note?: string,
 *         expected: { membership, existence, flagged } }
 *
 * `expected` is required — the row as the caller was looking at it. Compared
 * under the write lock; see the comment on that comparison for why nothing
 * else can tell a stale view from a deliberate correction.
 *
 * Clearing `missing_since` is part of every answer: whichever verdict the
 * curator reaches, the machine's observation has been dealt with and should
 * stop appearing in the queue. Sending `membership: 'present'` alone is the
 * "false alarm" case — the source hiccupped and the object never went anywhere.
 */
export async function setExperienceState(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { membership, existence, note, expected } = req.body as {
    membership?: Membership; existence?: Existence; note?: string;
    expected: { membership: Membership; existence: Existence; flagged: boolean };
  };

  if (!membership && !existence) {
    res.status(400).json({ error: 'Nothing to decide: pass membership, existence, or both' });
    return;
  }

  const expResult = await pool.query(
    `SELECT id, category_id, source_membership, existence FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, existing.category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  // One client, not pool.query('BEGIN') — see the note in curationController:
  // pg.Pool hands out an arbitrary idle client per call, so a transaction has
  // to be pinned or its statements land on different connections.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let nextMembership: Membership;
  let nextExistence: Existence;
  let before: { source_membership: string; existence: string; missing_since?: Date | null };
  try {
    await client.query('BEGIN');

    // Both columns are written whatever the curator sent, the unsent axis
    // defaulting to what is already there — so the axis nobody decided has to
    // be read under the lock that writes it. Two curators on one item is the
    // normal case, not a corner: every region-scoped curator covering any of
    // its regions sees it, as do its category curator and every admin. From an
    // unlocked read, a verdict on one axis silently reverts a verdict on the
    // other, and the log would then assert `former` beside a column saying
    // `present`. Reverting `lost` costs more still: it puts the row back inside
    // missing detection's `existence <> 'lost'` predicate, so the next clean
    // run re-flags it and the item returns to the queue for good.
    const locked = await client.query(
      `SELECT source_membership, existence, missing_since FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    before = locked.rows[0] ?? existing;
    nextMembership = membership ?? (before.source_membership as Membership);
    nextExistence = existence ?? (before.existence as Existence);

    // Does the row still look the way the curator saw it? Only the request can
    // say — a card drawn before the question was answered is otherwise
    // indistinguishable from a deliberate correction, and the difference hides
    // where it is least visible: "false alarm" over a recorded `former` is a
    // real transition, so no check on the verdict alone catches it.
    //
    // The flag is part of that picture, not a separate concern. A run that
    // finds the object again clears `missing_since` and touches neither axis
    // (`syncUtils.ts`), so a stale queue card matches on both while the
    // question it asks has been withdrawn — and answering "former" there
    // records as delisted an object the source currently lists, which no
    // detection predicate will ever raise again.
    //
    // Comparing state rather than refusing every decided row is what keeps a
    // verdict correctable. Refusing them wholesale made `former` and `lost`
    // terminal: detection re-flags neither, so one mis-click would remove an
    // object from the product with no remedy short of SQL.
    if (before.source_membership !== expected.membership
      || before.existence !== expected.existence
      || (before.missing_since != null) !== expected.flagged) {
      unusable = await rollbackQuietly(client);
      res.status(409).json({
        error: 'Someone else answered this first — reload to see where it stands',
        sourceMembership: before.source_membership,
        existence: before.existence,
      });
      return;
    }

    const actions = decidedActions(before, nextMembership, nextExistence);
    if (actions.length === 0) {
      // Nothing moved, and the state is the one the curator saw. With a flag
      // standing that is the false alarm — the one verdict with no transition
      // to name. With none, the question was already closed: taking it would
      // write a second `missing_dismissed` and move `state_decided_by` to
      // whoever clicked last.
      if (before.missing_since == null) {
        unusable = await rollbackQuietly(client);
        res.status(409).json({
          error: 'Already answered: this object is not waiting on a decision',
          sourceMembership: before.source_membership,
          existence: before.existence,
        });
        return;
      }
      actions.push('missing_dismissed');
    }

    await client.query(`
      UPDATE experiences
      SET source_membership = $2,
          existence = $3,
          missing_since = NULL,
          state_decided_by = $4,
          state_decided_at = NOW(),
          state_note = $5,
          updated_at = NOW()
      WHERE id = $1
    `, [experienceId, nextMembership, nextExistence, userId, note ?? null]);

    for (const action of actions) {
      await client.query(`
        INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, [experienceId, userId, action, logRegionId, JSON.stringify({
        membership: { old: before.source_membership, new: nextMembership },
        existence: { old: before.existence, new: nextExistence },
        note: note ?? null,
      })]);
    }
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  res.json({
    experienceId,
    sourceMembership: nextMembership,
    existence: nextExistence,
  });
}

/**
 * Name each transition the call actually makes, so the log reads as events
 * rather than as a diff. Empty means nothing moved, which the caller
 * distinguishes: an asserted false alarm is a verdict and gets
 * `missing_dismissed`, while a verdict someone else already recorded is not
 * this curator's to log a second time.
 */
function decidedActions(
  existing: { source_membership: string; existence: string },
  membership: Membership,
  existence: Existence,
): string[] {
  const actions: string[] = [];
  if (membership === 'former' && existing.source_membership !== 'former') actions.push('marked_former');
  if (existence === 'lost' && existing.existence !== 'lost') actions.push('marked_lost');
  // One restoration however many axes it undid — two identical rows would read
  // as two separate decisions.
  const restored = (membership === 'present' && existing.source_membership === 'former')
    || (existence === 'extant' && existing.existence === 'lost');
  if (restored) actions.push('state_restored');
  return actions;
}


/**
 * Apply the value a sync proposed for a field the curator had claimed.
 * POST /api/experiences/:id/accept-source
 * Body: { fields: string[], expectedSyncLogId: number }
 *
 * The upsert refused these values at the time, so they exist only in the
 * changeset. `expectedSyncLogId` names the run the caller was looking at and is
 * required: the proposal is re-resolved under the write lock, and one belonging
 * to a different run is refused rather than substituted. The response names it
 * back, along with which fields were applied now and which were only released.
 */
export async function acceptSourceValue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { fields, expectedSyncLogId } = req.body as {
    fields: string[]; expectedSyncLogId: number;
  };

  if (!Array.isArray(fields) || fields.length === 0) {
    res.status(400).json({ error: 'fields is required' });
    return;
  }

  const expResult = await pool.query(
    `SELECT id, category_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, existing.category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const outcome = await applyProposedFields(experienceId, userId, logRegionId, fields, expectedSyncLogId);
  if (outcome.refusal) {
    res.status(409).json(outcome.refusal);
    return;
  }
  const { applied, released, fromSyncLogId } = outcome;

  res.json({
    experienceId,
    applied,
    // Fields this endpoint cannot write: the claim is gone, so the next run
    // applies the source's value through the ordinary upsert.
    released,
    fromSyncLogId,
  });
}

/**
 * Write the accepted values and release the curator's claim on those fields.
 *
 * Releasing the claim is the point, and it is the whole of the answer for
 * fields this endpoint cannot write. A curator who lets the source have the
 * coordinates cannot type them in — `editExperience` does not offer location at
 * all, and every path that writes `curated_fields` other than this one only
 * ever adds to it. So releasing is what lets the *next run* apply the source's
 * value through the ordinary upsert, and it is the only thing that takes such
 * an item off the queue. For the five writable fields the value is additionally
 * applied now, which is the only difference between the two cases.
 *
 * Everything the decision rests on is read inside the transaction that writes,
 * under the row lock: `curated_fields`, and the proposal itself. Resolving the
 * proposal earlier would leave the endpoint's own guarantee open — a run
 * landing between that read and this lock would have its values written under
 * the run id the curator sent, which is exactly the substitution
 * `expectedSyncLogId` exists to refuse. The claim has the same problem in
 * reverse: the whole column is rewritten, not one element of it, so a value
 * read before the lock discards whatever was claimed in between, and "is this
 * field still claimed?" stops being a guess only once it is asked here.
 */
async function applyProposedFields(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  fields: string[],
  expectedSyncLogId: number,
): Promise<{
  applied: string[];
  released: string[];
  fromSyncLogId: number;
  refusal?: { error: string; fromSyncLogId?: number };
}> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT curated_fields FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    const claimed: string[] = locked.rows[0]?.curated_fields ?? [];

    // Same predicate as the queue, withdrawal check included: a conflict a
    // later run stopped proposing must not be writable here either, or the
    // guard below would refuse a newer proposal while letting a retracted one
    // through.
    const proposal = await client.query(`
      SELECT ch.sync_log_id, ch.changed_fields
      FROM experience_sync_changes ch
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      JOIN experiences e ON e.id = ch.experience_id
      WHERE ch.experience_id = $1
        AND l.is_dry_run = FALSE
        AND ch.changed_fields @> '[{"curatedConflict": true}]'
        AND (e.last_seen_sync_log_id IS NULL
             OR ch.sync_log_id >= e.last_seen_sync_log_id
             OR NOT EXISTS (
               SELECT 1 FROM experience_sync_logs prev
               WHERE prev.id = e.last_seen_sync_log_id AND ${CHANGESET_LANDED_SQL}))
      ORDER BY ch.id DESC
      LIMIT 1
    `, [experienceId]);

    // Awaited at every call site. `return refuse(…)` without it settles the
    // try block immediately, so `finally` releases the client while the
    // ROLLBACK is still in flight on it — and reads `unusable` before this
    // line has run.
    const refuse = async (error: string, fromSyncLogId?: number) => {
      unusable = await rollbackQuietly(client);
      return { applied: [], released: [], fromSyncLogId: fromSyncLogId ?? 0, refusal: { error, fromSyncLogId } };
    };

    if (proposal.rows.length === 0) {
      return await refuse('No source proposal on record for this experience');
    }
    const fromSyncLogId = proposal.rows[0].sync_log_id as number;
    if (fromSyncLogId !== expectedSyncLogId) {
      return await refuse('A newer run has proposed something else — reload to see it', fromSyncLogId);
    }

    const proposed = (proposal.rows[0].changed_fields as Array<{ field: string; new: unknown; curatedConflict?: boolean }>)
      .filter(f => f.curatedConflict && fields.includes(f.field));
    if (proposed.length === 0) {
      return await refuse('The requested fields carry no source proposal');
    }

    // Still-claimed fields only: one released while this request was in flight
    // is an answer someone already gave.
    const open = proposed.filter(p => claimed.includes(claimKeyFor(p.field)));
    if (open.length === 0) {
      return await refuse('None of the requested fields is still an open conflict');
    }

    const writable = open.filter(p => columnFor(p.field) !== null);
    const assignments = writable.map((p, i) => `${columnFor(p.field)} = $${i + 2}`);
    const values = writable.map(p => p.new);
    const remaining = claimed.filter(k => !open.some(p => claimKeyFor(p.field) === k));

    await client.query(
      `UPDATE experiences
       SET ${assignments.map(a => `${a},`).join('\n           ')}
           curated_fields = $${writable.length + 2}::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [experienceId, ...values, JSON.stringify(remaining)],
    );
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'accepted_source', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      fields: open.map(p => ({
        field: p.field,
        applied: columnFor(p.field) !== null ? p.new : undefined,
        appliesAtNextSync: columnFor(p.field) === null || undefined,
      })),
    })]);
    await client.query('COMMIT');
    return {
      applied: writable.map(p => p.field),
      released: open.filter(p => columnFor(p.field) === null).map(p => p.field),
      fromSyncLogId,
    };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

