/**
 * A curator saying that a reader may see this.
 *
 * Under a gated source (ADR-0025) a run writes what it finds and marks it
 * unread: an arrival lands `curation_state = 'pending'`, invisible to everyone
 * but a curator following it out of the queue, and a proposal against a row
 * that is already visible is kept out of the columns entirely, with
 * `pending_change_sync_log_id` naming the run that made it. Three of the review
 * queue's cards are exactly those situations, and until this endpoint existed
 * none of them could be answered — no other path moves a row off `pending`, and
 * no other path clears that pointer in response to a person.
 *
 * This is the answer, and it is one transaction because the halves are one act:
 * the held values, the unread contents, the row's own state, and the audit line
 * saying who decided. A publication that wrote three of those four would leave
 * the catalogue asserting something nobody said.
 *
 * Shaped after `applyProposedFields` in `lifecycleController.ts`, deliberately
 * and down to the details: everything the decision rests on is re-read under
 * the row lock, every `refuse()` is awaited so `finally` cannot release the
 * client mid-ROLLBACK, and a client whose ROLLBACK also failed is destroyed
 * rather than pooled.
 *
 * `publishContents.ts` holds the question "which rows does a publish reach" —
 * its own module because that question stands on its own, with no dependency
 * on the transaction shell here (no lock, no refusal, no audit row, no scope
 * check).
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishContents } from './publishContents.js';
import { CURATED_KEY_BY_FIELD, METADATA_CLAIM_PREFIX, claimKeyFor } from '../../services/sync/changeSet.js';

/** One entry of a run's `changed_fields`, as the changeset stores it. */
interface ProposedField {
  field: string;
  old?: unknown;
  new?: unknown;
  curatedConflict?: boolean;
}

/**
 * What the curator asked to be published.
 *
 * Three shapes, and each names its own intent rather than leaving one
 * inferred from what is missing — see `publishExperienceBodySchema` for why:
 * absent everything is an object publish, `contentsOnly` is every pending
 * content row with the object untouched, and `locationIds`/`treasureIds` name
 * exactly which rows with the object untouched the same way.
 */
interface PublishRequest {
  locationIds?: number[];
  treasureIds?: number[];
  contentsOnly?: true;
  expectedSyncLogId?: number;
}

interface PublishResult {
  experienceId: number;
  /** The experience's own state after the call — unchanged by a contents publish. */
  curationState: string;
  /** Held fields written now. */
  appliedFields: string[];
  /** Held fields left alone because the curator claims them (see below). */
  claimedFieldsSkipped: string[];
  /** The run whose held proposal was applied, or null when none was held. */
  fromSyncLogId: number | null;
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
}

interface PublishRefusal {
  status: number;
  error: string;
  /** The pointer as the server holds it, so a stale card can redraw itself. */
  pendingChangeSyncLogId?: number | null;
}

/**
 * Do the three fields that share the `metadata` column belong to this field?
 *
 * `CURATED_KEY_BY_FIELD` maps thirteen field names onto eleven columns, and the
 * three that collapse are `metadata`, `metadata.inDanger` and
 * `metadata.dateInscribed` — each carrying a key rather than the whole object.
 * They cannot be written by assignment one at a time, so they are recognised
 * here and resolved together in `nextMetadata`.
 */
function isMetadataField(field: string): boolean {
  return field === 'metadata' || field.startsWith(METADATA_CLAIM_PREFIX);
}

/** A coordinate as the changeset records one, or null if that is not what this is. */
function asCoordinate(value: unknown): { lon: number; lat: number } | null {
  const point = value as { lon?: unknown; lat?: unknown } | null;
  if (!point || typeof point !== 'object') return null;
  if (typeof point.lon !== 'number' || typeof point.lat !== 'number') return null;
  if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return null;
  return { lon: point.lon, lat: point.lat };
}

/**
 * The `SET` clause that writes one proposed field, or null if this endpoint has
 * no assignment for it.
 *
 * The column comes from `CURATED_KEY_BY_FIELD` rather than a second map of the
 * same thing — the upsert honours that map, so a private copy here would drift
 * from what a run actually refused to write. What this adds is per-column
 * *shape*, which the map does not carry: two of the columns are jsonb, one is a
 * geometry built from a pair, and the rest take the value as it stands.
 *
 * `null` is returned for the metadata family (resolved elsewhere), for a field
 * name the map has never heard of, and for a coordinate that is not one. The
 * caller refuses the whole request on the last two rather than publishing around
 * them: clearing the pointer while dropping a value would leave that value
 * proposed by every future run and applied by none, which is the failure this
 * writer exists to close.
 */
