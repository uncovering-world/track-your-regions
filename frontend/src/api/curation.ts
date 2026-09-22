/**
 * Curation API client
 *
 * A curator's writes on one object (curator-only): its place in a region, its
 * fields, its lifecycle and admission, its points and works, the source's
 * values a curator takes or declines, and publishing or refusing what a gated
 * run brought.
 */

import type { AdmissionResult, ContentKind, PublishResult } from '@tyr/shared/api';
import { API_URL, authFetchJson } from './fetchUtils';
import type { ImageCredit } from './experiences';

// The answers the backend declares as schemas (ADR-0066), generated into
// `@tyr/shared/api`. Passed on from here, so a component imports a call's answer
// from the module of the call. A call still missing from that list declares its
// answer in this file until its slice of #527 moves it.
export type { AdmissionResult, AppliedPart, ContentKind, PartNotFound, PublishResult } from '@tyr/shared/api';

/**
 * Reject an experience from a region
 */
export async function rejectExperience(
  experienceId: number,
  regionId: number,
  reason?: string,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ regionId, reason }),
  });
}

/**
 * Record what a curator decided about an object's lifecycle.
 *
 * Sending `membership: 'present'` on a row a run flagged is the "false alarm"
 * answer: the source hiccupped and nothing moved.
 */
export async function setExperienceState(
  experienceId: number,
  decision: {
    membership?: 'present' | 'former';
    existence?: 'extant' | 'lost';
    note?: string;
    /**
     * The row as the card showed it, flag included. Compared under the write
     * lock: a run that re-lists the object clears the flag without touching
     * either axis, so the axes alone cannot tell a live question from a
     * withdrawn one.
     */
    expected: { membership: 'present' | 'former'; existence: 'extant' | 'lost'; flagged: boolean };
  },
): Promise<{ experienceId: number; sourceMembership: 'present' | 'former'; existence: 'extant' | 'lost' }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/state`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
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
  decision: {
    membership?: 'present' | 'former';
    existence?: 'extant' | 'lost';
    note?: string;
    expected: { membership: 'present' | 'former'; existence: 'extant' | 'lost'; flagged: boolean };
  },
): Promise<{
  locationId: number;
  experienceId: number;
  sourceMembership: 'present' | 'former';
  existence: 'extant' | 'lost';
  offeredToReaders: boolean;
  /**
   * Present only where the verdict committed and re-placing the point into a world
   * view did not — so it is on the map (or off it) and the regions disagree.
   *
   * A verdict that changes what a reader sees is a placement event in either
   * direction, because a withdrawn point holds no `auto` region rows (ADR-0022) and a
   * `lost` one must hold none. Undeclared, this field was unreadable without a cast,
   * which is how the endpoint came to report a state no screen could show.
   */
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}> {
  return authFetchJson(`${API_URL}/api/experiences/locations/${locationId}/state`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
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
  correction: { name?: string; latitude?: number; longitude?: number },
): Promise<{
  success: true;
  locationId: number;
  /**
   * Whether the object's own coordinate moved with the place. True only where the
   * object holds exactly one visible, published place and this is it — the case in
   * which the source's locator and the place are one fact. A pending or withdrawn
   * place moves nothing, whatever the count, so a screen reads this rather than
   * promising it.
   */
  anchorMoved: boolean;
  /** The move committed; re-placing the object into a world view did not. */
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}> {
  return authFetchJson(`${API_URL}/api/experiences/locations/${locationId}/edit`, {
    method: 'PATCH',
    body: JSON.stringify(correction),
  });
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
  correction: { name?: string; artists?: string[]; year?: number | null; imageUrl?: string },
): Promise<{
  success: true;
  treasureId: number;
  /** The columns this edit took ownership of, which a later run will no longer touch. */
  claimed: Array<'name' | 'artists' | 'year' | 'image_url'>;
  /**
   * Who was named under the new picture, present only where the picture changed.
   *
   * Read rather than assumed: a Commons file whose credit request timed out is
   * stored with none, and a screen that promised a name would show the picture
   * as credited to nobody without saying that is what happened.
   */
  imageCredit?: ImageCredit | null;
}> {
  return authFetchJson(
    `${API_URL}/api/experiences/${experienceId}/works/${treasureId}/edit`,
    { method: 'PATCH', body: JSON.stringify(correction) },
  );
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
  decision: { decision: 'confirm' | 'override'; note?: string },
): Promise<AdmissionResult> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/admission`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

