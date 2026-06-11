/**
 * Admin WorldView Import — workflow endpoints (per-country sign-off model).
 * Spec: docs/tech/planning/import-review-workflow-redesign.md
 *
 * authFetchJson decision (sign-off 409):
 * parseJsonResponse in fetchUtils.ts throws `new Error(body.error || 'HTTP 409')`.
 * The 409 body carries `{blockers, verify}` with no `error` field, so
 * authFetchJson would throw `new Error('HTTP 409')`, discarding the payload.
 * We need the blocker list in VerifyDialog, so signOffWorkUnit uses a raw
 * fetch call with manual 401-retry (mirroring authFetchJson) and returns a
 * discriminated union `{ok:true, signedOffAt} | {ok:false, blockers, verify}`
 * instead of throwing. No changes to fetchUtils.ts (single-endpoint concern).
 */
import {
  authFetchJson,
  API_URL,
  getAccessToken,
  refreshSession,
} from '../fetchUtils';

const BASE = (worldViewId: number) =>
  `${API_URL}/api/admin/wv-import/matches/${worldViewId}`;

export type SignoffStatus = 'not_started' | 'in_progress' | 'signed_off';

export interface DashboardUnit {
  regionId: number;
  name: string;
  continent: string | null;
  signoffStatus: SignoffStatus;
  signedOffAt: string | null;
  hierarchyConfirmed: boolean;
  hasReference: boolean;
  referenceDivisionIds: number[];
  sourceUrl: string | null;
  leafTotal: number;
  leafResolved: number;
  warningCount: number;
}

export interface WorkflowDashboard {
  skeletonConfirmed: boolean;
  units: DashboardUnit[];
}

export type VerifyBlocker =
  | 'no_reference_territory'
  | 'unassigned_leaves'
  | 'coverage_gaps'
  | 'overlaps';
export type SignOffBlocker = VerifyBlocker | 'hierarchy_not_confirmed';

export interface VerifyResult {
  referenceDivisionIds: number[];
  referenceSource: 'members' | 'reference' | null;
  unassignedLeaves: Array<{ regionId: number; name: string }>;
  coverageGaps: Array<{ divisionId: number; name: string; parentName: string | null }>;
  overlaps: Array<{ divisionId: number; name: string; regionIds: number[] }>;
  blockers: VerifyBlocker[];
  verifiedAt: string;
}

export async function getWorkflowDashboard(worldViewId: number): Promise<WorkflowDashboard> {
  return authFetchJson(`${BASE(worldViewId)}/dashboard`);
}

export async function getWorkUnitVerification(
  worldViewId: number,
  regionId: number,
): Promise<VerifyResult> {
  return authFetchJson(`${BASE(worldViewId)}/verify/${regionId}`);
}

/**
 * Sign off a work unit.
 *
 * Returns a discriminated union so callers can access the 409 blocker payload
 * without catching a generic Error (authFetchJson discards it).
 * Implements the same 401-retry loop as authFetchJson internally.
 */
export type SignOffResult =
  | { ok: true; signedOffAt: string | null }
  | { ok: false; blockers: SignOffBlocker[]; verify: VerifyResult };

async function doSignOffFetch(url: string, body: string): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { method: 'POST', headers, body });
}

async function parseSignOffResponse(res: Response): Promise<SignOffResult> {
  if (res.ok) {
    const data = (await res.json()) as { success: boolean; signedOffAt: string | null };
    return { ok: true, signedOffAt: data.signedOffAt };
  }
  if (res.status === 409) {
    const data = (await res.json()) as { blockers: SignOffBlocker[]; verify: VerifyResult };
    return { ok: false, blockers: data.blockers, verify: data.verify };
  }
  const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
  throw new Error((errBody as { error?: string }).error ?? `HTTP ${res.status}`);
}

export async function signOffWorkUnit(
  worldViewId: number,
  regionId: number,
): Promise<SignOffResult> {
  const url = `${BASE(worldViewId)}/sign-off`;
  const body = JSON.stringify({ regionId });
  let res = await doSignOffFetch(url, body);

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }
    res = await doSignOffFetch(url, body);
  }

  return parseSignOffResponse(res);
}

export async function reopenWorkUnit(
  worldViewId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId }),
  });
}

export async function setWorkUnitFlag(
  worldViewId: number,
  regionId: number,
  isWorkUnit: boolean,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/work-unit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, isWorkUnit }),
  });
}

export async function confirmHierarchy(
  worldViewId: number,
  regionId: number,
  confirmed: boolean,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/confirm-hierarchy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, confirmed }),
  });
}

export async function confirmSkeleton(
  worldViewId: number,
  confirmed: boolean,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/confirm-skeleton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed }),
  });
}

export async function setReferenceTerritory(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/set-reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, divisionIds }),
  });
}

export async function setAssignmentWaived(
  worldViewId: number,
  regionId: number,
  waived: boolean,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/waive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, waived }),
  });
}
