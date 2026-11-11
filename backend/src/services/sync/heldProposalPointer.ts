/**
 * Which run's proposal a visible membership is holding, said once.
 *
 * `source_records.pending_change_sync_log_id` is what the
 * curator's held card resolves to find the proposal it shows — the
 * membership's since #822, on the membership the run's own source brought —
 * and the writers set it: the object upsert, for a field of the object's own
 * the gate refused to write; the location writer, for a visible point's name
 * (ADR-0037); the point content writer, for a visible point's picture, subtitle
 * and article; and the treasure writer, for a visible work's fields — the
 * writers of parts through `proposeHeldParts`. One statement rather than one
 * per writer, so the predicate cannot drift between them — a membership a
 * reader can see, under a gated source, brought by the source whose run this
 * is, and nothing else.
 *
 * The writers cooperate rather than compete, and the order is what makes that
 * true. The object upsert runs first in every service and, where the object's
 * own fields propose nothing, **clears** the pointer (`experienceUpsert.ts`);
 * the content writers then set it again where they held something. So the
 * column names the newest run that held anything about the object, at either
 * level, and is clear when nothing is held — a proposal a later run withdraws
 * leaves no pointer behind, whichever writer had set it.
 *
 * A run with no log id writes nothing rather than NULL. The id is what a
 * curator's screen resolves to see the proposal, so a run that cannot name
 * itself has nothing to offer the column — and NULL is not "unknown run", it
 * is "nothing is held", which would be a lie about a row whose content this run
 * just held. The same rule the object upsert has always followed.
 *
 * Which membership: the one whose source is the run's, read off the run's own
 * log rather than passed in, so the pointer can only ever name a run of the
 * membership's own source, whatever source a caller believes it writes for. A pending membership never carries a pointer — an
 * arrival is refreshed in place rather than held. A gated second membership of
 * a place another source made visible — a merged place (#1247) — is an arrival
 * whose run is held by the upsert (the hold asks whether a reader can see the
 * place) and gets no pointer and no card here: the question about that source
 * is its arrival, and once that is published the next run proposes the field
 * again, with a card.
 */

import type { PoolClient } from 'pg';
import { MEMBERSHIPS, membershipAdmittedSql, membershipVisibleSql, placeOfferedSql } from '../../db/membership.js';
import type { QueryRunner } from './curationDecay.js';
import type { ContentItemChange } from './types.js';

/**
 * The run a content write belongs to, for the pointer a held field needs.
 *
 * Both content writers take it as a required argument rather than a default:
 * a caller that left it out would hold a visible part's field and never point
 * the object at the run that held it — a proposal recorded in the changeset
 * with no card able to find it. `null` is a run that cannot name itself, which
 * records the hold and withholds the pointer.
 */
export interface WriteRun {
  syncLogId: number | null;
}

/**
 * Point `experienceId` at `syncLogId` as the run whose proposal it is holding.
 *
 * A no-op for a `pending` row — an arrival is refreshed in place rather than
 * held, and its card needs no pointer — and for a trusted source, which holds
 * nothing. Takes the client of a transaction that already holds the place's
 * lock, taken in a statement of its own — the object upsert's, the location
 * writer's, the treasure writer's — and never the pool: the statement decides
 * on the membership's state, and a statement's snapshot predates the lock it
 * waits for, so a lock folded into this UPDATE would choose its rows as they
 * stood before a publish that committed during the wait (`db/locks.ts`).
 */
export async function pointHeldProposalAt(
  runner: QueryRunner,
  experienceId: number,
  syncLogId: number | null,
): Promise<void> {
  if (syncLogId == null) return;
  await runner.query(
    `UPDATE ${MEMBERSHIPS} m SET pending_change_sync_log_id = $2, updated_at = NOW()
       FROM experience_sync_logs run
      WHERE m.experience_id = $1
        AND run.id = $2 AND m.source_id = run.source_id
        AND ${membershipVisibleSql('m')}
        AND EXISTS (
          SELECT 1 FROM experience_sources c
           WHERE c.id = m.source_id AND c.requires_curation
        )`,
    [experienceId, syncLogId],
  );
}

/**
 * What a part writer's run proposes of its rewrites, with the pointer they need.
 *
 * A held field of a point or a work is a proposal a curator finds through the
 * place's pointer (ADR-0037), so the run points the place at itself. A gated
 * run whose own membership refuses a place no kind offers proposes nothing
 * about its parts: no reader sees the place, so the held fields leave the
 * record and the place is not pointed at the run. Where some kind offers the
 * place, its readers see every point and work shown on it, whichever kind
 * placed them, and only the run that placed a part proposes about it, so the
 * refusing run still asks about its own. `REFUSED_WRITER` in
 * `experienceUpsert.ts` is the rule for the place's own fields, which every
 * kind's run proposes.
 *
 * On the writer's client under the place's lock, for the reason
 * `pointHeldProposalAt` gives.
 */
export async function proposeHeldParts(
  client: PoolClient,
  experienceId: number,
  run: { sourceId: number; syncLogId: number | null },
  changed: ContentItemChange[],
): Promise<ContentItemChange[]> {
  if (!changed.some(entry => entry.fields.some(field => field.held))) return changed;
  const unseen = await client.query(
    `SELECT 1 FROM experiences e
       JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
       JOIN experience_sources c ON c.id = m.source_id
      WHERE e.id = $1 AND m.source_id = $2
        AND c.requires_curation AND NOT ${membershipAdmittedSql('m')}
        AND NOT ${placeOfferedSql('e')}`,
    [experienceId, run.sourceId],
  );
  if ((unseen.rowCount ?? 0) > 0) {
    return changed
      .map(entry => ({ ...entry, fields: entry.fields.filter(field => !field.held) }))
      .filter(entry => entry.fields.length > 0);
  }
  await pointHeldProposalAt(client, experienceId, run.syncLogId);
  return changed;
}
