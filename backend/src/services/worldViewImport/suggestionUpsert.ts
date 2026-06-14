/**
 * Shared upsert for region_match_suggestions (Plan 4a).
 * Dedups one active suggestion per (region_id, division_id) via the partial
 * unique index (migration 007); finders pass skipIfMember to avoid suggesting
 * an already-assigned division. Restore paths pass their explicit `rejected`.
 */
import type { Pool, PoolClient } from 'pg';

export interface SuggestionUpsert {
  regionId: number; divisionId: number; name: string; path: string; score: number;
  rejected?: boolean; geoSimilarity?: number | null;
  conflictType?: string | null; donorRegionId?: number | null; donorDivisionId?: number | null;
  donorRegionName?: string | null; donorDivisionName?: string | null;
  /** Finder calls: skip if the division is already a member of the region. */
  skipIfMember?: boolean;
}

const COLS = `(region_id, division_id, name, path, score, rejected, geo_similarity,
  conflict_type, donor_region_id, donor_division_id, donor_region_name, donor_division_name)`;

const CONFLICT = `
  ON CONFLICT (region_id, division_id) WHERE rejected = false
  DO UPDATE SET
    score = GREATEST(region_match_suggestions.score, EXCLUDED.score),
    geo_similarity = COALESCE(EXCLUDED.geo_similarity, region_match_suggestions.geo_similarity),
    name = EXCLUDED.name,
    path = EXCLUDED.path,
    conflict_type = COALESCE(EXCLUDED.conflict_type, region_match_suggestions.conflict_type),
    donor_region_id = COALESCE(EXCLUDED.donor_region_id, region_match_suggestions.donor_region_id),
    donor_division_id = COALESCE(EXCLUDED.donor_division_id, region_match_suggestions.donor_division_id),
    donor_region_name = COALESCE(EXCLUDED.donor_region_name, region_match_suggestions.donor_region_name),
    donor_division_name = COALESCE(EXCLUDED.donor_division_name, region_match_suggestions.donor_division_name)`;

export async function upsertSuggestion(client: Pool | PoolClient, s: SuggestionUpsert): Promise<void> {
  const params = [
    s.regionId, s.divisionId, s.name, s.path, s.score, s.rejected ?? false, s.geoSimilarity ?? null,
    s.conflictType ?? null, s.donorRegionId ?? null, s.donorDivisionId ?? null,
    s.donorRegionName ?? null, s.donorDivisionName ?? null,
  ];
  const values = `VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
  const fromSelect = `SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    WHERE NOT EXISTS (SELECT 1 FROM region_members rm WHERE rm.region_id = $1 AND rm.division_id = $2)`;
  const body = s.skipIfMember ? fromSelect : values;
  await client.query(`INSERT INTO region_match_suggestions ${COLS}\n${body}\n${CONFLICT}`, params);
}
