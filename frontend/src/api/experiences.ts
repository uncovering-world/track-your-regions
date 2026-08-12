/**
 * Experiences API client
 *
 * Public endpoints for browsing experiences.
 */

import { fetchJson, authFetchJson } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
// =============================================================================

export interface Experience {
  id: number;
  external_id: string;
  name: string;
  short_description: string | null;
  category: string | null;
  country_codes: string[];
  country_names: string[];
  image_url: string | null;
  date_inscribed?: string;
  in_danger: boolean;
  longitude: number;
  latitude: number;
  category_name: string;
  category_priority?: number;
  location_count?: number;
  created_at?: string;
  // Curator rejection fields (only present when curator has scope)
  is_rejected?: boolean;
  rejection_reason?: string | null;
  // Lifecycle (ADR-0020, narrowed by ADR-0021). `lost` rows are filtered out of
  // every read that offers a *set* to go through — the lists, the map, search
  // and the counts — so `existence` is 'lost' only where they survive on
  // purpose: a visit history, a list the reader unfiltered, or a by-id answer.
  // `ExperienceDetail` extends this interface, so `fetchExperience` is the third
  // case: a by-id read hides a row the category refused and leaves a `lost` one
  // reachable (`getExperience`'s own comment says why).
  source_membership?: 'present' | 'former';
  existence?: 'extant' | 'lost';
  /** Set by a run, cleared by any verdict. Sent back when correcting one. */
  missing_since?: string | null;
  /**
   * Decided by the server: observed arriving in the latest completed non-dry
   * run of its category, and still inside the category window or this reader's
   * own week.
   * Not "recently created" — see `experienceNewBadge.ts`.
   */
  is_new?: boolean;
}

/**
 * Individual location within a multi-location experience
 */
export interface ExperienceLocation {
  id: number;
  experience_id: number;
  name: string | null;
  external_ref: string | null;
  // Nullable: a point the source no longer lists has no place in that list. Either
  // its withdrawal is recorded and no read returns the row, or it is a point whose
  // replacement is still waiting to be published and readers do see it (ADR-0025
  // decision 5). `ORDER BY ordinal` puts it last. Use `locationLabel` rather than
  // arithmetic on this.
  ordinal: number | null;
  longitude: number;
  latitude: number;
  created_at: string;
  in_region?: boolean; // Whether this location is in the queried region
  region_path?: string | null; // Full region path (e.g. "Europe > France > Paris") for out-of-region display
}

/**
 * Location with visited status
 */
export interface LocationWithVisitedStatus {
  id: number;
  name: string | null;
  /** Nullable, for the reason given on `ExperienceLocation.ordinal`. */
  ordinal: number | null;
  longitude: number;
  latitude: number;
  isVisited: boolean;
  visitedAt: string | null;
  notes: string | null;
  inRegion?: boolean; // Whether location is in the current explored region
}

/**
 * Visited status for an experience
 */
export type VisitedStatus = 'not_visited' | 'partial' | 'visited';

/**
 * Experience visited status response
 */
export interface ExperienceVisitedStatusResponse {
  experienceId: number;
  visitedStatus: VisitedStatus;
  totalLocations: number;
  visitedLocations: number;
  locations: LocationWithVisitedStatus[];
}

/**
 * Experience locations response
 */
export interface ExperienceLocationsResponse {
  experienceId: number;
  experienceName: string;
  locations: ExperienceLocation[];
  totalLocations: number;
}

/**
 * Batch response: all locations for all experiences in a region
 */
export interface RegionExperienceLocationsResponse {
  locationsByExperience: Record<string, ExperienceLocation[]>;
}

export interface ExperienceDetail extends Experience {
  category_id: number;
  name_local: Record<string, string> | null;
  description: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  boundary_geojson: GeoJSON.Geometry | null;
  area_km2: number | null;
  category_description: string | null;
  regions: {
    id: number;
    name: string;
    world_view_id: number;
    world_view_name: string;
  }[];
}

export interface ExperiencesByRegionResponse {
  region: {
    id: number;
    name: string;
    world_view_name: string;
  };
  experiences: Experience[];
  total: number;
  /** How many this region holds that no longer exist and are not being shown. */
  lostHidden?: number;
  limit: number;
  offset: number;
}