function assignmentFor(field: string, value: unknown, bind: (value: unknown) => string): string | null {
  if (isMetadataField(field)) return null;
  const column = CURATED_KEY_BY_FIELD[field];
  if (column === undefined) return null;

  switch (field) {
    // jsonb columns. `JSON.stringify` of an absent value is the string 'null',
    // which lands as jsonb null rather than SQL NULL — exactly what the upsert
    // writes through the same columns, so a published value and a run's own are
    // the same value.
    case 'nameLocal':
    case 'tags':
      return `${column} = ${bind(JSON.stringify(value ?? null))}::jsonb`;
    case 'location': {
      // Checked rather than asserted: `location` is NOT NULL, so an
      // `ST_MakePoint(NULL, NULL)` from a value that is not a pair of numbers
      // would fail the transaction with an error naming neither the field nor
      // the reason. Returning null routes it to the caller's refusal instead,
      // which names the field and leaves the proposal intact to be looked at.
      const point = asCoordinate(value);
      if (!point) return null;
      return `${column} = ST_SetSRID(ST_MakePoint(${bind(point.lon)}, ${bind(point.lat)}), 4326)`;
    }
    default:
      // name, description, short_description, category, image_url,
      // country_codes, country_names. No cast: Postgres infers each
      // parameter's type from the column it is assigned to, which is how the
      // two varchar arrays reach `VARCHAR(10)[]` and `VARCHAR(255)[]` without
      // this code having to know their widths.
      return `${column} = ${bind(value ?? null)}`;
  }
}

/** Keys a curator claimed individually, as bare key names. */
function claimedMetadataKeys(claimed: string[]): string[] {
  return claimed
    .filter(key => key.startsWith(METADATA_CLAIM_PREFIX))
    .map(key => key.slice(METADATA_CLAIM_PREFIX.length));
}

/**
 * The metadata to store, or null when the proposal says nothing about it.
 *
 * The one field that cannot be assigned from what the changeset carries.
 * `computeChangeSet` reports metadata in parts: the keys a product decision
 * hangs on individually, a key the curator claimed individually, and one
 * catch-all for the rest — and it strips the individually reported keys out of
 * *both sides* before diffing the rest. So the catch-all's `new` is not the
 * source's object, it is the source's object minus those keys, and assigning it
 * would delete every one of them.
 *
 * What the catch-all does carry is its `old`: the stored object minus the same
 * stripped keys. A stored key its `old` does not mention is therefore a key the
 * catch-all was not speaking for, and is kept; everything it does speak for is
 * replaced by its `new` wholesale. Then each per-key entry decides its own key.
 *
 * Replacing wholesale rather than merging with `||` is the point of the whole
 * arrangement. A key the source dropped is recorded only by its absence from
 * `new`, so a merge would keep it — the run would propose the same removal for
 * ever and this endpoint would clear the pointer without applying it.
 *
 * Last, whatever the curator claims per key is re-applied from what is stored,
 * mirroring the upsert's own re-application (`syncUtils.ts`) including its
 * condition: only where the stored row still carries the key, because a claim
 * whose key is gone falls straight through there too. The catch-all is what
 * makes this necessary — a claim made *after* the run swallowed the key into
 * the catch-all, so filtering claimed fields out of the proposal cannot reach
 * it, and publishing would quietly overwrite a curator's own link.
 */
function nextMetadata(
  stored: unknown,
  published: ProposedField[],
  claimed: string[],
): Record<string, unknown> | null {
  const entries = published.filter(field => isMetadataField(field.field));
  if (entries.length === 0) return null;

  const left = (stored ?? {}) as Record<string, unknown>;
  const catchAll = entries.find(field => field.field === 'metadata');
  let next: Record<string, unknown>;
  if (catchAll) {
    const spokenFor = (catchAll.old ?? {}) as Record<string, unknown>;
    next = {
      ...Object.fromEntries(Object.entries(left).filter(([key]) => !Object.hasOwn(spokenFor, key))),
      ...((catchAll.new ?? {}) as Record<string, unknown>),
    };
  } else {
    next = { ...left };
  }

  for (const entry of entries) {
    if (entry.field === 'metadata') continue;
    const key = entry.field.slice(METADATA_CLAIM_PREFIX.length);
    // Absent and null are one case here, not two: `computeChangeSet` treats
    // both as absent, so a diff reporting either means the key is going.
    if (entry.new === undefined || entry.new === null) delete next[key];
    else next[key] = entry.new;
  }

  for (const key of claimedMetadataKeys(claimed)) {
    if (Object.hasOwn(left, key)) next[key] = left[key];
  }
  return next;
}

