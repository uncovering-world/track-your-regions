/**
 * What an answer says about a placement that followed it: the flag and the named
 * world views together, or neither key set. Every answer that re-places sends
 * this pair in these words (`PlacementFailure` in `api/responses/curation.ts`),
 * so it is built here once rather than mapped at each caller. Both keys are
 * always present on the value, the unset ones `undefined`, which JSON drops.
 *
 * A module of its own rather than a function beside `placeAfterRelease`, whose
 * callers' specs replace that module whole: a pure mapping has nothing to fake.
 */

import type { PublishResult } from '../../api/responses/curation.js';

export function placementReport(
  failures: Array<{ worldViewId: number | null; worldViewName: string | null }>,
): Pick<PublishResult, 'placementFailed' | 'placementFailedWorldViews'> {
  if (failures.length === 0) return { placementFailed: undefined, placementFailedWorldViews: undefined };
  return {
    placementFailed: true,
    placementFailedWorldViews: failures.map(f => ({ id: f.worldViewId, name: f.worldViewName })),
  };
}
