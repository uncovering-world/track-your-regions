/**
 * What the curation client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/curation.ts` calls, declared once.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * An endpoint still missing here declares its answer on both sides, until its
 * slice of #527 moves it.
 *
 * A module of this directory imports only `zod/v4`, the generated row types,
 * the backend's vocabulary constants, the schemas of the other modules here,
 * and the pure helpers beside `respond()` in `backend/src/api/`. The generator
 * imports every module here, so nothing a schema imports may open a pool or
 * read the environment on the way to being rendered.
 */

import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { CONTENT_KINDS } from '../../services/sync/types.js';

export const ContentKind = z.enum(CONTENT_KINDS)
  .describe("Which of an object's contents a part is: one of its points (`locations`) or one of its works (`treasures`).");
export type ContentKind = z.infer<typeof ContentKind>;

export const MembershipCurationState = z.enum(CHECK_VALUES.experience_kind_memberships.curation_state)
  .describe(
    'Where the object stands at the curation gate of its kind. `pending` is shown to nobody but a curator.'
    + ' `auto` and `verified` are shown to readers, `verified` because a person passed it.',
  );
export type MembershipCurationState = z.infer<typeof MembershipCurationState>;

/**
 * A world view whose regions are stale after a publication.
 *
 * Named rather than counted, because a curator cannot fix any of it: a
 * re-assignment is admin-only, and what a region- or source-scoped curator can
 * do is tell an admin which object and which world views. The reason each one
 * gave stays in the server's log. It is a database error string, the curator
 * can do nothing with it, and an admin reading the log has it in full.
 */
export const PlacementFailure = z.strictObject({
  id: z.number().int().nullable()
    .describe('The world view, or null where listing the world views is what failed, so none was attempted.'),
  name: z.string().nullable(),
}).describe('A world view whose regions the publication could not recompute.');
export type PlacementFailure = z.infer<typeof PlacementFailure>;

export const AppliedPart = z.strictObject({
  kind: ContentKind,
  name: z.string().describe('The part as the record names it, which is what the curator saw on the card.'),
  fields: z.array(z.string()).describe('The held fields written to the part now.'),
  claimedFieldsSkipped: z.array(z.string())
    .describe("Held fields left as the curator wrote them, because the part's own claims hold them."),
}).describe('One part publishing wrote to, such as a place renamed or a work re-attributed (ADR-0037).');
export type AppliedPart = z.infer<typeof AppliedPart>;

// Two reasons rather than one, because they ask the curator for different
// things: nothing at all, or a look at the siblings. `partRecord.ts` says when a
// part is ambiguous.
export const PartNotFound = z.strictObject({
  kind: ContentKind,
  name: z.string().describe('The part as the record names it.'),
  reason: z.enum(['withdrawn', 'ambiguous']).describe(
    '`withdrawn`: no offered row answers to the part any more. `ambiguous`: more than one does, and nothing tells them'
    + ' apart, such as a component listed once per country under one reference.',
  ),
}).describe('A part the held proposal names that publishing could not write to. Nothing readers see changed.');
export type PartNotFound = z.infer<typeof PartNotFound>;

/**
 * The flag and the list of a failed re-placement come together or not at all,
 * and the list is never empty. Both writers derive the pair from one value, so
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
function placementTogether(
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

const publication = z.strictObject({
  experienceId: z.number().int(),
  curationState: MembershipCurationState.describe("The object's own state after the call. A contents publish leaves it as it was."),
  appliedFields: z.array(z.string()).describe('Held fields written now.'),
  claimedFieldsSkipped: z.array(z.string())
    .describe('Held fields left as the curator wrote them, because the curator claims them.'),
  appliedParts: z.array(AppliedPart)
    .describe('The parts whose held fields were written now. Empty on a contents publish, which leaves the proposal where it was.'),
  // Reported rather than refused: there is nothing to apply and nothing readers
  // see, and a 409 would leave a card that no answer can clear.
  partsNotFound: z.array(PartNotFound).optional()
    .describe('Parts the proposal names that nothing could be written to. Present only when there is one.'),
  fromSyncLogId: z.number().int().nullable()
    .describe('The run whose held proposal was applied, or null when none was held.'),
  heldLeftOpen: z.number().int().describe(
    'Held rows this call left open, at both levels. Non-zero exactly when the card is still standing, because the'
    + ' pointer that keys it was kept. Zero on every call that names no selection.',
  ),
  locationsPublished: z.number().int().describe('Points shown to readers now.'),
  treasureLinksPublished: z.number().int().describe("Links to the object's works shown to readers now."),
  treasuresPublished: z.number().int().describe('Works shown to readers now.'),
  withdrawalsReleased: z.number().int()
    .describe('Points the source had replaced, no longer shown now that their replacement is.'),
  // The flag and the list travel together or not at all. A flag without the
  // list is a dead end for the curator, and a list without the flag would make
  // every reader re-derive "did it fail" from an array's length.
  placementFailed: z.literal(true).optional()
    .describe('Set when the publication landed and re-placing the object into its regions did not.'),
  placementFailedWorldViews: z.array(PlacementFailure).min(1).optional()
    .describe('Where the regions are stale now. Present exactly when `placementFailed` is, and never empty.'),
});

export const PublishResult = publication.superRefine(placementTogether)
  .describe('What a publication did, so the page can say it before the refetch.');
export type PublishResult = z.infer<typeof PublishResult>;

/**
 * Publish's own answer with the verdict in front: a curator who clicks "Put it
 * back" on an arrival gets the verdict and the publication that came with it,
 * in the shape the review page already says in one sentence.
 *
 * Never a held field. An override does not answer a proposal, which is
 * `/publish`'s question, so the fields that report one are pinned to their
 * empty values here rather than only described as empty.
 */
export const AdmissionResult = publication.omit({ partsNotFound: true }).extend({
  admission: z.enum(CHECK_VALUES.experience_kind_memberships.admission)
    .describe('The verdict now standing: `admitted` after an override, `refused` after a confirm.'),
  published: z.boolean().describe(
    'Whether this override also made the object visible. True only where the object was unread and the verdict was'
    + ' `override`: putting a gated arrival back is what publishes it (ADR-0025), while overriding the refusal of a'
    + ' visible object says nothing about whether anyone has read it.',
  ),
  curationState: MembershipCurationState.describe("The object's own state after the call, unchanged when `published` is false."),
  appliedFields: z.array(z.string()).max(0).describe('Always empty: an override never applies a held field.'),
  claimedFieldsSkipped: z.array(z.string()).max(0).describe('Always empty, for the same reason.'),
  appliedParts: z.array(AppliedPart).max(0)
    .describe("Always empty: a held field of a part is a proposal too, and an override answers none."),
  fromSyncLogId: z.null().describe('Always null, for the same reason.'),
  heldLeftOpen: z.literal(0).describe(
    'Always zero: an override answers no held row, so it leaves none open either. A row holding a proposal keeps'
    + ' its pointer and its own card through an override.',
  ),
}).superRefine(placementTogether).describe('What answering a refusal did.');
export type AdmissionResult = z.infer<typeof AdmissionResult>;
