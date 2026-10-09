/**
 * Curation API client
 *
 * A curator's writes on one object (curator-only): its place in a region, its
 * fields, its lifecycle and admission, its points and works, the source's
 * values a curator takes or declines, and publishing or refusing what a gated
 * run brought.
 */

import type {
  AcceptSourceResult, AdmissionResult, ComponentItemsAnswered, ComponentItemSuggestions, ContentKind, CurationLog,
  DeclineHeldResult,
  DeclineSourceResult, ExperienceEditResult, ExperienceStateResult, LocationEditResult,
  LocationStateResult, ManualExperienceCreated, MergeUndone, PublishResult, ViewsChosen, ViewSuggestions, RefuseArrivalResult,
  RefuseContentsResult, RegionMembershipResult, UnrefuseContentsResult, WorkEditResult,
} from './client.generated';
import {
  deleteExperiencesByIdAssignByRegionId, deleteExperiencesByIdRemoveFromRegionByRegionId,
  getExperiencesByIdCurationLog, patchExperiencesByIdEdit, patchExperiencesByIdWorksByTreasureIdEdit,
  patchExperiencesLocationsByLocationIdEdit, postExperiences, postExperiencesByIdAcceptSource,
  postExperiencesMergesByMergeIdUndo, postExperiencesByIdChooseViews, type ChooseViewsBody,
  postExperiencesByIdViewSuggestions, postExperiencesByIdComponentItems, type AnswerComponentItemsBody,
  postExperiencesByIdComponentItemSuggestions,
  postExperiencesByIdAdmission, postExperiencesByIdAssign, postExperiencesByIdDeclineHeld,
  postExperiencesByIdDeclineSource, postExperiencesByIdPublish, postExperiencesByIdRefuseArrival,
  postExperiencesByIdRefuseContents, postExperiencesByIdReject, postExperiencesByIdState,
  postExperiencesByIdUnrefuseContents, postExperiencesByIdUnreject, postExperiencesLocationsByLocationIdState,
  type CreateManualExperienceBody, type DeclineHeldBody, type EditExperienceBody, type EditLocationBody,
  type EditWorkBody, type ExperienceAdmissionBody, type LifecycleStateBody, type RefuseContentsBody,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AcceptSourceResult, AdmissionResult, AnswerComponentItemsBody, AppliedPart, ComponentItemsAnswered,
  ComponentItemSuggestions, ContentKind, CurationLog, CurationLogEntry,
  DeclineHeldResult, DeclineSourceResult, DeclinedPart, ExperienceEditResult,
  ExperienceStateResult, LocationEditResult, LocationStateResult, ManualExperienceCreated, MergeUndone,
  PartNotFound, ViewsChosen, ViewSuggestions, PlacementFailure, PublishResult, RefuseArrivalResult, RefuseContentsBody, RefuseContentsResult,
  RegionMembershipResult, UnrefuseContentsResult, WorkEditResult,
} from './client.generated';

/**
 * Reject an experience from a region
 */
export async function rejectExperience(
  experienceId: number,
  regionId: number,
  reason?: string,
): Promise<RegionMembershipResult> {
  return postExperiencesByIdReject(experienceId, { regionId, reason });
}

/**
 * Record what a curator decided about an object's lifecycle.
 *
 * Sending `membership: 'present'` on a row a run flagged is the "false alarm"
 * answer: the source hiccupped and nothing moved.
 */
export async function setExperienceState(
  experienceId: number,
  // `expected` is the row as the card showed it, flag included. Compared under
  // the write lock: a run that re-lists the object clears the flag without
  // touching either axis, so the axes alone cannot tell a live question from a
  // withdrawn one.
  decision: LifecycleStateBody,
): Promise<ExperienceStateResult> {
  return postExperiencesByIdState(experienceId, decision);
}

/**
 * The same verdict about one point inside an object (ADR-0026).
 *
 * Same body, and one thing to know about the answer: it can move visibility either
 * way. The false alarm reveals a flagged point, `former` leaves a flagged one hidden,
 * `lost` hides a point that was on offer, and taking a `lost` back reveals one whose
 * flag is already clear — because a reader-facing read carries both the withdrawal flag
 * and the `lost` verdict (ADR-0026 decision 7), so either axis alone can move it. Which is why
 * the reply says `offeredToReaders` outright rather than leaving a card to work it out
 * from two axes, and why it may carry `placementFailed`: a verdict that changes what a
 * reader sees re-places the point, in either direction.
 */
export async function setLocationState(
  locationId: number,
  decision: LifecycleStateBody,
): Promise<LocationStateResult> {
  return postExperiencesLocationsByLocationIdState(locationId, decision);
}

