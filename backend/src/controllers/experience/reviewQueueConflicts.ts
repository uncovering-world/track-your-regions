/**
 * The conflict card's statement: a source proposing a value a curator's claim
 * refused, while it is still the source's current position and still unanswered.
 *
 * In a module of its own for the reason `reviewQueueContents.ts` is: it is the
 * largest statement the queue sends, and the only one that reads the curation
 * log per field — who claimed the field, and what was decided about it before —
 * so it carries the log's scope predicate as well as the object's. Like the
 * other card statements, it takes the fragments the handler built and this
 * kind's ids on the page the keys phase chose, and returns the rows.
 */

import { pool } from '../../db/index.js';
import { rowKindJoinSql } from '../../db/membership.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import type { QueryResult } from 'pg';
import { CLAIM_KEY_BY_FAMILY, CURATED_KEY_BY_FIELD } from '../../services/sync/changeSet.js';
import { ACCEPTABLE_FIELDS } from './acceptableFields.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { claimKeySql, conflictChangeOpenSql } from './reviewQueuePredicates.js';
import type { QueueQueryContext } from './reviewQueueContents.js';

/**
 * The conflict cards for `ids`.
 *
 * A conflict is worth answering only while it is still the source's current
 * position, so the newest changeset row for the experience wins — and only
 * while the curator still claims the field. Accepting the source releases
 * that claim, which is what takes the item out of the queue: the changeset
 * row stays as a record of what the run did, so nothing else would.
 *
 * The claim key is usually the column name, but not always: editing only a
 * website claims `metadata.website`, which is no column at all. Hence the
 * map, and hence the fallback to the field's own name for the keys it does
 * not carry. Between the two sits the family lookup, for the per-part entries
 * of a column claimed whole: `nameLocal.ko` is protected by a claim on
 * `name_local` and by nothing a per-key name could match (#728). Each field
 * also says whether `accept-source` can write it — `location` and the rest
 * are shown but not offered, since a button that 409s would leave the item
 * unanswerable.
 *
 * Three lookups in one expression, built here rather than written out at each
 * of the two sites below: this is `claimKeyFor` in SQL, and the two runtimes
 * read the same two objects (`changeSet.ts`) so neither can drift into
 * protecting what the other asks about. `split_part` answers the whole name
 * where there is no dot, exactly as `field.split('.')[0]` does, so the family
 * is consulted for a bare name too and the map simply answers first; and the
 * family object deliberately does not carry `metadata`, whose claims are per key.
 * The COALESCE itself is `claimKeySql` (`reviewQueuePredicates.ts`), shared
 * with `reviewQueueKeys.ts`'s own `claimKey` — only the two placeholder
 * strings differ, since each statement binds `$keyMap`/`$family` its own way.
 *
 * `logScopeFilter` is the log's own scope predicate, built in the handler: the
 * two subqueries below read the log, so they carry the predicate
 * `getCurationLog` does (the handler's comment on it says why).
 */
