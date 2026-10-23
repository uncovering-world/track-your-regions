/**
 * What the curation client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/curation.ts` calls, declared once.
 *
 * Each exported schema is the type of the same name in the web's generated client, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 *
 * A module of this directory imports only `zod/v4`, the generated row types,
 * vocabulary constants (the backend's or `@tyr/shared`'s), the schemas of the
 * other modules here, and the pure helpers beside `respond()` in
 * `backend/src/api/`. The generator imports every module here, so nothing a
 * schema imports may open a pool or read the environment on the way to being
 * rendered.
 */

import { VIEW_FIELDS } from '../../db/sourceViews.js';
import { CURATION_LOG_ACTIONS } from '@tyr/shared/curationLog';
import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { CONTENT_KINDS } from '../../services/sync/types.js';
import { placementTogether } from '../placementTogether.js';
import { ImageCredit } from './experiences.js';

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

export const AdmissionPin = z.strictObject({
  experienceId: z.number().int(),
  name: z.string(),
  membershipId: z.number().int(),
  kindName: z.string(),
  answer: z.enum(CHECK_VALUES.experience_kind_memberships.admission)
    .describe("The curator's answer the pin holds: put back (`admitted`) or kept out (`refused`)."),
  answeredReason: z.string().nullable().describe(
    "The rule's reason the answer was given to: the refusal a put-back overrode, or the one a kept-out answer agreed"
    + " with; null where the pin answered the run's admission (a curator's own refusal of an arrival).",
  ),
  answeredAt: z.iso.datetime({ offset: true }).nullable().describe('When the answer was given.'),
  note: z.string().nullable(),
  curatorName: z.string().nullable().describe(
    'Who answered, as they chose to be named; null where they chose nothing or where the act lies outside the'
    + " caller's regions, as in the curation log.",
  ),
  questioned: z.boolean().describe('Whether a run no longer agrees with it, and the review queue asks about it (#1367).'),
  canHandBack: z.boolean().describe(
    "Whether the pin can be handed back to the next run; false for a curator's own refusal of an arrival, which a"
    + ' source publishing a list would never take back by itself, and whose way back is the put-back.',
  ),
}).describe("A curator's admission pin on one membership (#1369).");
export type AdmissionPin = z.infer<typeof AdmissionPin>;

export const AdmissionPins = z.strictObject({
  pins: z.array(AdmissionPin).describe('By kind, then by place.'),
  more: z.boolean().describe('Whether more pins stand in scope than the list carries.'),
}).describe("The admission pins in a curator's scope (#1369).");
export type AdmissionPins = z.infer<typeof AdmissionPins>;

export const AdmissionPinHandedBack = z.strictObject({
  experienceId: z.number().int(),
  membershipId: z.number().int(),
  admission: z.enum(CHECK_VALUES.experience_kind_memberships.admission)
    .describe('The verdict the row keeps until the next run of its source decides.'),
}).describe('An admission pin handed back (#1369): the next run decides.');
export type AdmissionPinHandedBack = z.infer<typeof AdmissionPinHandedBack>;

export const PinQuestionAnswered = z.strictObject({
  experienceId: z.number().int(),
  membershipId: z.number().int(),
  admission: z.enum(CHECK_VALUES.experience_kind_memberships.admission)
    .describe("The verdict now standing: the curator's, kept, or the rule's, written in its place."),
  pinned: z.boolean().describe('Whether the pin still stands: true after `keep`, false after `release`.'),
}).describe("A curator's answer to a run that asked again about their admission pin (#1367).");
export type PinQuestionAnswered = z.infer<typeof PinQuestionAnswered>;

export const VisitQuestionAnswered = z.strictObject({
  experienceId: z.number().int(),
  membershipId: z.number().int(),
  answer: z.enum(CHECK_VALUES.experience_visit_questions.answer),
  admission: z.enum(CHECK_VALUES.experience_kind_memberships.admission)
    .describe('The verdict now standing on the membership: refused by the curator, or admitted as before.'),
}).describe("A curator's answer to a run's question about an offered place with nothing to see (#1770).");
export type VisitQuestionAnswered = z.infer<typeof VisitQuestionAnswered>;

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

