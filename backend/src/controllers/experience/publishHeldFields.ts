/**
 * The held-proposal half of publishing: turning what a run proposed into columns.
 *
 * Its own module because it is its own responsibility, and because it has no
 * dependency on the transaction shell that calls it — no lock, no refusal, no
 * audit row, no pool. What lives here is the answer to one question: given the
 * `changed_fields` a gated run recorded rather than wrote, which columns does
 * publishing assign, and which does it deliberately leave alone? The shapes that
 * makes hard are all per-column — two jsonb columns, one geometry built from a
 * pair, and `metadata`, which no single changeset entry describes.
 *
 * `publishController.ts` holds the other half: the lock, the staleness check, the
 * contents, the released withdrawal, the placement and the audit line.
 */

import { CURATED_KEY_BY_FIELD, METADATA_CLAIM_PREFIX, claimKeyFor } from '../../services/sync/changeSet.js';
import type { PoolClient } from 'pg';

/** One entry of a run's `changed_fields`, as the changeset stores it. */
interface ProposedField {
  field: string;
  old?: unknown;
  new?: unknown;
  curatedConflict?: boolean;
  /** The category's gate kept this write out, and publishing is its answer. */
  held?: boolean;
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

/** What writing the held proposal comes to: the SQL, and what it decided. */
interface HeldFieldWrites {
  assignments: string[];
  /** `$1` is the experience id; the rest is whatever the assignments bound. */
  params: unknown[];
  applied: string[];
  claimedFieldsSkipped: string[];
  /** Held fields this writer cannot produce. Any at all refuses the whole call. */
  unwritable: string[];
  /**
   * The row points at a run whose changeset row is not there.
   *
   * Distinct from "the proposal is empty", which is what an absent row used to
   * be read as: publishing then applied nothing, cleared the pointer and
   * reported success, so a curator was told they had published a proposal whose
   * values were never written and whose record was gone. `accept-source`
   * refuses this case outright (`No source proposal on record for this
   * experience`), and the two endpoints answering the same question differently
   * is how a curator learns not to trust either.
   *
   * Reachable rather than theoretical: `recordSyncChanges` writes a run's whole
   * changeset as one batched insert, and the admin screen has an alert for that
   * insert failing — a run whose pointer landed and whose changeset did not is
   * exactly that failure.
   */
  proposalMissing: boolean;
}

/**
 * Turn the run's held proposal into assignments, deciding what to skip.
 *
 * Reads the changeset inside the caller's transaction, under the lock the caller
 * already holds, so the proposal that is written is the one the pointer named at
 * lock time rather than whatever was newest when the request arrived.
 */
export async function heldFieldWrites(
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
    proposalMissing: false,
  };
  if (pointer === null) return writes;

  const proposal = await client.query(
    `SELECT changed_fields FROM experience_sync_changes
      WHERE experience_id = $1 AND sync_log_id = $2
      ORDER BY id DESC LIMIT 1`,
    [experienceId, pointer],
  );
  if (proposal.rows.length === 0) return { ...writes, proposalMissing: true };
  const proposed = (proposal.rows[0].changed_fields ?? []) as ProposedField[];
  // Only what the *gate* held, and read off the field's own flag rather than
  // inferred from the absence of a claim (#519). A field the curator had claimed
  // is refused for its own reason, carries `curatedConflict`, and is answered
  // through `accept-source`; the queue's `held` card filters on this same flag,
  // so this writes exactly what that card showed and nothing beside it. An
  // elimination here would apply any future third kind of refused write as though
  // the gate had held it, which is the one thing this endpoint must not do: it
  // writes all eleven content columns.
  const held = proposed.filter(field => field.held === true);

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
export function publicationAssignments(before: { curation_state?: unknown }): string[] {
  const assignments = [`curation_state = 'verified'`];
  if (before.curation_state === 'pending') {
    assignments.push('published_at = COALESCE(published_at, NOW())');
  }
  assignments.push('pending_change_sync_log_id = NULL');
  return assignments;
}