/**
 * A curator's correction to one place: what it is called, or where it is.
 *
 * The other question about a point, beside the verdict above about its standing.
 * The coordinate goes as a pair or not at all — the endpoint refuses half a move,
 * since a latitude against the old longitude names somewhere nobody chose — and
 * an empty body is refused too, so the caller sends what changed and nothing else.
 * Each value written claims its column on the place (`curated_fields`), which is
 * what keeps the correction standing at the next run.
 */
export async function editLocation(
  locationId: number,
  correction: EditLocationBody,
): Promise<LocationEditResult> {
  return patchExperiencesLocationsByLocationIdEdit(locationId, correction);
}

/**
 * A curator's correction to one work: its title, who made it, when, and which
 * photograph it is shown by.
 *
 * The museum is in the path because a work hangs in more than one and carries
 * no scope of its own — the link to the museum the curator came from is what
 * proves the work is theirs to correct, and its absence is a 404 rather than a
 * 403. The reach is the other side of that: a work is passed once, globally
 * (ADR-0025 decision 2), so the row a correction changes is the row every museum
 * holding the work carries — which is why `venue_count` is on the rows this is
 * offered from and said before Save rather than reported after. *Carries*, not
 * *shows*: the count is of museums the work hangs in and is deliberately not a
 * claim about who can see it today (`venueCountSql`).
 *
 * `artists` is sent whole, in the order the curator put it in, and an **empty**
 * list is a value: "the source names somebody and nobody knows who made this"
 * is an answer, and the endpoint keeps it apart from leaving the field alone.
 * Sending the list unchanged is also a request — it claims the column, which is
 * how a curator vouches for an order that was already right.
 *
 * `imageUrl` is a Commons file or an `/images/` path we host, and `''` takes
 * the picture off. The credit is not sent: it belongs to the file, and the
 * server fetches it from Commons for whatever address this writes, so the two
 * land in one statement and no row ever holds one photograph under another
 * photographer's name (ADR-0043).
 */
export async function editWork(
  experienceId: number,
  treasureId: number,
  correction: EditWorkBody,
): Promise<WorkEditResult> {
  return patchExperiencesByIdWorksByTreasureIdEdit(experienceId, treasureId, correction);
}

/**
 * Answer a refusal: `confirm` keeps it, `override` puts the row back.
 *
 * No `expected` block, unlike `setExperienceState`. Both answers pin
 * `admission` in the row's curated fields, so a second curator answering the
 * same card collides with the pin and gets a 409 whichever way the first one
 * answered.
 *
 * An override on an arrival publishes it (ADR-0025 § 4.5), and a publication
 * takes everything that arrived with the object — its points and its works,
 * not only its own fields — so the response carries the same shape `publish`
 * does for that half: never a held field (an override does not answer a
 * proposal; that is `/publish`'s question), but every count a content
 * publish can report.
 */
export async function setExperienceAdmission(
  experienceId: number,
  decision: ExperienceAdmissionBody,
): Promise<AdmissionResult> {
  return postExperiencesByIdAdmission(experienceId, decision);
}

/**
 * Apply the value a sync proposed for a field the curator had claimed.
 */
export async function acceptSourceValue(
  experienceId: number,
  fields: string[],
  expectedSyncLogId: number,
): Promise<AcceptSourceResult> {
  return postExperiencesByIdAcceptSource(experienceId, { fields, expectedSyncLogId });
}

/**
 * Stand by the curator's own value, and record that the question was answered.
 *
 * No value goes up: what was refused is read from the proposal under the write lock,
 * because the queue suppresses the card by comparing the stored refusal against what
 * the source is proposing now — a refusal of something nobody proposed would silence
 * nothing while looking like an answer.
 */
export async function declineSourceValue(
  experienceId: number,
  fields: string[],
  expectedSyncLogId: number,
): Promise<DeclineSourceResult> {
  return postExperiencesByIdDeclineSource(experienceId, { fields, expectedSyncLogId });
}

/**
 * Refuse what a gated run proposed for named rows of a held card (#722).
 *
 * The other answer to a held row, and not the same act as refusing a conflict:
 * `decline-source` closes a disagreement with a curator's *claim*, and its
 * lookup requires one, so it would 409 on every field a kind's gate held
 * with nobody having claimed anything.
 *
 * No value goes up, for the reason `declineSourceValue` sends none: the queue
 * suppresses a row by comparing the stored answer against what the source is
 * proposing now, so a refusal of a value nobody proposed would silence nothing
 * while looking like an answer. What goes up is which rows, named as the queue
 * named them.
 */
