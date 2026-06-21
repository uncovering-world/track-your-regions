import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';

export type LevelStatus = 'empty' | 'in_progress' | 'done';
export type LevelId = 'l1' | 'l2' | 'l3';

export interface LevelProgress {
  l1: { continents: number; countries: number; status: LevelStatus };
  l2: { signedOff: number; total: number; status: LevelStatus };
  l3: { leafResolved: number; leafTotal: number; status: LevelStatus };
}

function tri(done: boolean, any: boolean): LevelStatus {
  if (done) return 'done';
  return any ? 'in_progress' : 'empty';
}

/**
 * Per-level progress for the POC staged tracker, derived from the import
 * dashboard's work units (countries). L1 = how grouped into continents,
 * L2 = country sign-off, L3 = aggregate sub-national leaf resolution.
 */
export function computeLevelProgress(units: DashboardUnit[]): LevelProgress {
  const total = units.length;

  const continentOf = (u: DashboardUnit): string | null =>
    u.continent ?? (u.ancestorPath.length > 0 ? u.ancestorPath[0] : null);
  const continents = new Set(units.map(continentOf).filter((c): c is string => c != null));
  const allGrouped = total > 0 && units.every((u) => continentOf(u) != null);

  const signedOff = units.filter((u) => u.signoffStatus === 'signed_off').length;

  const leafTotal = units.reduce((s, u) => s + u.leafTotal, 0);
  const leafResolved = units.reduce((s, u) => s + u.leafResolved, 0);

  return {
    l1: { continents: continents.size, countries: total, status: total === 0 ? 'empty' : tri(allGrouped, true) },
    l2: { signedOff, total, status: total === 0 ? 'empty' : tri(signedOff === total, signedOff > 0 || units.some((u) => u.signoffStatus === 'in_progress')) },
    l3: { leafResolved, leafTotal, status: leafTotal === 0 ? 'empty' : tri(leafResolved === leafTotal, leafResolved > 0) },
  };
}
