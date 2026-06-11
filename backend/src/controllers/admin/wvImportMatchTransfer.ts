/**
 * WorldView Import — Transfer endpoints
 *
 * Owns the "accept-with-transfer" workflow (move divisions between regions,
 * either as a direct transfer or by splitting a GADM parent) and the
 * 3-layer GeoJSON preview that backs the admin UI.
 */

import { Response } from 'express';
import { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { invalidateRegionGeometry } from '../worldView/helpers.js';
import { touchWorkUnitForRegion } from '../../services/worldViewImport/workUnits.js';

interface TransferRequestBody {
  regionId: number;
  divisionIds: number[];
  donorRegionId: number;
  donorDivisionId: number;
  transferType: 'direct' | 'split';
}

interface TransferValidationError {
  status: number;
  error: string;
}

async function verifyTransferOwnership(
  client: PoolClient,
  body: TransferRequestBody,
): Promise<TransferValidationError | null> {
  if (body.transferType === 'split') {
    const ownsParent = await client.query(
      'SELECT 1 FROM region_members WHERE region_id = $1 AND division_id = $2',
      [body.donorRegionId, body.donorDivisionId],
    );
    if (ownsParent.rows.length === 0) {
      return { status: 409, error: 'Donor region does not currently own the parent division being split' };
    }
    // Without this guard a crafted body could insert arbitrary division IDs into the target.
    const childrenCheck = await client.query(
      'SELECT id FROM administrative_divisions WHERE parent_id = $1 AND id = ANY($2)',
      [body.donorDivisionId, body.divisionIds],
    );
    if (childrenCheck.rows.length !== body.divisionIds.length) {
      return { status: 400, error: 'One or more divisionIds are not GADM children of donorDivisionId' };
    }
    return null;
  }

  const ownedResult = await client.query(
    'SELECT division_id FROM region_members WHERE region_id = $1 AND division_id = ANY($2)',
    [body.donorRegionId, body.divisionIds],
  );
  if (ownedResult.rows.length !== body.divisionIds.length) {
    return { status: 409, error: 'Donor region does not currently own all listed divisions' };
  }
  return null;
}

async function executeTransferStep(
  client: PoolClient,
  body: TransferRequestBody,
  divisionIdSet: Set<number>,
): Promise<void> {
  if (body.transferType === 'split') {
    await client.query(
      'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
      [body.donorRegionId, body.donorDivisionId],
    );
    const childrenResult = await client.query(
      'SELECT id FROM administrative_divisions WHERE parent_id = $1',
      [body.donorDivisionId],
    );
    const keepIds = (childrenResult.rows as Array<{ id: number }>)
      .map(r => r.id)
      .filter((id: number) => !divisionIdSet.has(id));
    if (keepIds.length > 0) {
      await client.query(
        `INSERT INTO region_members (region_id, division_id)
         SELECT $1, unnest($2::int[])
         ON CONFLICT DO NOTHING`,
        [body.donorRegionId, keepIds],
      );
    }
    return;
  }
  await client.query(
    'DELETE FROM region_members WHERE region_id = $1 AND division_id = ANY($2)',
    [body.donorRegionId, body.divisionIds],
  );
}

async function recomputeDonorMatchStatus(
  client: PoolClient,
  donorRegionId: number,
): Promise<void> {
  const donorMembers = await client.query(
    'SELECT 1 FROM region_members WHERE region_id = $1 LIMIT 1',
    [donorRegionId],
  );
  if (donorMembers.rows.length > 0) return;

  const donorSuggestions = await client.query(
    'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
    [donorRegionId],
  );
  const donorPendingCount = parseInt(donorSuggestions.rows[0].count as string);
  await client.query(
    'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
    [donorPendingCount > 0 ? 'needs_review' : 'no_candidates', donorRegionId],
  );
}

/**
 * Accept divisions with transfer from a donor region.
 * For 'split': removes donor division, re-adds its GADM children minus transferred ones.
 * For 'direct': removes transferred divisions from donor.
 * Both: assigns transferred divisions to target region.
 *
 * POST /api/admin/wv-import/matches/:worldViewId/accept-with-transfer
 */
export async function acceptWithTransfer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const body = req.body as TransferRequestBody;
  const { regionId, divisionIds, donorRegionId, transferType } = body;
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-with-transfer — target=${regionId} donor=${donorRegionId} type=${transferType} divisions=${divisionIds.join(',')}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const regionCheck = await client.query(
      'SELECT id FROM regions WHERE id = ANY($1) AND world_view_id = $2',
      [[regionId, donorRegionId], worldViewId],
    );
    if (regionCheck.rows.length < 2) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region or donor region not found in this world view' });
      return;
    }

    const ownershipError = await verifyTransferOwnership(client, body);
    if (ownershipError) {
      await client.query('ROLLBACK');
      res.status(ownershipError.status).json({ error: ownershipError.error });
      return;
    }

    await executeTransferStep(client, body, new Set(divisionIds));

    // Add transferred divisions to the target region.
    await client.query(
      `INSERT INTO region_members (region_id, division_id)
       SELECT $1, unnest($2::int[])
       ON CONFLICT DO NOTHING`,
      [regionId, divisionIds],
    );

    // Drop accepted suggestions and recompute match statuses.
    await client.query(
      'DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = ANY($2) AND rejected = false',
      [regionId, divisionIds],
    );

    const remainingResult = await client.query(
      'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
      [regionId],
    );
    const remainingCount = parseInt(remainingResult.rows[0].count as string);
    await client.query(
      'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
      [remainingCount > 0 ? 'needs_review' : 'manual_matched', regionId],
    );

    await recomputeDonorMatchStatus(client, donorRegionId);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Post-commit: log geometry-invalidation failures but don't surface a 500.
  // The transfer itself succeeded — a 500 would tempt the admin to retry and
  // double-process. Geometry invalidation can always be re-run safely.
  try {
    await Promise.all([
      invalidateRegionGeometry(regionId),
      invalidateRegionGeometry(donorRegionId),
    ]);
  } catch (geomErr) {
    console.error('[acceptWithTransfer] post-commit geometry invalidation failed:', geomErr);
  }

  // Stale the owning work unit for both the target and the donor.
  await touchWorkUnitForRegion(regionId);
  await touchWorkUnitForRegion(donorRegionId);

  res.json({ transferred: divisionIds.length, transferType });
}