// The pair every answer carries whose call may re-place the object, in
// `PublishResult`'s words. A partial of `publication` so each schema below takes
// the same two keys with the same descriptions, and `placementTogether` holds them.
const placement = publication.pick({ placementFailed: true, placementFailedWorldViews: true });

const SourceMembership = z.enum(CHECK_VALUES.experiences.source_membership)
  .describe('Whether the source still lists it: `former` once it has delisted it.');
const Existence = z.enum(CHECK_VALUES.experiences.existence)
  .describe('Whether it is still there to visit: `lost` once it is gone.');

export const ExperienceStateResult = z.strictObject({
  experienceId: z.number().int(),
  sourceMembership: SourceMembership,
  existence: Existence,
}).describe("An object's lifecycle as a curator's verdict left it.");
export type ExperienceStateResult = z.infer<typeof ExperienceStateResult>;

export const LocationStateResult = placement.extend({
  locationId: z.number().int(),
  experienceId: z.number().int(),
  sourceMembership: z.enum(CHECK_VALUES.experience_locations.source_membership),
  existence: z.enum(CHECK_VALUES.experience_locations.existence),
  offeredToReaders: z.boolean().describe(
    'Whether a reader sees the point now. A verdict can move it either way, and both axes decide it, so the answer'
    + ' says it rather than leaving a card to work it out.',
  ),
}).superRefine(placementTogether).describe("A point's lifecycle as a curator's verdict left it.");
export type LocationStateResult = z.infer<typeof LocationStateResult>;

export const LocationEditResult = placement.extend({
  success: z.literal(true),
  locationId: z.number().int(),
  anchorMoved: z.boolean().describe(
    "Whether the object's own coordinate moved with the place. True only where the object holds exactly one visible,"
    + ' published place and this is it.',
  ),
  imageCredit: ImageCredit.nullable().optional().describe(
    "Who is named under the place's new picture (#1270). Present only where the picture changed. Null where the"
    + ' picture was taken off, where it is an /images/ path we host, and where Commons did not answer in time; a'
    + ' credit whose author is null is Commons answering with a licence and nobody named.',
  ),
}).superRefine(placementTogether).describe(
  "What a curator's correction to a place's name, position, picture or description did.",
);
export type LocationEditResult = z.infer<typeof LocationEditResult>;

export const WorkEditResult = z.strictObject({
  success: z.literal(true),
  treasureId: z.number().int(),
  claimed: z.array(z.enum(['name', 'artists', 'year', 'image_url']))
    .describe('The columns this edit took ownership of, which a later run no longer touches.'),
  imageCredit: ImageCredit.nullable().optional().describe(
    'Who is named under the new picture. Present only where the picture changed, and null where Commons named nobody'
    + ' in time.',
  ),
}).describe("What a curator's correction to a work did.");
export type WorkEditResult = z.infer<typeof WorkEditResult>;

export const AcceptSourceResult = placement.extend({
  experienceId: z.number().int(),
  applied: z.array(z.string()).describe("The fields now holding the source's value."),
  released: z.array(z.string()).describe('The claims given up to take it.'),
  releasedPoints: z.array(z.number().int()).describe(
    "The points whose own claim on the coordinate went with the object's, because the object's coordinate and its one"
    + " visible point's are the same fact.",
  ),
  movedPoints: z.array(z.number().int())
    .describe('Those of them also put back on the coordinate the run offered.'),
  releasedCredit: z.boolean()
    .describe("Whether taking the source's picture also dropped the credit the curator's own edit wrote for it."),
  fromSyncLogId: z.number().int().describe('The run whose proposal was taken.'),
}).superRefine(placementTogether).describe("What taking the source's value for claimed fields did.");
export type AcceptSourceResult = z.infer<typeof AcceptSourceResult>;

