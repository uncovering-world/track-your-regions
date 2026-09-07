/**
 * How a named item in a run's contents record is matched to a stored row.
 *
 * The record names a part, never identifies it: each entry of
 * `contents.<kind>.changed[]` carries `{name, ref}` as the source calls the
 * part, so the record stays legible after the row is renamed (ADR-0026
 * decision 4). Two readers now need the row behind the name — the held card,
 * to open the place on a map or show the work with its picture, and publishing,
 * to write the held field onto it (ADR-0037) — and they have to find the *same*
 * row, or a curator would look at one point and publish onto another. One
 * rule, here, for both.
 *
 * A work is its Wikidata id, `NOT NULL UNIQUE` on `treasures.external_id`, so
 * the reference is the whole answer; the link to this experience is asked for
 * beside it so a request cannot reach a work this object does not hold. A
 * place is harder, and the data says how: some `(experience_id, external_ref)`
 * pairs are duplicated — a component crossing a border is listed once per
 * country under one number — and one location carries no reference at all
 * (`locationWriter.ts` measures both). So the reference narrows and the name
 * decides: among the rows the reference admits, the one whose name matches the
 * record's is preferred. `IS NOT DISTINCT FROM` on the reference is what lets
 * the referenceless point be found at all.
 *
 * The record's name is the name as it stood when the run wrote it
 * (`keptChanges`), and a held row's stored name leaves it for one reason only:
 * a curator corrected it, which always claims `name` on the row
 * (`locationEditController.ts`). So where no row answers to the record's name
 * any more, a row whose name is claimed is a renamed one — and it is the
 * ordinary case, not a corner, since the held card's own dialog offers the
 * rename (#583, #731). Before this term the tie fell to the lowest id, and a
 * curator who corrected uKhahlamba Drakensberg Park (row 7486) from its card
 * saw the card reopen on Sehlabathebe National Park (7485), the other half of
 * Maloti-Drakensberg Park under `985ter-001`, and publishing wrote the run's
 * name onto it (#833, ADR-0050).
 *
 * The lowest id still breaks a tie, but only a tie the *name* admits — the
 * rows that share a name as well as a reference, whose records are identical
 * and always were. A tie among rows the name does *not* admit — more than one
 * sibling carrying a curator's name, or none of them and none matching — is a
 * row nobody can identify, and the answer is nobody: `identified` is
 * false, the card opens nothing for the part, and publishing reports it and
 * leaves it open rather than writing onto whichever sibling has the lower
 * id. A claim carries no date, so "carrying a curator's name" is what the
 * term can tell, not "renamed since the run": a sibling corrected long before
 * the run counts too, and the #833 case then lands here rather than on the
 * right row — the safe answer, and the card stands for the curator to refuse
 * the value or look again. A sole row under the reference is always
 * identified, since there is nothing to confuse it with.
 *
 * Offered rows only, for a point. A point the source has withdrawn is shown to
 * nobody, so a card would open a pin readers cannot see and publishing would
 * write a name onto a row nothing displays; the withdrawn card is that row's
 * question. A work is the other case, and is found through any link this object
 * has, marked or not (ADR-0044): its fields are the work's own, passed once and
 * globally (ADR-0025 decision 2), so a held attribution stays a live question
 * wherever the work now hangs — and the record carrying it lives on this
 * object's row, which is the only card able to reach it. Filtering here would
 * make that proposal unanswerable the day the work moved, a hold nothing could
 * release; publishing the *link* is a different act, and `publishContents` does
 * skip a marked one.
 */

import { venueCountSql } from './experienceLifecycle.js';
import { tidyLabelSql } from '../../services/sync/labelFold.js';

/**
 * The stored point a record entry names, as a query body: `SELECT … FROM
 * (…) AS pick JOIN experience_locations el ON …`, without outer parentheses,
 * so a caller can wrap it as a LATERAL subquery or append `FOR UPDATE OF el`
 * to it — `OF el`, because `pick` reads window functions and a locking clause
 * reaching it is refused.
 *
 * Zero rows where the reference admits none; one row otherwise, carrying
 * `identified` — whether that row is the one the record means (the module
 * note says when it is not). A caller that cannot use an unidentified row
 * filters on it; publishing reads it to say why nothing was written.
 *
 * `experienceId`, `ref` and `name` are SQL expressions — a bound parameter, or
 * a path into the jsonb entry — and never values: nothing here is interpolated
 * from a request.
 *
 * The name is compared by the store rule on both sides (`tidyLabelSql`, #835).
 * A record holds the name as the run saw it (ADR-0026), and a run before the
 * writers tidied saw *marmalo  IV* with two spaces where the row now holds one
 * — migration 047 rewrote the rows and left the records alone, so an open
 * proposal on such a point would otherwise score `named` false for ever, and
 * where its reference admits siblings go unidentified.
 */
export function recordedLocationSql(
  { experienceId, ref, name }: { experienceId: string; ref: string; name: string },
): string {
  return `SELECT el.id, el.name, el.ordinal, el.curated_fields,
                 ST_Y(el.location) AS latitude, ST_X(el.location) AS longitude,
                 pick.identified
            FROM (SELECT w.id,
                         (w.named OR w.candidates = 1 OR (w.renamed AND w.renamed_rows = 1)) AS identified
                    FROM (SELECT cand.id, cand.named, cand.renamed,
                                 count(*) OVER () AS candidates,
                                 count(*) FILTER (WHERE cand.renamed) OVER () AS renamed_rows
                            FROM (SELECT el.id,
                                         ${tidyLabelSql('el.name')}
                                           IS NOT DISTINCT FROM ${tidyLabelSql(name)} AS named,
                                         el.curated_fields ? 'name' AS renamed
                                    FROM experience_locations el
                                   WHERE el.experience_id = ${experienceId}
                                     AND el.external_ref IS NOT DISTINCT FROM ${ref}
                                     AND el.missing_since IS NULL) AS cand
                           ORDER BY cand.named DESC, cand.renamed DESC, cand.id
                           LIMIT 1) AS w) AS pick
            JOIN experience_locations el ON el.id = pick.id`;
}

/**
 * The stored work a record entry names, linked to this experience — the same
 * shape as the point above, for the same two callers, minus the offered term:
 * the link only proves the record reached the right object, and a marked link
 * still does (the module note above says why).
 */
export function recordedTreasureSql(
  { experienceId, ref }: { experienceId: string; ref: string },
): string {
  return `SELECT t.id, t.name, t.artists, t.curated_fields ? 'artists' AS artists_curated,
                 t.year, t.image_url, t.treasure_type,
                 t.curated_fields, t.metadata->'imageCredit' AS image_credit,
                 ${venueCountSql('t')} AS venue_count
            FROM treasures t
            JOIN experience_treasures et ON et.treasure_id = t.id
                                        AND et.experience_id = ${experienceId}
           WHERE t.external_id = ${ref}
           LIMIT 1`;
}