export interface ExperienceCategory {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  display_priority: number;
  experience_count: string;
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Get single experience by ID
 */
export async function fetchExperience(id: number): Promise<ExperienceDetail> {
  // The experience itself is public, but the `regions[]` it returns is filtered
  // by world-view visibility — `getExperience` admits every assignment only for
  // an admin. Sent anonymously, that branch is unreachable from the app, so an
  // experience assigned only to hidden world views comes back with an empty
  // region list rather than an incomplete one, and the documented admin bypass
  // is nominal.
  return authFetchJson<ExperienceDetail>(`${API_URL}/api/experiences/${id}`);
}

/**
 * Asks for a whole region rather than a page of one.
 *
 * Neither surface that reads a region is paginated — there is no "load more" in
 * the map sidebar and none in Discover — so a `limit` below the region's size is
 * not a page, it is silent truncation. The backend orders by `e.name`, so the
 * cut lands mid-alphabet: Europe at 200 ended after "G", which dropped
 * `Museo del Prado` and `Museumsinsel` along with 456 others, and the map builds
 * its markers from the same array, so their pins went too. Matches the batch
 * location endpoint, which already returns a region whole.
 *
 * Equal to the backend's own ceiling, so it asks for everything the route will
 * ever hand over — the largest region today holds 658.
 */
export const WHOLE_REGION_LIMIT = 5000;

/**
 * Get experiences by region
 * Uses authFetchJson to send auth headers when available (optionalAuth on backend).
 * This enables curators to see rejected items marked with is_rejected.
 */
export async function fetchExperiencesByRegion(
  regionId: number,
  options?: {
    includeChildren?: boolean;
    limit?: number;
    offset?: number;
    /** Objects that no longer exist. Off unless the reader asked. */
    includeLost?: boolean;
  }
): Promise<ExperiencesByRegionResponse> {
  const params = new URLSearchParams();
  if (options?.includeChildren === false) params.set('includeChildren', 'false');
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.includeLost) params.set('includeLost', 'true');

  const query = params.toString();
  const querySuffix = query ? `?${query}` : '';
  return authFetchJson<ExperiencesByRegionResponse>(
    `${API_URL}/api/experiences/by-region/${regionId}${querySuffix}`
  );
}

/**
 * Search experiences
 */