export const DeclineSourceResult = z.strictObject({
  experienceId: z.number().int(),
  declined: z.array(z.string()).describe("The fields whose proposal was turned down, the curator's value kept."),
  fromSyncLogId: z.number().int(),
}).describe("What standing by the curator's own value did.");
export type DeclineSourceResult = z.infer<typeof DeclineSourceResult>;

export const DeclinedPart = z.strictObject({
  kind: ContentKind,
  name: z.string().describe('The part as the record names it.'),
  fields: z.array(z.string()),
}).describe('One part a refusal of held rows reached.');
export type DeclinedPart = z.infer<typeof DeclinedPart>;

export const DeclineHeldResult = placement.extend({
  experienceId: z.number().int(),
  declinedFields: z.array(z.string()).describe("The object's own fields refused now."),
  declinedParts: z.array(DeclinedPart).describe('The parts refused now, grouped as the card grouped them.'),
  fromSyncLogId: z.number().int(),
  heldLeftOpen: z.number().int()
    .describe('Held rows still open. Zero means the card is gone and the pointer with it.'),
  movedPointRefused: z.number().int().nullable()
    .describe("The unread point turned down with the object's coordinate, being the same move (#1233), or null."),
}).superRefine(placementTogether).describe('What refusing held rows of a gated proposal settled.');
export type DeclineHeldResult = z.infer<typeof DeclineHeldResult>;

export const RefuseArrivalResult = z.strictObject({
  experienceId: z.number().int(),
  admission: z.literal('refused'),
  reason: z.string().describe('The reason the kept-out list shows.'),
}).describe("A curator's no to an arrival (ADR-0053).");
export type RefuseArrivalResult = z.infer<typeof RefuseArrivalResult>;

export const RefuseContentsResult = placement.extend({
  experienceId: z.number().int(),
  locationsRefused: z.number().int(),
  treasureLinksRefused: z.number().int(),
}).superRefine(placementTogether).describe('What turning down the unread points and works of an object did.');
export type RefuseContentsResult = z.infer<typeof RefuseContentsResult>;

export const UnrefuseContentsResult = placement.extend({
  experienceId: z.number().int(),
  locationsRestored: z.number().int(),
  treasureLinksRestored: z.number().int(),
  locationIds: z.array(z.number().int()).describe('Exactly which points came back.'),
  treasureIds: z.array(z.number().int()).describe('Exactly which works came back, by treasure id.'),
}).superRefine(placementTogether).describe('What asking again about turned-down points and works did.');
export type UnrefuseContentsResult = z.infer<typeof UnrefuseContentsResult>;

export const RegionMembershipResult = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  regionId: z.number().int(),
}).describe("What rejecting, unrejecting, assigning, unassigning or removing an object in a region did: it is done.");
export type RegionMembershipResult = z.infer<typeof RegionMembershipResult>;

export const ExperienceEditResult = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  curatedFields: z.array(z.string()).describe("Every field the curator now claims on the object, this edit's included."),
}).describe("What a curator's edit of an object's fields did.");
export type ExperienceEditResult = z.infer<typeof ExperienceEditResult>;

export const ManualExperienceCreated = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  externalId: z.string().describe('The id the manual source gave it.'),
}).describe('The object a curator created by hand.');
export type ManualExperienceCreated = z.infer<typeof ManualExperienceCreated>;

export const CurationLogEntry = z.strictObject({
  id: z.number().int(),
  action: z.enum(CURATION_LOG_ACTIONS),
  region_id: z.number().int().nullable(),
  region_name: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable()
    .describe('What the act changed, in the shape its action writes.'),
  created_at: z.iso.datetime({ offset: true }).nullable(),
  curator_name: z.string().nullable().describe(
    'The curator as they chose to be named, null where they chose nothing — or where no curator acted: the catalogue\'s'
    + ' own merge of two places sharing a Wikidata item (ADR-0086).',
  ),
  folded_id: z.number().int().nullable().describe(
    'The entry a standing merge folded into this place, when the act was about that entry rather than about the place'
    + ' itself; null on the place\'s own acts (#1366).',
  ),
  folded_name: z.string().nullable().describe('The folded entry\'s name, beside `folded_id`.'),
}).describe("One act of the object's curation log.");
export type CurationLogEntry = z.infer<typeof CurationLogEntry>;

