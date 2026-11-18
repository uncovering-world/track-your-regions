/**
 * The curation log's one writer (#863): every act a curator takes on a place,
 * and the three the catalogue takes in its own name, is recorded here, inside
 * the caller's transaction, so an act and its record stand or fall together.
 * The lint refuses a write to `experience_curation_log` anywhere else.
 *
 * What a row carries beyond who, what, where and when is composed here rather
 * than by each caller, so no caller can leave it out or spell it differently:
 *
 * - an act about a place's membership in a kind names the membership and the
 *   kind (`details.membershipId`, `details.kindId`). A place belongs to several
 *   kinds at once, so what curators decided about one kind's rule is grouped by
 *   the kind the act was about, never by the place or its first source (#819);
 * - the reason the curator picked (`details.reasonCode`), a code of
 *   `CURATION_REASON_CODES`, beside their own words where they wrote some
 *   (`details.note`, a caller's detail);
 * - an act one click made over many places (`details.bulk`): a publish of
 *   everything waiting, or one answer over a selection of many in the review
 *   feed (`bulkOf` in `reviewAnswerDispatch.ts`), with the run it released or
 *   answered where it has one (`details.syncLogId`), so a considered act is
 *   told from a bulk one in one query. A considered act carries neither key.
 *
 * A row with nothing to say beyond its columns keeps `details` null.
 */

import type { PoolClient } from 'pg';
import type { CurationLogAction, CurationReasonCode } from '@tyr/shared/curationLog';

/**
 * The acts the schema lets name no curator (`experience_curation_log_curator_check`):
 * a merge of two places on one Wikidata item, an exact component candidate
 * accepted by its rule, and a near pair Wikidata answers "part of".
 */
type CatalogueOwnAction = 'merged' | 'component_items_answered' | 'merge_proposal_answered';

/** Who acted: a curator always, but on the catalogue's own acts. */
type ByWhom =
  | { action: CatalogueOwnAction; curatorId: number | null }
  | { action: Exclude<CurationLogAction, CatalogueOwnAction>; curatorId: number };

/** The membership an act is about: a place's record in a kind (`source_records`), and that kind. */
export interface ActMembership {
  id: number;
  kindId: number;
}

/**
 * The membership a caller read beside its act, as `membership_id` and
 * `kind_id`; none where the row holds no membership in a kind.
 */
export function membershipRead(
  row: { membership_id?: unknown; kind_id?: unknown } | undefined,
): ActMembership | undefined {
  const id = row?.membership_id;
  const kindId = row?.kind_id;
  return typeof id === 'number' && typeof kindId === 'number' ? { id, kindId } : undefined;
}

/** The keys this writer owns; a caller's own details may not spell them. */
type OwnedKeys = 'membershipId' | 'kindId' | 'reasonCode' | 'bulk' | 'syncLogId';

/** One act, as a caller states it. */
export type CurationAct = ByWhom & {
  experienceId: number;
  /**
   * Where the curator was working: the region an act on a region names, else
   * the region the curator had open when acting, else, for an act sent with
   * none, the region the caller's scope check found; null or absent where no
   * region applies.
   */
  regionId?: number | null;
  /** Set on every act about a membership in a kind. */
  membership?: ActMembership;
  reasonCode?: CurationReasonCode;
  /** Set on an act one click made over many places: the run it released or answered, or null. */
  bulk?: { syncLogId: number | null };
  /** What the act changed, in the caller's words. */
  details?: Record<string, unknown> & { [key in OwnedKeys]?: never };
};

/** The row's `details`, composed: the caller's, then the keys this writer owns. */
function detailsOf(act: CurationAct): string | null {
  const details: Record<string, unknown> = { ...act.details };
  if (act.membership) {
    details.membershipId = act.membership.id;
    details.kindId = act.membership.kindId;
  }
  if (act.reasonCode !== undefined) details.reasonCode = act.reasonCode;
  if (act.bulk) {
    details.bulk = true;
    if (act.bulk.syncLogId !== null) details.syncLogId = act.bulk.syncLogId;
  }
  return Object.keys(details).length > 0 ? JSON.stringify(details) : null;
}

/**
 * The act's region as the row records it: one that no longer exists is
 * recorded as none, as the foreign key's `ON DELETE SET NULL` would have left
 * it. The region a curator had open arrives from the web, and a region deleted
 * while the page was open must not fail the act it only describes.
 */
const regionSql = (expr: string) => `(SELECT r.id FROM regions r WHERE r.id = ${expr})`;

/** Record one act, in the caller's transaction. */
export async function logCurationAct(client: PoolClient, act: CurationAct): Promise<{ id: number }> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
     VALUES ($1, $2, $3, ${regionSql('$4::int')}, $5)
     RETURNING id`,
    [act.experienceId, act.curatorId, act.action, act.regionId ?? null, detailsOf(act)],
  );
  return result.rows[0];
}

/**
 * Record several acts in one statement, in the caller's transaction: a batch
 * that decided many rows at once, or one act recorded on each place it
 * touched. Answers the rows written, each with its place, for a caller to
 * find its own by.
 */
export async function logCurationActs(
  client: PoolClient, acts: readonly CurationAct[],
): Promise<{ id: number; experience_id: number }[]> {
  if (acts.length === 0) return [];
  const result = await client.query<{ id: number; experience_id: number }>(
    `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
     SELECT t.experience_id, t.curator_id, t.action, ${regionSql('t.region_id')}, t.details
       FROM unnest($1::int[], $2::int[], $3::text[], $4::int[], $5::jsonb[])
            AS t(experience_id, curator_id, action, region_id, details)
     RETURNING id, experience_id`,
    [
      acts.map(act => act.experienceId),
      acts.map(act => act.curatorId),
      acts.map(act => act.action),
      acts.map(act => act.regionId ?? null),
      acts.map(detailsOf),
    ],
  );
  return result.rows;
}