export async function declineHeld(
  experienceId: number,
  selection: Omit<DeclineHeldBody, 'expectedSyncLogId'>,
  expectedSyncLogId: number,
): Promise<DeclineHeldResult> {
  return postExperiencesByIdDeclineHeld(experienceId, { ...selection, expectedSyncLogId });
}

/**
 * The four shapes the web sends, as four shapes rather than six optional fields.
 * The endpoint takes a fifth, `fieldsOnly`, which no screen sends since every row
 * of the card answers on its own (#524).
 *
 * A union because the server's own schema is one: `publishExperienceBodySchema`
 * refuses `expectedSyncLogId` on any contents publish, refuses a held selection
 * beside a contents publish — it already publishes the fields half — and refuses
 * a held selection *without* `expectedSyncLogId`, which is why the fourth member declares
 * it required: a per-row answer is about the proposal one run made. Typed as a bag of optionals, a
 * caller could write the combination that 400s and find out at runtime; typed as
 * this, the compiler refuses it at the call site — which is where the card is
 * being written and the intent is still legible.
 *
 * Exported so the screens share it instead of each narrowing a local copy: a
 * component-local union agrees with the server until the day the server gains a
 * shape, and then agrees with nothing.
 *
 * Narrower than the document's `PublishExperienceBody`, which cannot say which
 * fields go together; the generated call below holds this union assignable to
 * it, so the two cannot drift apart.
 */
export type PublishRequest =
  /** The object: its held fields, its own state, and every unread row under it. */
  | { locationIds?: undefined; treasureIds?: undefined; contentsOnly?: undefined;
      heldFields?: undefined; heldParts?: undefined;
      expectedSyncLogId?: number }
  /** Every pending content row, the object's own state left alone. */
  | { contentsOnly: true; locationIds?: undefined; treasureIds?: undefined;
      heldFields?: undefined; heldParts?: undefined;
      expectedSyncLogId?: undefined }
  /** Exactly these rows, and nothing else. */
  | { locationIds?: number[]; treasureIds?: number[]; contentsOnly?: undefined;
      heldFields?: undefined; heldParts?: undefined;
      expectedSyncLogId?: undefined }
  /**
   * Exactly these rows of the held proposal, and the rest left open (#722).
   *
   * The fields publish narrowed the way the id arrays narrow the contents one:
   * naming held rows publishes those and none of the unread contents.
   */
  | { heldFields?: string[]; heldParts?: HeldSelectionPart[]; locationIds?: undefined;
      treasureIds?: undefined; contentsOnly?: undefined;
      expectedSyncLogId: number };

/**
 * One part of a held proposal, as a request names it (#722).
 *
 * The record names a part and never identifies it (ADR-0026 decision 4), so a
 * request does the same and a card echoes back what the queue gave it: the kind,
 * the reference and the name. Both halves are nullable there and here, and the
 * server matches on the pair, because a reference is duplicated across the
 * components of a serial site and a name is not unique either.
 */
export interface HeldSelectionPart {
  kind: ContentKind;
  ref: string | null;
  name: string | null;
  fields: string[];
}

/**
 * Say that a reader may see this — the only endpoint that applies a gate-held
 * field (ADR-0025).
 *
 * Not `accept-source`, which looks the same from a distance and is not an
 * option: its lookup requires `curatedConflict: true`, and a field held purely
 * by a kind's gate carries `false`, so it would refuse every one of them.
 *
 * Naming no contents publishes the object — its held fields, its own state, and
 * every unread point and work under it. Naming any makes it those rows and
 * nothing else, because a visible museum that gained three checked paintings has
 * not thereby been read. `contentsOnly: true` is the shape for that case without
 * naming ids: every pending content row, and the object's own state left alone
 * — an absent body means the opposite (the object too), which is exactly the
 * inference a contents-only card must not make, since the object may already be
 * verified by a person who never looked at what just arrived under it.
 */
export async function publishExperience(
  experienceId: number,
  body: PublishRequest & { membershipId?: number } = {},
): Promise<PublishResult> {
  return postExperiencesByIdPublish(experienceId, body);
}

/**
 * A curator's no to an arrival (#852, ADR-0053): the object is kept out the way a
 * rule-refused row is, and *Put it back* in the kept-out list is the way back.
 */
export async function refuseArrival(
  experienceId: number,
  body: { note?: string; membershipId?: number } = {},
): Promise<RefuseArrivalResult> {
  return postExperiencesByIdRefuseArrival(experienceId, body);
}