/**
 * Return a 3-layer GeoJSON FeatureCollection for previewing a transfer operation.
 * Features are role-tagged: 'donor' (the division being split), 'moving' (divisions
 * being transferred), and 'target_outline' (the Wikidata geoshape of the target region).
 *
 * POST /api/admin/wv-import/matches/:worldViewId/transfer-preview
 */
export async function getTransferPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { donorDivisionId, movingDivisionIds, wikidataId } = req.body as {
    donorDivisionId: number; movingDivisionIds: number[]; wikidataId: string;
  };

  const result = await pool.query(`
    WITH donor AS (
      SELECT 'donor' AS role, ad.name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ad.geom_simplified_medium), 3)))::json AS geometry
      FROM administrative_divisions ad WHERE ad.id = $1 AND ad.geom_simplified_medium IS NOT NULL
    ),
    moving AS (
      SELECT 'moving' AS role, ad.name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ad.geom_simplified_medium), 3)))::json AS geometry
      FROM administrative_divisions ad WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    ),
    target_outline AS (
      SELECT 'target_outline' AS role, $3::text AS name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(geom), 3)))::json AS geometry
      FROM wikidata_geoshapes WHERE wikidata_id = $3 AND not_available = FALSE
    )
    SELECT role, name, geometry FROM donor
    UNION ALL SELECT role, name, geometry FROM moving
    UNION ALL SELECT role, name, geometry FROM target_outline
  `, [donorDivisionId, movingDivisionIds, wikidataId]);

  const features = result.rows
    .filter(r => r.geometry != null)
    .map(r => ({
      type: 'Feature' as const,
      properties: { role: r.role as string, name: r.name as string },
      geometry: r.geometry,
    }));

  res.json({ type: 'FeatureCollection', features });
}