/**
 * Publish an experience, every one of its unread contents, or a named subset.
 * POST /api/experiences/:id/publish
 * Body: { contentsOnly?: true, locationIds?: number[], treasureIds?: number[], expectedSyncLogId?: number }
 *
 * An empty body publishes the object: its held fields, its own state, and
 * every unread point and work it holds — the arrival case. `contentsOnly` or
 * naming either id array makes this a contents publish instead — those rows
 * (all of them, or the named ones) and nothing else, because a visible museum
 * that gained three checked paintings has not thereby been read (ADR-0025
 * § 4.4). See `publishExperienceBodySchema` for why the three shapes are
 * asked for explicitly rather than one of them inferred from the others being
 * absent — that inference is what let a contents-only card publish the object
 * by accident.
 */
export async function publishExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const body = req.body as PublishRequest;

  const expResult = await pool.query(
    `SELECT id, category_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, expResult.rows[0].category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const outcome = await publishUnderLock(experienceId, userId, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...payload } = outcome.refusal;
    res.status(status).json(payload);
    return;
  }
  res.json(outcome.result);
}

/** What writing the held proposal comes to: the SQL, and what it decided. */
interface HeldFieldWrites {
  assignments: string[];
  /** `$1` is the experience id; the rest is whatever the assignments bound. */
  params: unknown[];
  applied: string[];
  claimedFieldsSkipped: string[];
  /** Held fields this writer cannot produce. Any at all refuses the whole call. */
  unwritable: string[];
}

/**
 * Turn the run's held proposal into assignments, deciding what to skip.
 *
 * Reads the changeset inside the caller's transaction, under the lock the caller
 * already holds, so the proposal that is written is the one the pointer named at
 * lock time rather than whatever was newest when the request arrived.
 */
async function heldFieldWrites(
  client: PoolClient,
  experienceId: number,
  pointer: number | null,
  before: { metadata?: unknown },
  claimed: string[],
): Promise<HeldFieldWrites> {
  const params: unknown[] = [experienceId];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const writes: HeldFieldWrites = {
    assignments: [], params, applied: [], claimedFieldsSkipped: [], unwritable: [],
  };
  if (pointer === null) return writes;

  const proposal = await client.query(
    `SELECT changed_fields FROM experience_sync_changes
      WHERE experience_id = $1 AND sync_log_id = $2
      ORDER BY id DESC LIMIT 1`,
    [experienceId, pointer],
  );
  const proposed = (proposal.rows[0]?.changed_fields ?? []) as ProposedField[];
  // Only what the *gate* held. A field the curator had claimed is refused for
  // its own reason, carries `curatedConflict`, and is answered through
  // `accept-source`; the queue's `held` card filters on the same flag, so this
  // writes exactly what that card showed and nothing beside it.
  const held = proposed.filter(field => !field.curatedConflict);

  // A claim made since the run is an answer someone already gave about whose
  // text this is, and publishing answers a different question — may readers see
  // this. So a claimed field is skipped by the writer, and is not a reason to
  // refuse the request: both questions can be open at once.
  writes.claimedFieldsSkipped = held
    .filter(field => claimed.includes(claimKeyFor(field.field)))
    .map(field => field.field);
  const writable = held.filter(field => !writes.claimedFieldsSkipped.includes(field.field));

  for (const field of writable) {
    if (isMetadataField(field.field)) continue;
    const assignment = assignmentFor(field.field, field.new, bind);
    if (assignment === null) writes.unwritable.push(field.field);
    else {
      writes.assignments.push(assignment);
      writes.applied.push(field.field);
    }
  }

  const metadata = nextMetadata(before.metadata, writable, claimed);
  if (metadata !== null) {
    writes.assignments.push(`metadata = ${bind(JSON.stringify(metadata))}::jsonb`);
    writes.applied.push(...writable.filter(field => isMetadataField(field.field)).map(f => f.field));
  }
  return writes;
}

/**
 * Whether the staleness check refuses this call, and the message if so.
 *
 * Split out of `publishUnderLock` on its own — the question "does this call
 * need to match the pointer" is one coherent decision.
 *
 * Will this call actually write a held field? `applied` and `unwritable`
 * between them are exactly the held fields a claim did not already remove —
 * see `heldFieldWrites`, which computes and discards that "writable" set
 * internally — so their combined length is the one question worth asking
 * without a second, driftable copy of that filter: is there anything left of
 * the proposal for this call to be stale *about*.
 *
 * A pointer whose every held field a curator had already claimed leaves that
 * empty. Before this check existed, such a row still ran the staleness
 * comparison unconditionally — and the `contents` card that raised it has no
 * held half to show (it filters on the same flag `heldFieldWrites` does), so
 * its frontend sends no `expectedSyncLogId` and the row 409ed for ever, with
 * no way for a curator to ever discover the run id nothing ever showed them.
 * Per ADR-0025 § 4.4 a publish that writes no held field is not answering the
 * proposal, so there is nothing here for it to be stale about — and it is
 * safe to skip the check rather than merely convenient: the ids
 * `publishContents` uses are re-scoped inside their own statements and only
 * `pending` rows ever flip, so nothing this call still does depends on which
 * run the pointer named.
 *
 * The check also stays live whenever the caller named a run, even one that
 * will write nothing: a caller who names nothing is one who was shown
 * nothing to answer, and skipping the check for them is the fix above. A
 * caller who *did* name a run believed something specific was held, and if
 * the row disagrees — pointer now null, or naming a different run — that
 * belief was wrong and staleness is exactly the word for why, even when
 * nothing was ever going to be written from it. Without this half, "the
 * proposal it was holding has gone" could never fire again: "will write a
 * held field" is always false once the pointer is null, so the branch it
 * guards would be unreachable dead code rather than a real answer to a
 * caller who sent a stale run id.
 */
function staleProposalRefusal(
  write: { applied: string[]; unwritable: string[] },
  pointer: number | null,
  expectedSyncLogId: number | undefined,
): { error: string; pendingChangeSyncLogId: number | null } | null {
  const willWriteHeldFields = write.applied.length > 0 || write.unwritable.length > 0;
  const staleCheckApplies = willWriteHeldFields || expectedSyncLogId !== undefined;
  if (!staleCheckApplies || pointer === (expectedSyncLogId ?? null)) return null;

  return {
    error: pointer === null
      ? 'The proposal this row was holding is gone — reload to see where it stands'
      : 'This row is holding a proposal from a different run — reload to see it',
    pendingChangeSyncLogId: pointer,
  };
}

/**
 * The three assignments that make the row itself published.
 *
 * `published_at` is stamped only where the row was actually invisible until now,
 * which is narrower than `COALESCE(published_at, NOW())` on its own and for a
 * second reason. The first is the New chip: a later pass over an already-visible
 * object must not restart its window, which COALESCE handles. The second is the
 * rows that predate the gate — 1603 of the catalogue's 1604, measured
 * 2026-08-11, visible for months with `published_at` NULL because migration 018
 * deliberately did not date them — where COALESCE would not restart a window but
 * invent one, claiming today as the day a reader could first see something they
 * have been able to see all along.
 *
 * Resolved here rather than as a `CASE` over the pre-update state, because the
 * state was read under the lock and TypeScript can answer it — see
 * `setExperienceAdmission` for what a parameter used as both a value and a
 * comparand costs. COALESCE stays inside the branch as a floor: nothing today
 * can return a published row to `pending`, so it is unreachable rather than
 * wrong.
 *
 * Clearing the pointer is the line that makes a `held` card answerable at all.
 * Before it, only a later run proposing nothing ever cleared one.
 */
function publicationAssignments(before: { curation_state?: unknown }): string[] {
  const assignments = [`curation_state = 'verified'`];
  if (before.curation_state === 'pending') {
    assignments.push('published_at = COALESCE(published_at, NOW())');
  }
  assignments.push('pending_change_sync_log_id = NULL');
  return assignments;
}

/**
 * The publication itself, in one transaction under the row lock.
 *
 * Everything the decision rests on is read in here rather than before: the
 * pointer that says which run's proposal is being held, the proposal itself,
 * the claims that decide which of its fields this call may write, and the state
 * that decides whether `published_at` is this row's first. Read earlier, a run
 * or another curator landing in between would have its values written under the
 * run id this caller sent — the substitution `expectedSyncLogId` exists to
 * refuse — and a claim made in that window would be silently overwritten.
 */
async function publishUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  body: PublishRequest,
): Promise<{ result?: PublishResult; refusal?: PublishRefusal }> {
  const { locationIds, treasureIds, contentsOnly: bareContentsOnly, expectedSyncLogId } = body;
  // Three ways a body can ask for contents only, all mutually exclusive by the
  // schema's `.refine` — the bare flag for "every pending row, object
  // untouched", or naming either array. Object and contents publish are one
  // endpoint because they are one transaction shape and one audit action; they
  // differ only in whether the experience's own row — its held fields, its
  // state, its pointer — is part of what is answered.
  const contentsOnly = bareContentsOnly === true || locationIds !== undefined || treasureIds !== undefined;

  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');

    // Awaited at every call site. `return refuse(…)` without it settles the try
    // block immediately, so `finally` releases the client while the ROLLBACK is
    // still in flight on it — and reads `unusable` before it has been assigned.
    const refuse = async (
      status: number, error: string, pendingChangeSyncLogId?: number | null,
    ): Promise<{ refusal: PublishRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal: { status, error, pendingChangeSyncLogId } };
    };

    const locked = await client.query(
      `SELECT curation_state, curated_fields, metadata, admission, pending_change_sync_log_id
         FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    const before = locked.rows[0];
    // The existence check in the handler ran on the pool, on another connection
    // and earlier in time. A row deleted in that window leaves nothing to lock,
    // and reading `curated_fields` off it would answer 500 to a question whose
    // true answer is 404.
    if (!before) return await refuse(404, 'Experience not found');

    // ADR-0025 decision 4, "Admission is asked before publication": whether an
    // object belongs in this catalogue at all is a question a category's own
    // rule answers (ADR-0024), and whether anyone has looked at it yet is a
    // different question, "asked only once the first has been answered yes".
    // Publishing a refused row asks the second question first — which is
    // exactly what the review queue refuses to do from the other side, where
    // every one of the gate's three kinds carries `hideRefusedSql()` so a
    // refused row raises no card asking whether a reader may see it.
    //
    // Left unrefused this is not a tidiness problem. The row would leave
    // `arrivals` for ever — nothing returns a `verified` row to `pending` — so a
    // later `override` on the refusal would put it in front of readers with
    // nobody having reviewed its contents, and the New-chip window would start
    // ticking while nothing could see it. The way through is the other order:
    // answer the refusal at `POST /:id/admission`, where an `override` publishes
    // in the same transaction.
    //
    // Refused for a contents publish too, and for the same reason: a refused
    // museum's unread paintings raise no `contents` card either, because that
    // query carries `hideRefusedSql()` on the container.
    if (before.admission === 'refused') {
      return await refuse(409,
        'This row was turned down by its category — answer the refusal first, and putting it back publishes it');
    }

    const claimed: string[] = before.curated_fields ?? [];
    let applied: string[] = [];
    let claimedFieldsSkipped: string[] = [];
    let heldFrom: number | null = null;

    if (!contentsOnly) {
      const pointer = (before.pending_change_sync_log_id as number | null) ?? null;
      // The staleness question in one comparison, with "named nothing" reading
      // as "this row was holding nothing" — which is what an arrival looks like
      // and what a row whose proposal a later run withdrew no longer does. A
      // newer run overwrites the pointer, so equality with it is the whole test;
      // there is nothing to compare against the newest changeset, as
      // `accept-source` does, because the card names the run the pointer names.
      //
      // Refusing when the caller named nothing and a proposal has since arrived
      // matters as much as the other direction: publishing then would either
      // apply values the curator never saw or clear the pointer without applying
      // them, and the second loses the proposal for good.
      //
      // What this cannot cover, so that nobody assumes it does: **an arrival has
      // no staleness check available at all.** A `pending` row never holds a
      // pointer — `syncUtils.ts` sets one only `WHERE curation_state <>
      // 'pending'` — because a row nobody can see is refreshed in place instead
      // of held (sub-branch 1's decision, and the right one: the curator should
      // review the newest state, not whatever landed first). So a run that
      // rewrites an arrival between the card being drawn and this click is
      // invisible to the curator and to this comparison alike, and what gets
      // published is the newest state rather than the state on the card. Nothing
      // in the schema records what the card showed, so there is nothing here to
      // compare; changing that is a decision about arrivals, not about this
      // endpoint.
      //
      // Read before the question is even asked, because the answer now depends
      // on it: `heldFieldWrites` needs only the stored pointer, never
      // `expectedSyncLogId`, so computing it first leaks nothing to a caller the
      // check might still refuse. See `staleProposalRefusal` for what decides
      // whether the check applies at all — a pointer whose one held field a
      // curator already claimed writes nothing, and per ADR-0025 § 4.4 there is
      // nothing for such a call to be stale about.
      const write = await heldFieldWrites(client, experienceId, pointer, before, claimed);
      const staleness = staleProposalRefusal(write, pointer, expectedSyncLogId);
      if (staleness) {
        return await refuse(409, staleness.error, staleness.pendingChangeSyncLogId);
      }
      heldFrom = pointer;

      if (write.unwritable.length > 0) {
        // Nothing held may be dropped in silence. Clearing the pointer over a
        // value this code could not write would leave that value proposed by
        // every run from here on and applied by none — the escape the gate
        // closes for `accept-source`'s six unwritable fields, reopened. Reached
        // today only by a coordinate the changeset did not record as a pair of
        // numbers; a field name outside `CURATED_KEY_BY_FIELD` would land here
        // too, which is why a test feeds this endpoint every field
        // `computeChangeSet` can actually emit and requires all of them to be
        // applied. Iterating the map instead would prove nothing: the map is the
        // side that could be missing an entry.
        //
        // A field in that position is unanswerable, not merely unapplied — the
        // refusal leaves the pointer standing, so the card cannot be cleared by
        // any route. That is the deliberate trade (no value is ever dropped in
        // silence) and the reason the test guards the differ rather than the map.
        return await refuse(409,
          `Publishing cannot write what this run proposed for ${write.unwritable.join(', ')} — nothing was published`,
          pointer);
      }
      applied = write.applied;
      claimedFieldsSkipped = write.claimedFieldsSkipped;

      await client.query(
        `UPDATE experiences
         SET ${[...write.assignments, ...publicationAssignments(before)].join(',\n             ')},
             updated_at = NOW()
         WHERE id = $1`,
        write.params,
      );
    }

    const { locationsPublished, treasureLinksPublished, treasuresPublished } =
      await publishContents(client, experienceId, locationIds, treasureIds);

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'published', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      // Which of the two publishes this was, said in the log rather than
      // inferred from which counts are zero: publishing an object that happens
      // to hold no unread contents and publishing named contents that were all
      // published already look identical from the numbers.
      scope: contentsOnly ? 'contents' : 'object',
      fields: applied,
      claimedFieldsSkipped,
      fromSyncLogId: heldFrom,
      locations: locationsPublished,
      treasureLinks: treasureLinksPublished,
      treasures: treasuresPublished,
    })]);

    await client.query('COMMIT');

    // No placement here, and not by oversight. Placement's insert predicate is
    // `el.missing_since IS NULL` and nothing else — it filters neither
    // `curation_state` nor `admission` nor `existence` — so a `pending` location
    // was already placed by the run that wrote it, and flipping it to `verified`
    // moves no geometry, no point and no membership. Publishing a held content
    // field cannot move it either: placement reads
    // `experience_locations.location`, never `experiences.location`, and no
    // trigger connects the two.
    //
    // The one publish that would genuinely change placement is one that released
    // a deferred withdrawal, because the old point stops being offered and the
    // clear is unfiltered while the insert is not. Nothing defers a withdrawal
    // yet (Task 6 of this branch adds it), so there is nothing to place.
    //
    // Left as a comment rather than an unconditional call because "publish
    // places" reads as the obvious symmetry: run 53 created 18 museums, and
    // placing them all on publish would delete and reinsert region rows across
    // every world view with geometry for no change at all. When a withdrawal can
    // be released, `assignRegionsForExperiences` goes here — after the COMMIT and
    // off this client, since it opens a transaction of its own — and reports
    // failure rather than throwing, the way `recordPlacementFailure` downgrades a
    // run to `partial`: a placement failure must not undo a publication.

    return {
      result: {
        experienceId,
        curationState: contentsOnly ? (before.curation_state as string) : 'verified',
        appliedFields: applied,
        claimedFieldsSkipped,
        fromSyncLogId: heldFrom,
        locationsPublished,
        treasureLinksPublished,
        treasuresPublished,
      },
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