/**
 * Apply the value a sync proposed for a field the curator had claimed.
 */
export async function acceptSourceValue(
  experienceId: number,
  fields: string[],
  expectedSyncLogId: number,
): Promise<{
  experienceId: number;
  applied: string[];
  released: string[];
  /**
   * The points whose own claim on the coordinate was released with the object's.
   * Accepting `location` hands back the correction at both levels, because the
   * object's coordinate and its one visible point's are the same fact.
   */
  releasedPoints: number[];
  /**
   * Those of them the endpoint also put back on the coordinate that run offered
   * — releasing alone would have the next run retire the row instead of
   * rewriting it, since the pairing bounds a point's identity by distance.
   */
  movedPoints: number[];
  /**
   * Whether accepting the picture also dropped the credit the curator's own edit
   * wrote for it. A boolean rather than the value: what they need to know is
   * that the line under their photograph is gone.
   */
  releasedCredit?: boolean;
  placementFailed?: boolean;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
  fromSyncLogId: number;
}> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/accept-source`, {
    method: 'POST',
    body: JSON.stringify({ fields, expectedSyncLogId }),
  });
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
): Promise<{ experienceId: number; declined: string[]; fromSyncLogId: number }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/decline-source`, {
    method: 'POST',
    body: JSON.stringify({ fields, expectedSyncLogId }),
  });
}

/** What refusing one or more held rows settled. */
export interface DeclineHeldResult {
  experienceId: number;
  declinedFields: string[];
  declinedParts: Array<{ kind: string; name: string; fields: string[] }>;
  fromSyncLogId: number;
  /** Held rows still open. Zero means the card is gone and the pointer with it. */
  heldLeftOpen: number;
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
  selection: { fields?: string[]; parts?: HeldSelectionPart[] },
  expectedSyncLogId: number,
): Promise<DeclineHeldResult> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/decline-held`, {
    method: 'POST',
    body: JSON.stringify({ ...selection, expectedSyncLogId }),
  });
}

/**
 * The five shapes the endpoint accepts, as five shapes rather than seven optional
 * fields.
 *
 * A union because the server's own schema is one: `publishExperienceBodySchema`
 * refuses `fieldsOnly` beside `contentsOnly` or either id array, refuses
 * `expectedSyncLogId` on any contents publish, refuses a held selection beside a
 * contents publish — it already publishes the fields half — and refuses a held
 * selection *without* `expectedSyncLogId`, which is why the fifth member declares
 * it required: a per-row answer is about the proposal one run made. Typed as a bag of optionals, a
 * caller could write the combination that 400s and find out at runtime; typed as
 * this, the compiler refuses it at the call site — which is where the card is
 * being written and the intent is still legible.
 *
 * Exported so the screens share it instead of each narrowing a local copy: a
 * component-local union agrees with the server until the day the server gains a
 * shape, and then agrees with nothing.
 */
export type PublishRequest =
  /** The object: its held fields, its own state, and every unread row under it. */
  | { locationIds?: undefined; treasureIds?: undefined; contentsOnly?: undefined;
      fieldsOnly?: undefined; heldFields?: undefined; heldParts?: undefined;
      expectedSyncLogId?: number }
  /** Every pending content row, the object's own state left alone. */
  | { contentsOnly: true; locationIds?: undefined; treasureIds?: undefined;
      fieldsOnly?: undefined; heldFields?: undefined; heldParts?: undefined;
      expectedSyncLogId?: undefined }
  /** Exactly these rows, and nothing else. */
  | { locationIds?: number[]; treasureIds?: number[]; contentsOnly?: undefined;
      fieldsOnly?: undefined; heldFields?: undefined; heldParts?: undefined;
      expectedSyncLogId?: undefined }
  /** The object's held fields, and none of its unread contents (#524). */
  | { fieldsOnly: true; locationIds?: undefined; treasureIds?: undefined;
      contentsOnly?: undefined; heldFields?: undefined; heldParts?: undefined;
      expectedSyncLogId?: number }
  /**
   * Exactly these rows of the held proposal, and the rest left open (#722).
   *
   * The fields publish narrowed the way the id arrays narrow the contents one.
   * It carries no `fieldsOnly` because naming held rows already says so — not
   * because the server refuses the two together, which it deliberately does
   * not: a body restating its own half has one reading, unlike the pairs the
   * schema's `.refine`s forbid, so there is no defect to write a rule against.
   */
  | { heldFields?: string[]; heldParts?: HeldSelectionPart[]; locationIds?: undefined;
      treasureIds?: undefined; contentsOnly?: undefined; fieldsOnly?: undefined;
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
 *
 * `fieldsOnly: true` is the mirror, and the reason it exists is #524: a museum
 * whose label is held *and* which gained twelve paintings could only be answered
 * as one act, so declining the label kept the paintings invisible. It is
 * exclusive with all three contents shapes — a body naming both halves is asking
 * for the object publish it could have asked for by naming nothing.
 */
export async function publishExperience(
  experienceId: number,
  body: PublishRequest = {},
): Promise<PublishResult> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/publish`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * A curator's no to an arrival (#852, ADR-0053): the object is kept out the way a
 * rule-refused row is, and *Put it back* in the kept-out list is the way back.
 */
