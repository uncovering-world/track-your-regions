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

/**
 * The credit line a hosted picture has to carry.
 *
 * Every field is optional because the sources fill different ones: UNESCO names
 * a photographer and a rights holder, Commons a photographer and a licence with
 * a URL. What is common is that something must be shown.
 */
export interface ImageCredit {
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** The file page or the site's own page for the object: where the full terms are. */
  detailsUrl: string | null;
}

export interface Experience {
  id: number;
  external_id: string;
  name: string;
  short_description: string | null;
  category: string | null;
  country_codes: string[];
  country_names: string[];
  image_url: string | null;
  /**
   * Whose photograph this is. Sent beside the picture rather than only on the
   * detail read, because the condition CC BY and CC BY-SA impose is that the
   * author is named wherever the work is shown — a thumbnail in a list is
   * showing it.
   */
  image_credit?: ImageCredit | null;
  date_inscribed?: string;
  in_danger: boolean;
  /**
   * The year the site was inscribed on the List of World Heritage in Danger,
   * read on the server out of the listing the source sent ("Y 2013"). Null
   * where the listing carries no year, and absent from a read that does not
   * carry the field -- `inDangerLabel` treats the two the same way.
   */
  danger_since?: number | null;
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
   * Decided by the server: the reader could first see this recently — the row has
   * been published, and either that publication is inside the category's window or
   * this reader's own week has not run out.
   * Not "recently created", and not "found by the latest run" either: under a gated
   * source those are a curator's working week apart (#529). See
   * `experienceNewBadge.ts`.
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
 * ever hand over — the largest region today holds 661.
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
  /** Every maker the source names. The order is a curator's to confirm — see `artists_curated` (#720). */
  artists: string[];
  /**
   * Whether a curator has vouched for the order the makers are stored in.
   *
   * The stored order is a query planner's and not the source's (ADR-0040), so a
   * dense row leads with a name only once somebody has made that claim.
   */
  artists_curated: boolean;
  year: number | null;
  image_url: string | null;
  /**
   * Whose photograph of the work this is. Beside the picture for the same
   * reason it is on the object above: a minority of Commons files are CC BY or
   * CC BY-SA, which of a screen showing a picture ask one thing — that the
   * photographer is named wherever it appears.
   */
  image_credit?: ImageCredit | null;
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
 * One part of an object whose field a gated run held (ADR-0037), as the held
 * card carries it: the part as the run's record names it, the held fields, and
 * whatever the stored row can add so the part can be opened and told from its
 * siblings. The row's fields are null where no offered row answers to the record.
 */
export interface HeldPart {
  kind: 'locations' | 'treasures';
  item: { name: string | null; ref: string | null };
  fields: Array<{ field: string; old: unknown; new: unknown; held?: boolean }>;
  locationId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  ordinal?: number | null;
  treasureId?: number | null;
  artists?: string[] | null;
  artistsCurated?: boolean | null;
  year?: number | null;
  imageUrl?: string | null;
  imageCredit?: ImageCredit | null;
  treasureType?: string | null;
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
   * are about them. Required here and therefore selected by every one of the queries
   * (`lifecycleSelectSql`), because the alternative — required in the type and absent
   * from the kinds whose cards are not about it — is the trap that reads as a working
   * comparison:
   * `item.existence === 'lost'` on an arrival card typechecks, compares against
   * `undefined`, and silently never fires.
   */
  missing_since: string | null;
  source_membership: 'present' | 'former';
  existence: 'extant' | 'lost';
  kind: 'missing' | 'conflict' | 'refused' | 'kept-out' | 'arrival' | 'held' | 'contents'
    | 'withdrawn' | 'withdrawn-answered';
  /**
   * What the object is, carried on every kind for the same reason the lifecycle axes
   * are: one fragment feeds every one of the queries, so a card cannot show less about an
   * object than its neighbour. Every one of them is genuinely optional in the data —
   * 14 of 1604 rows have no image, and a landmark commonly has no website — so the
   * card renders what exists rather than reserving space for what does not.
   */
  image_url?: string | null;
  /** Whose photograph the card is showing — a curator's screen owes it too. */
  image_credit?: ImageCredit | null;
  latitude?: number | null;
  longitude?: number | null;
  website_url?: string | null;
  wikipedia_url?: string | null;
  region_names?: string[] | null;
  /**
   * The danger listing as the reader-facing reads carry it, so a card about
   * `inDanger` can say "listed since 2003" rather than reading as this year's
   * news. Through `withDangerFields` on every kind, like the rest of the object.
   */
  in_danger?: boolean;
  danger_since?: number | null;
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
   * `null` on every kind that carries no proposal, never absent: each of those
   * queries selects `NULL::jsonb AS proposed` explicitly, for the same reason
   * the three lifecycle fields above are selected everywhere. `Array<…> | null`
   * tells the next author that `item.proposed === null` is the whole check
   * before `.length`, and that is only true while every query answers with the
   * column.
   */
  proposed: Array<{
    field: string;
    old: unknown;
    new: unknown;
    acceptable?: boolean;
    held?: boolean;
    /**
     * Who claimed this field and when — absent where the claim predates the log, or
     * where the field is held by the gate rather than by a person. The card says "a
     * curator" for a claimant with no display name, because someone still decided.
     */
    claim?: { by: string; at: string } | null;
    /**
     * Every earlier answer on this same field, newest first — refusals as well as
     * acceptances, since a refusal shown as an acceptance is its own opposite.
     */
    decidedBefore?: Array<{
      by: string;
      at: string;
      /** Which answer it was. Absent on rows written before refusing was possible. */
      action?: 'accepted_source' | 'declined_source';
      /** What that answer was about: the value taken, or the one refused. */
      applied: unknown;
    }>;
  }> | null;
  /** When the run whose proposal this is finished. Conflicts only. */
  run_completed_at?: string | null;
  /**
   * The held fields of the object's *parts* — a place renamed, a work
   * re-attributed — under a gated source (ADR-0037). `held` items only, beside
   * `proposed`, which is the object's own; either may be null on a card about
   * the other, never both. Each carries the part as the run's record names it,
   * the held fields alone, and the stored row behind the record so the card can
   * open it — a coordinate and an ordinal for a place, the maker, the year and
   * the picture for a work. The row's fields are null where the record names a
   * part no offered row answers to any more: the proposal stands, with nothing
   * to open.
   */
  proposed_parts?: HeldPart[] | null;
  /**
   * The famous works the category's rule weighed, most widely known first, capped at twelve.
   *
   * Refusals only, and only because the refusal text talks about them: "0 of 5 famous
   * works are paintings" asks *which five*, and the answer is already in the catalogue —
   * a run imports a venue's works before deciding about the venue.
   */
  counted_works?: Array<{
    name: string;
    type: string | null;
    artists: string[];
    artistsCurated: boolean;
    imageUrl: string | null;
    /** Whose photograph of the work it is — `countedWorksSelectSql` sends it beside the URL. */
    imageCredit?: ImageCredit | null;
    year: number | null;
    /**
     * The source's own id for the work — a Wikidata QID for everything stored today.
     *
     * Sent so the preview is not a dead end: a curator who does not recognise a work needs
     * somewhere to go, and this is where it came from. Not nullable: `treasures.external_id`
     * is `NOT NULL UNIQUE` — the identity the works upsert conflicts on — and this field is
     * built straight off that column.
     */
    externalId: string;
  }> | null;
  /**
   * How many works the object holds — on **every** kind, beside `offered_locations`,
   * because the pair is what the object is made of.
   *
   * It began as a refusal's own arithmetic and outgrew it: a refusal that cites a
   * number is reconciled against that number, one that names a single work cites none,
   * and without this the preview cannot tell a holding of twelve from the first twelve
   * of thirty. The *named* array beside it is still refusals only — UNESCO sites hold
   * no works, and every kind that holds none would carry a join for an empty list.
   */
  counted_works_total?: number | null;
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
  /**
   * The unread points themselves, in the source's own order. `contents` items only.
   *
   * At most the first `CONTENTS_ROWS_SHOWN` of `pending_locations`, which stays the
   * whole number — the catalogue's largest serial nomination holds 758 points, and a
   * card is not a place to answer 758 questions. So a list shorter than the count is
   * a cap and the card says so, rather than a list that quietly stands for the rest.
   */
  pending_points?: Array<{
    id: number;
    name: string | null;
    externalRef: string | null;
    latitude: number | null;
    longitude: number | null;
  }>;
  /**
   * The unread works, most famous first. `contents` items only, capped like the
   * points above.
   *
   * Ordered by sitelinks rather than by name or arrival, because that is the order a
   * curator judges in: a museum that gained the Venus de Milo and eleven studies has
   * one row worth reading first.
   */
  pending_works?: Array<{
    id: number;
    name: string | null;
    artists: string[];
    artistsCurated: boolean;
    year: number | null;
    imageUrl: string | null;
    iconic: boolean;
  }>;
  /** Whether anyone has passed the row. `arrival` items only, where it is `pending`. */
  curation_state?: string;
  /**
   * How many points the object still offers — on **every** kind, like the lifecycle
   * axes and the object context above, and for the same reason: it is part of what
   * the object *is*.
   *
   * The denominator a departure needs, and equally the thing a text diff needs: "a
   * part is gone" reads one way at one of seven and another at the only one there
   * was, and a proposed description of one estate of seven is unreadable against the
   * whole site's without it. Optional in the type only because a queue response
   * predating this field would not carry it. Cast server-side, for the reason given
   * on `pending_locations`.
   */
  offered_locations?: number;
  /**
   * The points this object lost, each waiting on its own verdict. `withdrawn` items only.
   *
   * The verdict goes to `POST /api/experiences/locations/:id/state`, so the id is what
   * the card needs; the name and the reference are how it says *which* point, and most
   * UNESCO components carry a reference and no name of their own.
   */
  withdrawn_points?: Array<{
    id: number;
    name: string | null;
    externalRef: string | null;
    missingSince: string;
    latitude: number | null;
    longitude: number | null;
    /**
     * Whether anyone had been there. The visit survives either answer (ADR-0022) and
     * the point it hangs on stops being shown, which is what makes the verdict matter
     * rather than tidy-up.
     */
    visited: boolean;
    /**
     * How far away the source now offers this same part, in metres — `null` where it
     * offers it nowhere.
     *
     * Identity is the point together with the source's reference, so a coordinate
     * rewritten more than ten metres away arrives as a withdrawal plus an arrival, and
     * within that the writer reads it as the same place and raises no *new* card
     * (ADR-0027). Short distances still arrive here, though, by more than one route — the
     * backend comment above the subquery that fills this field enumerates them, and it is
     * worth reading which rather than assuming one, the count having moved twice as the
     * writer changed. `db/migrations/026` leaves a pair standing
     * where the marked row carries a visit or a region assignment; a database may not have
     * had 026 applied at all, nothing recording which files it has seen; and the pairing is
     * greedy, so it can mark a row while inserting one for the ordinal it lost, both within
     * ten metres of the same incoming point (decision 5a-i, #549). The last is a *new* card
     * rather than an inherited one. So anything up to ten metres can reach this field, which
     * is the band `withdrawalStory` answers with "the same place written more
     * precisely". A distance rather than a
     * flag because the flag could not be decided with: Bilbao's replacement is 1.2 cm
     * away — this field carries it as `0.01`, the query rounding to two decimals — the
     * stored latitude having been rounded before a later run wrote the source's full
     * value, and two coordinates rounded to four decimals showed the same numbers twice.
     */
    replacedMetres: number | null;
  }> | null;
  /**
   * The points this object lost that a curator has *answered*, and which no reader can
   * see as a result. `withdrawn-answered` items only.
   *
   * The same rows one verdict later, and the reason they need their own list is that the
   * verdict is what removed them from the one above: the queue asks about a flagged point
   * whose axes are still clean, and answering either axis takes the row out of it. No
   * other surface shows them — a point is not reachable at its own address, and every
   * reader-facing read hides one that is withdrawn or declared gone — so this list is
   * where a mis-click is taken back (#544).
   *
   * Both axes travel with each point because the card offers a way back from each one
   * separately, and because they are what the endpoint's `expected` is built from: a card
   * drawn before someone else answered collides rather than overwrites.
   *
   * No `replacedMetres` here, though the open card carries it: that field tells a
   * rewritten coordinate from a component that really moved, which is the question this
   * list is not re-asking.
   *
   * At most the first `CONTENTS_ROWS_SHOWN` of `answered_points_total`, newest answer
   * first. Capped where `withdrawn_points` is not, because this list only ever grows: a
   * point enters when it is answered and leaves only if the verdict is taken back.
   */
  answered_points?: Array<{
    id: number;
    name: string | null;
    externalRef: string | null;
    /** `null` where a later run found the point again and cleared the flag. */
    missingSince: string | null;
    latitude: number | null;
    longitude: number | null;
    sourceMembership: 'present' | 'former';
    existence: 'extant' | 'lost';
    /** When the standing answer was recorded. */
    decidedAt: string | null;
    /** What the curator wrote with it, if anything. */
    note: string | null;
    /**
     * Who last decided, read from the curation log under the log's own scope — `null`
     * where the act belongs to a region this reader does not cover, or predates the log.
     * The card says "a curator" then, because someone still decided.
     */
    decidedBy: string | null;
    /** Whether anyone had been there. The visit survives either answer (ADR-0022). */
    visited: boolean;
  }> | null;
  /**
   * How many answered points the object holds in all. `withdrawn-answered` items only.
   *
   * The whole number, beside a list that is the first `CONTENTS_ROWS_SHOWN` of it — the
   * pair `contents` carries, for the reason it carries it: a list without its total is a
   * silent cap, and this list is the one that only ever grows.
   */
  answered_points_total?: number;
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
  /**
   * Objects that lost a point the source stopped offering, waiting on a verdict
   * (ADR-0026). One entry per object, listing the points inside it, because a
   * serial site can lose two components in one run — and the verdict is per point.
   */
  withdrawn: ReviewQueueItem[];
  /**
   * The withdrawn points a curator has answered, carried for the reason `keptOut` is —
   * one level down. Answering is what took them out of `withdrawn`, and every
   * reader-facing read hides a point that is withdrawn or declared gone, so without this
   * list a verdict on a point could never be taken back (#544).
   */
  answeredWithdrawals: ReviewQueueItem[];
  limit: number;
  /**
   * Where each kind is and whether it has another page.
   *
   * `hasMore` is answered by the rows themselves — the server asks for one more than the
   * page and drops it — so no kind needs a `COUNT(*)`, and this endpoint keeps its
   * promise of returning no totals.
   */
  paging: Record<ReviewQueueKind, { offset: number; hasMore: boolean }>;
}

/** The arrays the queue returns, each paged on its own. */
export type ReviewQueueKind =
  'missing' | 'refused' | 'keptOut' | 'conflicts' | 'arrivals' | 'held' | 'contents'
  | 'withdrawn' | 'answeredWithdrawals';

/**
 * What needs a curator's judgement, within their scope.
 */
export async function fetchReviewQueue(params: {
  categoryId?: number;
  limit?: number;
  /**
   * Where each kind is, by kind. One number per kind rather than one shared, because the
   * queue is one query with one limit per kind: a single offset moved all of them at once, so a
   * kind whose page was full had a page 2 no control could ask for.
   */
  offsets?: Partial<Record<ReviewQueueKind, number>>;
} = {}): Promise<ReviewQueue> {
  const search = new URLSearchParams();
  if (params.categoryId) search.set('categoryId', String(params.categoryId));
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  for (const [kind, offset] of Object.entries(params.offsets ?? {})) {
    if (offset) search.set(`${kind}Offset`, String(offset));
  }
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
  /** Always empty: a held field of a part is a proposal too (ADR-0037), and an override answers none. */
  appliedParts: AppliedPart[];
  /** Always null, for the same reason. */
  fromSyncLogId: number | null;
  /** Always zero: an override answers no held row, so it leaves none behind either. */
  heldLeftOpen: number;
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
 * lookup requires one, so it would 409 on every field a category's gate held
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

/** One part publishing wrote to, as the server names it and the outcome line repeats it. */
export interface AppliedPart {
  kind: 'locations' | 'treasures';
  name: string;
  fields: string[];
  claimedFieldsSkipped: string[];
}

/** A part the proposal named that no offered row answers to. */
export interface PartNotFound {
  kind: 'locations' | 'treasures';
  name: string;
}

/** What a publication did, so the page can say it before the refetch. */
export interface PublishResult {
  experienceId: number;
  curationState: string;
  /** Held fields written now. */
  appliedFields: string[];
  /** Held fields left as the curator wrote them, because they claim them. */
  claimedFieldsSkipped: string[];
  /**
   * The parts whose held fields were written now (ADR-0037), each with what it
   * applied and what it left as the curator wrote it. Empty on a contents
   * publish, which leaves the proposal where it was.
   */
  appliedParts: AppliedPart[];
  /**
   * Parts the proposal named that no offered row answers to any more — a place
   * the source withdrew after proposing its rename. Present only when there is
   * one; nothing was written to them and nothing readers see changed.
   */
  partsNotFound?: PartNotFound[];
  fromSyncLogId: number | null;
  /**
   * Held rows this call left open, at both levels (#722).
   *
   * Non-zero exactly when the card is still standing, because the pointer that
   * keys it was kept — which `publishOutcomeFor` says as a state rather than as
   * this number, since the table does not draw every field the run held. Read
   * whole in the audit row, where the vocabulary is the record's.
   */
  heldLeftOpen: number;
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
  kind: 'locations' | 'treasures';
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