export async function searchExperiences(
  query: string,
  limit = 20
): Promise<{ query: string; results: Experience[]; total: number }> {
  return fetchJson(`${API_URL}/api/experiences/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

/**
 * List experience categories
 */
export async function fetchExperienceCategories(): Promise<ExperienceCategory[]> {
  return fetchJson<ExperienceCategory[]>(`${API_URL}/api/experiences/categories`);
}

/**
 * Get locations for an experience (multi-location support)
 * @param regionId - Optional: include in_region flag for each location
 */
export async function fetchExperienceLocations(
  experienceId: number,
  regionId?: number
): Promise<ExperienceLocationsResponse> {
  const params = regionId ? `?regionId=${regionId}` : '';
  // Guarded on `regionId` like the batch below, but conditionally: the guard
  // engages only when one is passed and waves the request through when it is
  // absent. No call site passes one today — both callers want an experience's
  // locations, which is the only way to get them — so the header keeps this
  // route correct if a caller starts rather than covering one that exists.
  return authFetchJson<ExperienceLocationsResponse>(`${API_URL}/api/experiences/${experienceId}/locations${params}`);
}

/**
 * Get all locations for all experiences in a region (batch)
 * Eliminates N+1 individual location fetches
 */
export async function fetchRegionExperienceLocations(
  regionId: number,
  options?: { includeChildren?: boolean; includeLost?: boolean }
): Promise<RegionExperienceLocationsResponse> {
  const params = new URLSearchParams();
  if (options?.includeChildren === false) params.set('includeChildren', 'false');
  // Has to follow the list. A row the list is showing but this batch is not
  // arrives with no markers and a confident "0/N in region" — the denominator
  // comes from the experience, the numerator from here.
  if (options?.includeLost) params.set('includeLost', 'true');
  const query = params.toString();
  const querySuffix = query ? `?${query}` : '';
  // Authenticated for the same reason as fetchExperiencesByRegion, plus a
  // sharper one: `requireVisibleWorldView` guards this route, and a hidden world
  // view answers an anonymous caller with 404. Sent unauthenticated, the batch
  // failed for every experience in the region at once, and each row rendered the
  // absence as `0/N in region` — the count comes from this response while the
  // total falls back to `experience.location_count`.
  return authFetchJson<RegionExperienceLocationsResponse>(
    `${API_URL}/api/experiences/by-region/${regionId}/locations${querySuffix}`
  );
}

/**
 * Treasure item within an experience (artwork, artifact)
 */
export interface ExperienceTreasure {
  id: number;
  external_id: string;
  name: string;
  treasure_type: string;
  artist: string | null;
  year: number | null;
  image_url: string | null;
  sitelinks_count: number;
}

export interface ExperienceTreasuresResponse {
  experienceId: number;
  treasures: ExperienceTreasure[];
  total: number;
}

/**
 * Get treasures (artworks, artifacts) for an experience
 *
 * Authenticated, not `fetchJson`: `/:id/treasures` widens three
 * `curation_state` predicates (`$2::boolean OR …`) for a curator or admin
 * whose scope reaches the experience (`maySeeUnreadExperience`), and an
 * unauthenticated request cannot carry that scope at all — the boolean is
 * always `false`. Sent without the header, a curator opening a museum from
 * its own "unread contents" card saw exactly the published works an
 * anonymous reader sees, with nothing on screen to say more had arrived.
 */
export async function fetchExperienceTreasures(
  experienceId: number
): Promise<ExperienceTreasuresResponse> {
  return authFetchJson<ExperienceTreasuresResponse>(`${API_URL}/api/experiences/${experienceId}/treasures`);
}

/**
 * Region experience count breakdown by source
 */
export interface RegionExperienceCount {
  region_id: number;
  region_name: string;
  region_color: string | null;
  has_subregions: boolean;
  category_counts: Record<number, number>;
}

/**
 * Get experience counts per region per category for a world view
 * Used by Discover page tree navigation
 */
export async function fetchExperienceRegionCounts(
  worldViewId: number,
  parentRegionId?: number
): Promise<RegionExperienceCount[]> {
  const params = new URLSearchParams({ worldViewId: String(worldViewId) });
  if (parentRegionId) params.set('parentRegionId', String(parentRegionId));
  // `worldViewId` is mandatory on this route and the visibility guard reads it,
  // so on a hidden world view every anonymous call 404s and the Discover tree
  // renders counts it never received.
  return authFetchJson<RegionExperienceCount[]>(`${API_URL}/api/experiences/region-counts?${params}`);
}

// =============================================================================
// Curation API (curator-only)
// =============================================================================

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
 * An experience waiting on a curator's decision.
 *
 * `missing` means a run stopped finding it at the source; `conflict` means the
 * source wants a field the curator has claimed. Until someone answers, users
 * see the experience exactly as before.
 */
export interface ReviewQueueItem {
  id: number;
  external_id: string;
  name: string;
  category_id: number;
  category_name: string;
  /**
   * The lifecycle axes, on **every** kind rather than only the two whose cards
   * are about them. Required here and therefore selected by all seven queries
   * (`lifecycleSelectSql`), because the alternative — required in the type and
   * absent from five queries — is the trap that reads as a working comparison:
   * `item.existence === 'lost'` on an arrival card typechecks, compares against
   * `undefined`, and silently never fires.
   */
  missing_since: string | null;
  source_membership: 'present' | 'former';
  existence: 'extant' | 'lost';
  kind: 'missing' | 'conflict' | 'refused' | 'kept-out' | 'arrival' | 'held' | 'contents';
  /** Why this category turned the row down, in the rule's own words. Refused items only. */
  admission_reason?: string | null;
  /** When a curator answered. Kept-out items only. */
  state_decided_at?: string | null;
  /** What the curator wrote when they answered. Kept-out items only. */
  state_note?: string | null;
  /**
   * `acceptable` false means accepting releases the claim and the next run
   * writes it — a `conflict` field only. A `held` field carries `held: true`
   * instead and no `acceptable`: nobody claimed it, the category's gate kept it
   * out, and publishing is the only thing that can apply it (ADR-0025).
   *
   * `null` on the five kinds that carry no proposal, never absent: each of their
   * queries selects `NULL::jsonb AS proposed` explicitly, for the same reason
   * the three lifecycle fields above are selected everywhere. `Array<…> | null`
   * tells the next author that `item.proposed === null` is the whole check
   * before `.length`, and that is only true while every query answers with the
   * column.
   */
  proposed: Array<{
    field: string; old: unknown; new: unknown; acceptable?: boolean; held?: boolean;
  }> | null;
  /**
   * The run this card is about. For a `conflict` or a `held` proposal it is
   * sent back so a newer run cannot substitute itself. For an `arrival` it is
   * the run that first saw the row and is **not** a pointer to anything held —
   * sending it as `expectedSyncLogId` would 409 every time, because a row
   * nobody can see holds no proposal.
   */
  sync_log_id?: number;
  /**
   * Unread points under a row readers already see. `contents` items only.
   *
   * A number because the query casts it. `COUNT(*)` is `bigint`, which `pg`
   * hands over as a string, and an uncast count arrives here as `"12"` — which
   * survives arithmetic by coercion and breaks a plural rule, since `'1' === 1`
   * is false. The cast is pinned by a test in `reviewQueueController.test.ts`.
   */
  pending_locations?: number;
  /** Unread works under a row readers already see. `contents` items only. */
  pending_treasures?: number;
  /** Whether anyone has passed the row. `arrival` items only, where it is `pending`. */
  curation_state?: string;
}

export interface ReviewQueue {
  missing: ReviewQueueItem[];
  /** Rows a rule turned down and nobody has answered yet. Already hidden from readers (ADR-0024). */
  refused: ReviewQueueItem[];
  /**
   * Refusals a curator confirmed. Answered, not waiting — carried here because
   * this is the only surface they appear on at all: every read hides them, so
   * without this list a confirmed refusal could never be taken back.
   */
  keptOut: ReviewQueueItem[];
  conflicts: ReviewQueueItem[];
  /**
   * The three kinds a gated source leaves open (ADR-0025). Kept apart here
   * because each is one query; the page groups them by experience, since a
   * museum whose label is `held` and which gained twelve `contents` is one
   * decision to a curator.
   *
   * An arrival is always alone: `held` fires only on a row that is not
   * `pending`, and `contents` hides a `pending` container outright.
   */
  arrivals: ReviewQueueItem[];
  held: ReviewQueueItem[];
  contents: ReviewQueueItem[];
  limit: number;
  offset: number;
}

/**
 * What needs a curator's judgement, within their scope.
 */
export async function fetchReviewQueue(params: {
  categoryId?: number; limit?: number; offset?: number;
} = {}): Promise<ReviewQueue> {
  const search = new URLSearchParams();
  if (params.categoryId) search.set('categoryId', String(params.categoryId));
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  return authFetchJson<ReviewQueue>(`${API_URL}/api/experiences/review/queue?${search}`);
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
): Promise<{
  experienceId: number;
  admission: 'admitted' | 'refused';
  /**
   * Whether this override also made the row visible. True only where the row
   * was unread (`curation_state = 'pending'`) and the verdict was `override`:
   * putting a gated arrival back is what publishes it (ADR-0025), while an
   * override of an already-visible row answers the refusal and says nothing
   * about whether anyone has read it.
   */
  published: boolean;
  /** The experience's own state after the call — unchanged when `published` is false. */
  curationState: string;
  /** Always empty: an override never applies a held field. */
  appliedFields: string[];
  /** Always empty, for the same reason. */
  claimedFieldsSkipped: string[];
  /** Always null, for the same reason. */
  fromSyncLogId: number | null;
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  /** Points the source had replaced, no longer shown now their replacement is. */
  withdrawalsReleased: number;
  /** The publication landed; re-placing the object into its regions did not. */
  placementFailed?: true;
  /**
   * Which world views it did not land in, named rather than counted.
   *
   * The remedy is admin-only, so a curator's actionable step is to tell an admin
   * which object and which world views — a bare flag reduces them to "something
   * about regions failed". The publish endpoint answers with the same shape, so
   * the page renders one sentence for both.
   */
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}> {
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
): Promise<{ experienceId: number; applied: string[]; released: string[]; fromSyncLogId: number }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/accept-source`, {
    method: 'POST',
    body: JSON.stringify({ fields, expectedSyncLogId }),
  });
}