export async function refuseArrival(
  experienceId: number,
  note?: string,
): Promise<{ experienceId: number; admission: 'refused'; reason: string }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/refuse-arrival`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/**
 * A curator's no to the unread points and works under a visible object — the named
 * ones, or all of them (#852, ADR-0053). They stay hidden and stop being asked about.
 */
export async function refuseContents(
  experienceId: number,
  body: { locationIds?: number[]; treasureIds?: number[]; note?: string } = {},
): Promise<{
  experienceId: number;
  locationsRefused: number;
  treasureLinksRefused: number;
  /** Old pins a refused arrival had been holding on the map, now withdrawn and asking their own question. */
  withdrawalsReleased: number;
  /** The re-placement any refused point calls for — it counts toward no region now, and any pin it released is gone — where it failed; the publish's own shape. */
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/refuse-contents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
  body: { locationIds?: number[]; treasureIds?: number[]; note?: string } = {},
): Promise<{
  experienceId: number;
  locationsRestored: number;
  treasureLinksRestored: number;
  /** Exactly which points and works came back, as the statement returned them. */
  locationIds: number[];
  treasureIds: number[];
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/unrefuse-contents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Unreject an experience from a region
 */
export async function unrejectExperience(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/unreject`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

/**
 * Manually assign an experience to a region
 */
export async function assignExperienceToRegion(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

/**
 * Create a new manual experience under a chosen source
 */
export async function createManualExperience(data: {
  name: string;
  shortDescription?: string;
  /** The type within the kind the row is created under — never the kind itself, which is `kindId`. */
  type?: string;
  longitude: number;
  latitude: number;
  imageUrl?: string;
  tags?: string[];
  countryCode?: string;
  countryName?: string;
  regionId: number;
  kindId?: number;
  websiteUrl?: string;
  wikipediaUrl?: string;
}): Promise<{ id: number; name: string; externalId: string }> {
  return authFetchJson(`${API_URL}/api/experiences`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Edit an experience's fields (curator)
 */
export async function editExperience(
  experienceId: number,
  data: {
    name?: string;
    shortDescription?: string;
    description?: string;
    type?: string;
    imageUrl?: string;
    tags?: string[];
    websiteUrl?: string;
    wikipediaUrl?: string;
  },
): Promise<{ success: boolean; experienceId: number; curatedFields: string[] }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/edit`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Curation log entry
 */
export interface CurationLogEntry {
  id: number;
  action: string;
  region_id: number | null;
  region_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  curator_name: string;
}

/**
 * Get curation log for an experience
 */
export async function fetchCurationLog(
  experienceId: number,
): Promise<CurationLogEntry[]> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/curation-log`);
}

/**
 * Unassign a manual experience from a region
 */
export async function unassignExperienceFromRegion(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/assign/${regionId}`, {
    method: 'DELETE',
  });
}

/**
 * Remove an experience from a region entirely (any assignment type).
 * Unlike unassign, this works for both auto and manual assignments.
 * The rejection row is kept as a guard against spatial recompute.
 */
export async function removeExperienceFromRegion(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/remove-from-region/${regionId}`, {
    method: 'DELETE',
  });
}