export const CurationLog = z.array(CurationLogEntry)
  .describe('The newest fifty acts on the object, and on the entries merged into it, that the curator may see, newest first.');
export type CurationLog = z.infer<typeof CurationLog>;

export const MergeUndone = z.strictObject({
  mergeId: z.number().int(),
  survivorId: z.number().int().describe('The place that stayed, which keeps what was written to it after the merge.'),
  foldedId: z.number().int().describe('The place that is a place of its own again.'),
}).describe('A merge of two places undone (ADR-0086): what it moved is back where it came from.');
export type MergeUndone = z.infer<typeof MergeUndone>;

export const MembershipSeparated = z.strictObject({
  separationId: z.number().int(),
  originalId: z.number().int().describe('The place the membership left, which keeps its other kinds, its visits and its own records.'),
  separatedId: z.number().int().describe('The new place, holding the membership with the points and works it places.'),
}).describe('One kind\'s membership of a place separated into a place of its own (ADR-0142).');
export type MembershipSeparated = z.infer<typeof MembershipSeparated>;

const ViewFieldWord = z.enum(VIEW_FIELDS);

export const ViewsChosen = z.strictObject({
  experienceId: z.number().int(),
  fields: z.array(ViewFieldWord).describe('The fields answered.'),
  changed: z.array(ViewFieldWord).describe('The fields whose value the place now shows differently.'),
}).describe('A curator\'s choice between two sources\' views of a place (#1246): the place shows the chosen source\'s value of each field, and the question stays answered until a source sends something different.');
export type ViewsChosen = z.infer<typeof ViewsChosen>;

export const ComponentItemsAnswered = z.strictObject({
  experienceId: z.number().int(),
  accepted: z.number().int().describe("Candidates confirmed: each point now carries its item as a curator's choice."),
  refused: z.number().int().describe('Candidates turned down, never proposed again.'),
  pictured: z.number().int().describe("Of the confirmed, how many points took the item's picture, with its credit."),
}).describe("A curator's answer to the candidate Wikidata items of a site's components (#1272).");
export type ComponentItemsAnswered = z.infer<typeof ComponentItemsAnswered>;

export const MergeProposalsAnswered = z.strictObject({
  experienceId: z.number().int().describe('The place the card is about: the lower id of each pair, which stays.'),
  merged: z.array(z.strictObject({
    proposalId: z.number().int(),
    mergeId: z.number().int().describe('The merge the answer ran, which the history can undo.'),
  })).describe('Pairs answered one place: the other place is folded into this one. A merge that committed is listed here whatever happened after it; where its answer could not be recorded, the same pair is in `refused` too, with why.'),
  two: z.number().int().describe('Pairs answered two places: kept apart, never proposed again.'),
  partOf: z.number().int().describe('Pairs answered one part of the other: recorded on the proposal, nothing merged.'),
  refused: z.array(z.strictObject({
    proposalId: z.number().int(),
    error: z.string(),
  })).describe('Pairs the answer could not be written for — answered meanwhile, a merge the catalogue refused, or a pair outside the caller\'s sources — each with why; the others stand. A pair also in `merged` was merged and its answer not recorded: one pair, not two.'),
}).describe("A curator's answer to pairs of near places with similar names (#1249).");
export type MergeProposalsAnswered = z.infer<typeof MergeProposalsAnswered>;

