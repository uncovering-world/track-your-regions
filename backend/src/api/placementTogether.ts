/**
 * A rule of the response schemas that Zod states as a refinement, kept beside
 * `respond()` so every module in `responses/` can hold its answers to it
 * (a module there exports schemas only, ADR-0066).
 */

import type { z } from 'zod/v4';

/**
 * The flag and the list of a failed re-placement come together or not at all,
 * and the list is never empty. Every writer derives the pair from one value, so
 * this holds by construction today; the refinement is what makes a handler that
 * sends one without the other fail its lane rather than reach a curator.
 *
 * Zod's `toJSONSchema` emits nothing for a refinement, and the renderer reads
 * no `dependentRequired`, so the rule reaches neither the JSON Schema nor the
 * web's type, which keeps the two keys optional and independent. JSON Schema
 * 2020-12 can state it, and that is where the OpenAPI document of #793 would
 * carry it. The server guarantees more than the generated type says, never
 * less.
 */
export function placementTogether(
  body: { placementFailed?: true; placementFailedWorldViews?: unknown[] },
  ctx: z.RefinementCtx,
): void {
  const flagged = body.placementFailed === true;
  const listed = body.placementFailedWorldViews !== undefined;
  if (flagged === listed) return;
  ctx.addIssue({
    code: 'custom',
    path: [flagged ? 'placementFailedWorldViews' : 'placementFailed'],
    message: 'placementFailed and placementFailedWorldViews are sent together or not at all',
  });
}