/** What a publication did, so the page can say it before the refetch. */
export interface PublishResult {
  experienceId: number;
  curationState: string;
  /** Held fields written now. */
  appliedFields: string[];
  /** Held fields left as the curator wrote them, because they claim them. */
  claimedFieldsSkipped: string[];
  fromSyncLogId: number | null;
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  /** Points the source had replaced, no longer shown now their replacement is. */
  withdrawalsReleased: number;
  /** The publication landed; re-placing the object into its regions did not. */
  placementFailed?: true;
  /**
   * Where the regions are stale now. Present exactly when `placementFailed` is.
   *
   * A curator cannot re-assign regions — that is admin-only — so the only thing
   * they can do with this is tell an admin which object and which world views.
   * `id: null` means the world views could not be listed at all, so none was
   * attempted and there is none to name.
   */
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}

/**
 * Say that a reader may see this — the only endpoint that applies a gate-held
 * field (ADR-0025).
 *
 * Not `accept-source`, which looks the same from a distance and is not an
 * option: its lookup requires `curatedConflict: true`, and a field held purely
 * by a category's gate carries `false`, so it would refuse every one of them.
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
  body: {
    locationIds?: number[]; treasureIds?: number[]; contentsOnly?: true; expectedSyncLogId?: number;
  } = {},
): Promise<PublishResult> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/publish`, {
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
  category?: string;
  longitude: number;
  latitude: number;
  imageUrl?: string;
  tags?: string[];
  countryCode?: string;
  countryName?: string;
  regionId: number;
  categoryId?: number;
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
    category?: string;
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

/**
 * Record that these chips have now been shown to the reader.
 *
 * Its own call rather than a side effect of the read that produced them: the
 * read stays repeatable, and a timestamp set by a prefetch is not an
 * impression. Only the first is kept server-side.
 */
export async function markNewBadgesSeen(experienceIds: number[]): Promise<{ recorded: number[] }> {
  return authFetchJson(`${API_URL}/api/experiences/new-badges/seen`, {
    method: 'POST',
    body: JSON.stringify({ experienceIds }),
  });
}