export async function queryConflicts(
  { scopeFilter, sourceFilter, params, ids, logScopeFilter }: QueueQueryContext & { logScopeFilter: string },
): Promise<QueryResult> {
  const keyMapIdx = params.length + 1;
  const familyIdx = keyMapIdx + 1;
  const acceptableIdx = familyIdx + 1;
  const claimKeyFor = (field: string) => claimKeySql(field, `$${keyMapIdx}`, `$${familyIdx}`);
  return pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT * FROM (
      SELECT DISTINCT ON (e.id)
             e.id, e.external_id, e.name, e.source_id, mk.kind_id, kd.name AS kind_name,
             ${lifecycleSelectSql()}, ${objectContextSelectSql()},
             'conflict' AS kind, ch.sync_log_id,
             -- When the run that is asking finished. The card names a run either
             -- way; a curator deciding whose text is newer needs the date, and
             -- reading it off the log is the only place it exists.
             l.completed_at AS run_completed_at,
             (SELECT jsonb_agg(f || jsonb_build_object(
                       'acceptable', $${acceptableIdx}::jsonb ? (f->>'field'),
                       -- Who claimed this field and when, so the button stops
                       -- saying "my edit" about another curator's work. The
                       -- claim itself is a set membership in curated_fields and
                       -- carries no author; the act that put it there is a log
                       -- entry keyed by the *column* name, which is what the same
                       -- map above translates to.
                       --
                       -- Two actions can put a key there, not one. A correction
                       -- to a single-point object's own point claims location on
                       -- the experience and records location_edited
                       -- (ADR-0029 decision 6), so matching edited alone left
                       -- exactly that claim unattributed — and it is the ordinary
                       -- path, not a corner: one corrected UNESCO site raises a
                       -- conflict card on every run afterwards. That card would
                       -- then ask a curator to choose between two coordinates
                       -- without saying whose the standing one is, which is the
                       -- state this subquery exists to end.
                       --
                       -- But narrowly, because a key in the details is not a
                       -- claim on the *object*. A point rename writes a name key
                       -- and claims nothing here — the anchor branch is the only
                       -- writer of experiences.curated_fields in that endpoint
                       -- and only ever adds location — so a widening on the
                       -- action alone let the newest point rename outrank the
                       -- edit that really claimed the museum's name, and the card
                       -- would name a curator who never made that claim. The
                       -- anchorMoved flag is exactly "this act put location into
                       -- the experience's claim set", which is the question.
                       'claim', (
                         SELECT jsonb_build_object(
                                  'by', COALESCE(NULLIF(regexp_replace(u.display_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), 'a curator'),
                                  'at', log.created_at)
                           FROM experience_curation_log log
                           JOIN users u ON u.id = log.curator_id
                          WHERE log.experience_id = e.id
                            AND (log.action = 'edited'
                              OR (log.action = 'location_edited'
                                  AND f->>'field' = 'location'
                                  AND (log.details->>'anchorMoved')::boolean))
                            AND log.details ? ${claimKeyFor(`f->>'field'`)}
                            AND ${logScopeFilter}
                          ORDER BY log.created_at DESC, log.id DESC
                          LIMIT 1),
                       -- What was decided about this field before, newest first.
                       -- A curator meeting the same field a third time is owed
                       -- the answers already given to it — both kinds. Refusals
                       -- are read here too, and carry the action, because "took
                       -- the source's value" and "kept theirs" are the two
                       -- halves of the same history and a trail showing one of
                       -- them says the field was answered once when it was
                       -- answered twice.
                       'decidedBefore', COALESCE((
                         SELECT jsonb_agg(jsonb_build_object(
                                  'by', COALESCE(NULLIF(regexp_replace(u.display_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), 'a curator'),
                                  'at', log.created_at,
                                  'action', log.action,
                                  'applied', COALESCE(d->>'applied', d->>'declined'))
                                ORDER BY log.created_at DESC)
                           FROM experience_curation_log log
                           JOIN users u ON u.id = log.curator_id
                           CROSS JOIN LATERAL jsonb_array_elements(
                                  COALESCE(log.details->'fields', '[]'::jsonb)) d
                          WHERE log.experience_id = e.id
                            AND log.action IN ('accepted_source', 'declined_source')
                            AND d->>'field' = f->>'field'
                            AND ${logScopeFilter}), '[]'::jsonb)))
               FROM jsonb_array_elements(ch.changed_fields) f
               WHERE (f->>'curatedConflict')::boolean
                 AND e.curated_fields ? ${claimKeyFor(`f->>'field'`)}
                 -- ...and the curator has not already answered *this* proposal. By
                 -- value, not by field: a refusal says "not that text", and a source
                 -- that comes back with different text is asking a new question, which
                 -- is the one case a suppressed card must not swallow. The field name
                 -- here is the changeset's own, since that is what the decision
                 -- recorded — no claim-key translation, unlike the line above.
                 --
                 -- COALESCE because a proposal can carry no value at all: a source that
                 -- stops publishing a claimed metadata key proposes undefined, which
                 -- JSON.stringify drops from the row, and the entry is still an ordinary
                 -- conflict. The refusal stores a jsonb null for it, so comparing against
                 -- SQL NULL would answer NULL, never true — that class of card
                 -- would come back after a refusal that reported success, which is the
                 -- exact failure this design exists to prevent. Both sides now agree on
                 -- the missing case.
                 AND NOT EXISTS (
                   SELECT 1 FROM experience_conflict_decisions d
                    WHERE d.experience_id = e.id
                      AND d.field = f->>'field'
                      AND d.declined = COALESCE(f->'new', 'null'::jsonb))
             ) AS proposed
      FROM experience_sync_changes ch
      JOIN experiences e ON e.id = ch.experience_id
      ${rowKindJoinSql('e', 'mk', 'kd')}
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      -- conflictChangeOpenSql (reviewQueuePredicates.ts) is the newest-row,
      -- landed-run test; its docblock has the reasoning for the staleness
      -- clause.
      WHERE ${conflictChangeOpenSql('e', 'ch', 'l')}
        ${sourceFilter}
        AND ${scopeFilter}
        -- Inside the DISTINCT ON rather than outside it: the pick is per
        -- experience, so narrowing to the page's ids first leaves the same newest
        -- changeset row per id and reads a handful of rows instead of every
        -- conflict in the catalogue.
        AND e.id = ANY($${acceptableIdx + 1}::int[])
      ORDER BY e.id, ch.id DESC
    ) q
    WHERE q.proposed IS NOT NULL
    ORDER BY q.id
  `, [...params, JSON.stringify(CURATED_KEY_BY_FIELD), JSON.stringify(CLAIM_KEY_BY_FAMILY),
    JSON.stringify([...ACCEPTABLE_FIELDS]), ids]);
}