/**
 * A curator's no to the unread points and works under a visible object — the named
 * ones, or all of them (#852, ADR-0053). They stay hidden and stop being asked about.
 */
export async function refuseContents(
  experienceId: number,
  body: RefuseContentsBody = {},
): Promise<RefuseContentsResult> {
  return postExperiencesByIdRefuseContents(experienceId, body);
}

/**
 * The way back from that no (#859): ask about the named turned-down points and
 * works again, or about all of them.
 *
 * Restores the question and nothing a reader sees — the part was hidden before
 * the refusal and is hidden still. A point counts toward its regions again,
 * which is why this answers the placement fields the refusal answers.
 */
export async function unrefuseContents(
  experienceId: number,
  body: RefuseContentsBody = {},
): Promise<UnrefuseContentsResult> {
  return postExperiencesByIdUnrefuseContents(experienceId, body);
}

/**
 * Unreject an experience from a region
 */
export async function unrejectExperience(
  experienceId: number,
  regionId: number,
): Promise<RegionMembershipResult> {
  return postExperiencesByIdUnreject(experienceId, { regionId });
}

/**
 * Manually assign an experience to a region
 */
export async function assignExperienceToRegion(
  experienceId: number,
  regionId: number,
): Promise<RegionMembershipResult> {
  return postExperiencesByIdAssign(experienceId, { regionId });
}

/**
 * Create a new manual experience under a chosen source
 */
export async function createManualExperience(data: CreateManualExperienceBody): Promise<ManualExperienceCreated> {
  return postExperiences(data);
}

/**
 * Edit an experience's fields (curator)
 */
export async function editExperience(
  experienceId: number,
  data: EditExperienceBody,
): Promise<ExperienceEditResult> {
  return patchExperiencesByIdEdit(experienceId, data);
}

/**
 * Which source's name, description, picture or point a place shows, where two
 * data sources describe it differently (#1246): per field, a membership, or
 * null to keep what the place shows.
 */
export async function chooseSourceViews(experienceId: number, choices: ChooseViewsBody['choices']): Promise<ViewsChosen> {
  return postExperiencesByIdChooseViews(experienceId, { choices });
}

/**
 * The candidate Wikidata items of a serial site's components (#1272): per
 * candidate, confirmed — the item recorded on its point as the curator's
 * choice, with what the item gives it — or turned down, never offered again.
 */
export async function answerComponentItems(
  experienceId: number, answers: AnswerComponentItemsBody['answers'],
): Promise<ComponentItemsAnswered> {
  return postExperiencesByIdComponentItems(experienceId, { answers });
}

/**
 * Jev's suggestion for the sources card (#1260): which view of each disputed
 * field it would show, with its confidence. A suggestion only; a POST since
 * the server may ask Jev, which is paid for per call.
 */
export async function suggestSourceViews(experienceId: number): Promise<ViewSuggestions> {
  return postExperiencesByIdViewSuggestions(experienceId);
}

/**
 * Jev's judgement of a site's candidate component items (#1272): per
 * candidate, whether the item is the component or another place, with its
 * confidence. A suggestion only; a POST since the server may ask Jev, which is
 * paid for per call.
 */
export async function suggestComponentItems(experienceId: number): Promise<ComponentItemSuggestions> {
  return postExperiencesByIdComponentItemSuggestions(experienceId);
}

/**
 * Undo a merge of two places (ADR-0046 decision 5, ADR-0086): the folded place
 * is a place again, with what the merge moved. Merges into one place are undone
 * last first, and the refusal says which to undo first.
 */
export async function undoPlaceMerge(mergeId: number): Promise<MergeUndone> {
  return postExperiencesMergesByMergeIdUndo(mergeId);
}

/**
 * Get curation log for an experience
 */
export async function fetchCurationLog(
  experienceId: number,
): Promise<CurationLog> {
  return getExperiencesByIdCurationLog(experienceId);
}

/**
 * Unassign a manual experience from a region
 */
export async function unassignExperienceFromRegion(
  experienceId: number,
  regionId: number,
): Promise<RegionMembershipResult> {
  return deleteExperiencesByIdAssignByRegionId(experienceId, regionId);
}

/**
 * Remove an experience from a region entirely (any assignment type).
 * Unlike unassign, this works for both auto and manual assignments.
 * The rejection row is kept as a guard against spatial recompute.
 */
export async function removeExperienceFromRegion(
  experienceId: number,
  regionId: number,
): Promise<RegionMembershipResult> {
  return deleteExperiencesByIdRemoveFromRegionByRegionId(experienceId, regionId);
}
