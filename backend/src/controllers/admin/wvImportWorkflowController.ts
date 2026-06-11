/**
 * WorldView Import Workflow Controller (import-review redesign).
 *
 * Work-unit lifecycle endpoints: verify, sign-off, reopen, flag toggles,
 * reference territory, skeleton confirmation.
 * Spec: docs/tech/planning/import-review-workflow-redesign.md
 */
import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { verifyWorkUnit, type VerifyBlocker } from '../../services/worldViewImport/verifyWorkUnit.js';
import { touchWorkUnitForRegion } from '../../services/worldViewImport/workUnits.js';

type SignOffBlocker = VerifyBlocker | 'hierarchy_not_confirmed';

/** Load a work-unit row scoped to the world view; null = not found (IDOR guard). */
async function loadWorkUnit(worldViewId: number, regionId: number): Promise<{ hierarchy_confirmed: boolean } | null> {
  const result = await pool.query(
    `SELECT ris.hierarchy_confirmed
     FROM region_import_state ris
     JOIN regions r ON r.id = ris.region_id
     WHERE ris.region_id = $1 AND r.world_view_id = $2 AND ris.is_work_unit = TRUE`,
    [regionId, worldViewId],
  );
  return result.rows[0] ?? null;
}

/** GET /wv-import/matches/:worldViewId/verify/:regionId */
export async function getWorkUnitVerification(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.params.regionId));
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  const result = await verifyWorkUnit(worldViewId, regionId);
  res.json(result);
}

/** POST /wv-import/matches/:worldViewId/sign-off  { regionId } */
export async function signOffWorkUnit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = req.body.regionId as number;
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }

  const verify = await verifyWorkUnit(worldViewId, regionId);
  const blockers: SignOffBlocker[] = [...verify.blockers];
  if (!unit.hierarchy_confirmed) blockers.unshift('hierarchy_not_confirmed');
  if (blockers.length > 0) {
    res.status(409).json({ blockers, verify });
    return;
  }

  // Known TOCTOU window (accepted): a mutation landing during the
  // seconds-long verify commits, its chokepoint touch no-ops (status is
  // already in_progress), and this UPDATE then signs off against a stale
  // verify. Single-operator tool by design (see spec Risks). If multi-admin
  // ever matters: add a last_touched_at column bumped by the chokepoint and
  // gate this UPDATE on last_touched_at <= verify start.
  const result = await pool.query(
    `UPDATE region_import_state
     SET signoff_status = 'signed_off', signed_off_at = NOW()
     WHERE region_id = $1
     RETURNING signed_off_at`,
    [regionId],
  );
  res.json({ success: true, signedOffAt: result.rows[0]?.signed_off_at ?? null });
}

/** POST /wv-import/matches/:worldViewId/reopen  { regionId } */
export async function reopenWorkUnit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = req.body.regionId as number;
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  await pool.query(
    `UPDATE region_import_state
     SET signoff_status = 'in_progress', signed_off_at = NULL
     WHERE region_id = $1`,
    [regionId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/work-unit  { regionId, isWorkUnit } */
export async function setWorkUnitFlag(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, isWorkUnit } = req.body as { regionId: number; isWorkUnit: boolean };
  const owned = await pool.query(
    `SELECT 1 FROM regions WHERE id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  if (owned.rows.length === 0) { res.status(404).json({ error: 'Region not found in this world view' }); return; }
  // Demotion resets the sign-off lifecycle: stale signoff fields on
  // non-units would leak into dashboards if the node is later re-promoted.
  await pool.query(
    isWorkUnit
      ? `INSERT INTO region_import_state (region_id, is_work_unit)
         VALUES ($1, TRUE)
         ON CONFLICT (region_id) DO UPDATE SET is_work_unit = TRUE`
      : `UPDATE region_import_state
         SET is_work_unit = FALSE, signoff_status = 'not_started', signed_off_at = NULL
         WHERE region_id = $1`,
    [regionId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/confirm-hierarchy  { regionId, confirmed } */
export async function confirmHierarchy(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, confirmed } = req.body as { regionId: number; confirmed: boolean };
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  await pool.query(
    'UPDATE region_import_state SET hierarchy_confirmed = $1 WHERE region_id = $2',
    [confirmed, regionId],
  );
  // Unconfirming invalidates a sign-off precondition — stale the unit.
  if (!confirmed) { await touchWorkUnitForRegion(regionId); }
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/confirm-skeleton  { confirmed } */
export async function confirmSkeleton(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { confirmed } = req.body as { confirmed: boolean };
  await pool.query(
    'UPDATE world_views SET skeleton_confirmed = $1 WHERE id = $2',
    [confirmed, worldViewId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/set-reference  { regionId, divisionIds }
 *  Set the fallback reference territory (used only when the unit has no direct members).
 */
export async function setReferenceTerritory(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionIds } = req.body as { regionId: number; divisionIds: number[] };
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  await pool.query(
    'UPDATE region_import_state SET reference_division_ids = $1 WHERE region_id = $2',
    [divisionIds, regionId],
  );
  // The reference is the verification basis — changing it must stale a sign-off.
  await touchWorkUnitForRegion(regionId);
  res.json({ success: true });
}
