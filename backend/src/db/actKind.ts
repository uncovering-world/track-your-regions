/**
 * The kind an act of the curation log was about (#956, #863). An act about a
 * place's membership in a kind logs the kind itself (`details.kindId`), so the
 * kind stays named after a merge or a separation moved or removed the
 * membership. An entry written before the log recorded the kind is read
 * through the membership it names. Null where the act names neither, or both
 * are gone.
 */
export function actKindNameSql(log: string): string {
  return `COALESCE(
            (SELECT k.name FROM experience_kinds k
              WHERE jsonb_typeof(${log}.details->'kindId') = 'number'
                AND k.id = (${log}.details->>'kindId')::int),
            (SELECT k.name
               FROM source_records sr
               JOIN experience_kinds k ON k.id = sr.kind_id
              WHERE jsonb_typeof(${log}.details->'membershipId') = 'number'
                AND sr.id = (${log}.details->>'membershipId')::int))`;
}
