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
 * place is harder, and the data says how: nine `(experience_id, external_ref)`
 * pairs are duplicated — a component crossing a border is listed once per
 * country under one number — and one location carries no reference at all
 * (`locationWriter.ts` measures both). So the reference narrows and the name
 * decides: among the rows the reference admits, the one whose name matches the
 * record's is preferred, and the lowest id breaks a tie the same way for every
 * reader. `IS NOT DISTINCT FROM` on the reference is what lets the
 * referenceless point be found at all.
 *
 * Offered rows only. A row the source has withdrawn is shown to nobody, so a
 * card would open a pin readers cannot see and publishing would write a name
 * onto a row nothing displays; the withdrawn card is that row's question.
 */

/**
 * The stored point a record entry names, as a query body: `SELECT … FROM
 * experience_locations el WHERE … ORDER BY … LIMIT 1`, without outer
 * parentheses, so a caller can wrap it as a LATERAL subquery or append
 * `FOR UPDATE` to it.
 *
 * `experienceId`, `ref` and `name` are SQL expressions — a bound parameter, or
 * a path into the jsonb entry — and never values: nothing here is interpolated
 * from a request.
 */
export function recordedLocationSql(
  { experienceId, ref, name }: { experienceId: string; ref: string; name: string },
): string {
  return `SELECT el.id, el.name, el.ordinal, el.curated_fields,
                 ST_Y(el.location) AS latitude, ST_X(el.location) AS longitude
            FROM experience_locations el
           WHERE el.experience_id = ${experienceId}
             AND el.external_ref IS NOT DISTINCT FROM ${ref}
             AND el.missing_since IS NULL
           ORDER BY (el.name IS NOT DISTINCT FROM ${name}) DESC, el.id
           LIMIT 1`;
}

/**
 * The stored work a record entry names, held by this experience — the same
 * shape as the point above, for the same two callers.
 */
export function recordedTreasureSql(
  { experienceId, ref }: { experienceId: string; ref: string },
): string {
  return `SELECT t.id, t.name, t.artists, t.curated_fields ? 'artists' AS artists_curated,
                 t.year, t.image_url, t.treasure_type,
                 t.curated_fields, t.metadata->'imageCredit' AS image_credit
            FROM treasures t
            JOIN experience_treasures et ON et.treasure_id = t.id
                                        AND et.experience_id = ${experienceId}
           WHERE t.external_id = ${ref}
           LIMIT 1`;
}