export const ViewSuggestions = z.strictObject({
  configured: z.boolean().describe('Whether this deployment asks Jev at all. False: no suggestion, nothing else changes.'),
  suggestions: z.array(z.strictObject({
    field: ViewFieldWord,
    membershipId: z.number().int().describe('The view Jev would show.'),
    confidence: z.number().describe('Its confidence, 0 to 1.'),
  })),
}).describe("Jev's suggested answer to the sources card (#1260), per field it could answer; never applied.");
export type ViewSuggestions = z.infer<typeof ViewSuggestions>;

export const PointItemTakenBack = z.strictObject({
  locationId: z.number().int(),
  item: z.string().describe('The Wikidata item taken off the point.'),
  cleared: z.array(z.enum(['image_url', 'description']))
    .describe('What the confirmation had written with the item and came off with it; a field a curator claimed since stays.'),
}).describe("A confirmed component item taken back (#1317): the point has no item again, and the candidate is back in the queue, open (#1336).");
export type PointItemTakenBack = z.infer<typeof PointItemTakenBack>;

export const ComponentItemSuggestions = z.strictObject({
  configured: z.boolean().describe('Whether this deployment asks Jev at all. False: no judgement, nothing else changes.'),
  suggestions: z.array(z.strictObject({
    proposalId: z.number().int().describe('The candidate judged.'),
    judgement: z.enum(CHECK_VALUES.experience_component_item_suggestions.judgement)
      .describe('`same`: the item is the component; `other`: another place.'),
    confidence: z.number().describe('Its confidence, 0 to 1.'),
  })),
}).describe("Jev's judgement of the candidate items of a site's components (#1272), per candidate it could judge; never applied.");
export type ComponentItemSuggestions = z.infer<typeof ComponentItemSuggestions>;

export const MergeProposalSuggestions = z.strictObject({
  configured: z.boolean().describe('Whether this deployment asks Jev at all. False: no judgement, nothing else changes.'),
  suggestions: z.array(z.strictObject({
    proposalId: z.number().int().describe('The pair judged.'),
    judgement: z.enum(CHECK_VALUES.experience_merge_suggestions.judgement)
      .describe('`one`: the two are one place; `two`: two places; `part_of`: one lies within the other, which one being the curator\'s to say.'),
    confidence: z.number().describe('Its confidence, 0 to 1.'),
  })),
}).describe("Jev's judgement of the pairs of near places with similar names a place is the lower id of (#1249), per pair it could judge; never applied.");
export type MergeProposalSuggestions = z.infer<typeof MergeProposalSuggestions>;

export const VisitSuggestion = z.strictObject({
  configured: z.boolean().describe('Whether this deployment asks Jev at all. False: no reading, nothing else changes.'),
  suggestion: z.strictObject({
    reading: z.enum(CHECK_VALUES.experience_visit_suggestions.reading)
      .describe('`visit`: something to see or enter; `part`: a part of a larger place; `object`: a thing kept elsewhere; '
        + '`nothing`: little or nothing visible; `not-a-place`: a culture, a kingdom or a group of sites; '
        + '`other-kind`: visited for something the place\'s kinds do not offer.'),
    confidence: z.number().describe('Its confidence, 0 to 1.'),
  }).nullable().describe('None where the place is not arriving, or Jev could not read it.'),
}).describe("Jev's reading of what a visitor finds at a place arriving for a curator (#1768); never applied.");
export type VisitSuggestion = z.infer<typeof VisitSuggestion>;

export const NearbyPicture = z.strictObject({
  file: z.string().describe("The file's name on Wikimedia Commons."),
  url: z.string().describe('The address the catalogue stores a picture by: what a pick sends as `imageUrl`.'),
  distanceM: z.number().int().describe('Metres from the point to where the file is geotagged.'),
  credit: ImageCredit,
});

export const NearbyPictures = z.strictObject({
  radiusM: z.number().int().describe('How far from the point a file may stand.'),
  pictures: z.array(NearbyPicture).describe('Picture files only, nearest first; a geotag says where the camera stood, not what it shows.'),
}).describe("The Commons files geotagged near a point, for a curator to pick the point's picture from (#1341).");
export type NearbyPictures = z.infer<typeof NearbyPictures>;
