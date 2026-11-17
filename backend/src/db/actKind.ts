/**
 * The kind an act of the curation log was about, by the membership its details
 * name (#956). A verdict on an arrival or on a place's standing in a kind logs
 * `details.membershipId` and, for most actions, no kind name: the audit table
 * an admin and a curator read names the kind in its Fact column, as of now.
 * Null where the act names no membership, or its membership is gone.
 */
export function actKindNameSql(log: string): string {
  return `(SELECT k.name
             FROM source_records sr
             JOIN experience_kinds k ON k.id = sr.kind_id
            WHERE jsonb_typeof(${log}.details->'membershipId') = 'number'
              AND sr.id = (${log}.details->>'membershipId')::int)`;
}
