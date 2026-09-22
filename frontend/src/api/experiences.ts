/**
 * Experiences API client
 *
 * What a reader's screens ask of the catalogue: an object, a region's objects
 * and their places, the works and finds an object holds, the counts of the
 * region tree, and the New chips a reader has been shown. A curator's writes
 * are `curation.ts`; the review queue's calls are `reviewQueue.ts`.
 */

import type {
  ExperienceLocationsResponse, ImageCredit, RegionExperienceLocationsResponse,
} from '@tyr/shared/api';
import { API_URL, fetchJson, authFetchJson } from './fetchUtils';

// The answers the backend declares as schemas (ADR-0066), generated into
// `@tyr/shared/api`. Passed on from here, so a component imports a call's answer
// from the module of the call. A call still missing from that list declares its
// answer in this file until its slice of #527 moves it.
export type {
  ExperienceLocation,
  ExperienceLocationsResponse,
  ExperienceLocationWithState,
  ImageCredit,
  RegionExperienceLocation,
  RegionExperienceLocationsResponse,
} from '@tyr/shared/api';

// =============================================================================
// Types
// =============================================================================

export interface Experience {
  id: number;
  external_id: string;
  name: string;
  short_description: string | null;
  /**
   * The type within the kind — `cultural` / `natural` / `mixed` on a World Heritage
   * site, `monument` / `sculpture` on public art, `cathedral` / `church` / `chapel` /
   * `monastery` / `mosque` / `temple` / `shrine` / `synagogue` on a place of worship —
   * and `null` on a museum, whose kind has no types (ADR-0045, #814).
   */
  type: string | null;
  /** The kind, off the row's membership (#819) — what a colour and a group are decided by. */
  kind_id: number;
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
  /** The kind's name, and its display order — what the list groups and orders by. */
  kind_name: string;
  kind_priority?: number;
  location_count?: number;
  /** Offered + published treasure links. Drives `TreasuresInsideChip`. */
  treasure_count?: number;
  created_at?: string;
  // Curator rejection fields (only present when curator has scope)
  is_rejected?: boolean;
  rejection_reason?: string | null;
  // Lifecycle (ADR-0020, narrowed by ADR-0021). `lost` rows are filtered out of
  // every read that offers a *set* to go through — the lists, the map, search
  // and the counts — so `existence` is 'lost' only where they survive on
  // purpose: a visit history, a list the reader unfiltered, or a by-id answer.
  // `ExperienceDetail` extends this interface, so `fetchExperience` is the third
  // case: a by-id read hides a row the kind refused and leaves a `lost` one
  // reachable (`getExperience`'s own comment says why).
  source_membership?: 'present' | 'former';
  existence?: 'extant' | 'lost';
  /** Set by a run, cleared by any verdict. Sent back when correcting one. */
  missing_since?: string | null;
  /**
   * Decided by the server: the reader could first see this recently — the row has
   * been published, and either that publication is inside the kind's window or
   * this reader's own week has not run out.
   * Not "recently created", and not "found by the latest run" either: under a gated
   * source those are a curator's working week apart (#529). See
   * `experienceNewBadge.ts`.
   */
  is_new?: boolean;
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
 * A region an object can be opened at, in a world view the caller may see.
 *
 * The same shape on both reads that answer "where is this": the detail panel
 * offers every one of them as somewhere to go, and the search row opens one.
 */
export interface ExperienceRegionRef {
  id: number;
  name: string;
  world_view_id: number;
  world_view_name: string;
}

export interface ExperienceDetail extends Experience {
  /** The source that brought the row (`experiences.source_id`), beside the kind it is shown under. */
  source_id: number;
  name_local: Record<string, string> | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  boundary_geojson: GeoJSON.Geometry | null;
  area_km2: number | null;
  source_name: string;
  source_description: string | null;
  regions: ExperienceRegionRef[];
}

/**
 * One answer from `GET /api/experiences/search` — the columns that read sends,
 * rather than the whole of `Experience`, which it never did.
 *
 * `regions` is what makes an answer openable: the regions whose own lists hold
 * the object, in the world views a visitor may see, **most specific first**.
 * Empty where nothing published places it — 28 of the catalogue's 1577 visible
 * objects on 2026-09-01, the Great Barrier Reef and the Wadden Sea among them
 * (#469, #470). A row like that is still an answer about the catalogue; it is
 * simply not a link.
 */
export interface ExperienceSearchResult {
  id: number;
  name: string;
  short_description: string | null;
  /** The type within the kind; `null` on a museum (#814). */
  type: string | null;
  kind_id: number;
  /** Always present: every place has a membership, and every membership a kind. */
  kind_name: string;
  /** Nullable in the column, and so here — the row reads without it. */
  country_names: string[] | null;
  image_url: string | null;
  image_credit?: ImageCredit | null;
  source_membership?: 'present' | 'former';
  existence?: 'extant' | 'lost';
  missing_since?: string | null;
  longitude: number;
  latitude: number;
  relevance: number;
  regions: ExperienceRegionRef[];
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

/**
 * A kind of place a traveller browses by (ADR-0045 decision 1), as
 * `GET /api/experiences/kinds` lists them: only the kinds a source fills
 * today, in display order, each with the count of what it offers.
 */
export interface ExperienceKind {
  id: number;
  name: string;
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
 * Search experiences by name, across the whole catalogue.
 *
 * Two callers, one read: the visitor's search in the navigation pane, which
 * turns an answer into an address, and the curator's "search and assign"
 * dialog, which assigns one to the region it already has open.
 */
export async function searchExperiences(
  query: string,
  limit = 20
): Promise<{ query: string; results: ExperienceSearchResult[]; total: number }> {
  return fetchJson(`${API_URL}/api/experiences/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

/**
 * List the kinds a traveller browses by (#819)
 */
export async function fetchExperienceKinds(): Promise<ExperienceKind[]> {
  return fetchJson<ExperienceKind[]>(`${API_URL}/api/experiences/kinds`);
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
  /**
   * The columns a curator has claimed on the work (`treasures.curated_fields`),
   * so a row can say it has been corrected rather than letting a curator's
   * title read as the source's. `claimLabel` in `utils/workClaims.ts` turns it
   * into the words a row shows.
   */
  curated_fields?: string[];
  /**
   * How many museums hang this work. A work is one row shared by all of them
   * (ADR-0025 decision 2) — *The Great Wave off Kanagawa* is eleven — so the
   * correction dialog says how far a change reaches before it is saved.
   */
  venue_count?: number;
  year: number | null;
  image_url: string | null;
  /**
   * Whose photograph of the work this is. Beside the picture for the same
   * reason it is on the object above: a minority of Commons files are CC BY or
   * CC BY-SA, which of a screen showing a picture ask one thing — that the
   * photographer is named wherever it appears.
   */
  image_credit?: ImageCredit | null;
  /**
   * Where the object was dug up, for the kind whose works are finds: an
   * archaeology museum's holdings are things taken from somewhere, and that
   * somewhere is half of what the object is (ADR-0058) — the Rosetta Stone is
   * a British Museum object and a Fort Julien one, the fort at Rashid where it
   * was dug up. Absent on every work no run wrote it for; a painting has a
   * maker, not a find spot.
   */
  found_at?: { qid: string; label: string } | null;
  /**
   * The site row that spot names, where the catalogue holds one a reader may
   * open (#894) — so "found at Mycenae" is a way to Mycenae. Null where the spot
   * is a city, a region or a place no site door has written; the words stay.
   */
  found_at_site?: LinkedPlace | null;
  sitelinks_count: number;
}

/**
 * A place another card names, with what a link to it is built from: the
 * regions that name it to a reader, in published world views, smallest first —
 * the search read's list (ADR-0042). `openableRegion` picks the one in the
 * world view the reader is in; none there, and the name is words.
 */
export interface LinkedPlace {
  id: number;
  name: string;
  /** The kind the place is shown under — what Discover's address needs to open its list. */
  kind_id: number | null;
  regions: ExperienceRegionRef[];
}

/**
 * One find dug up at a site (#894): a museum's treasure whose discovery place
 * is the site, and every museum a reader may be sent to that shows it.
 */
export interface SiteFind {
  id: number;
  external_id: string;
  name: string;
  treasure_type: string;
  year: number | null;
  image_url: string | null;
  image_credit?: ImageCredit | null;
  is_iconic: boolean;
  sitelinks_count: number;
  /** One entry per building, never empty: a find nobody can go and see is not listed. */
  shown_at: LinkedPlace[];
}

export interface SiteFindsResponse {
  experienceId: number;
  finds: SiteFind[];
  total: number;
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
 * The finds dug up at a site and where they are shown (#894). Asked of a site
 * only — `hasExtent` says which rows are one — since the answer is empty for
 * everything else and the route sits under the same limiter as the reads that
 * draw the list.
 */
export async function fetchSiteFinds(experienceId: number): Promise<SiteFindsResponse> {
  return authFetchJson<SiteFindsResponse>(`${API_URL}/api/experiences/${experienceId}/finds`);
}

/**
 * Region experience count breakdown by source
 */
export interface RegionExperienceCount {
  region_id: number;
  region_name: string;
  region_color: string | null;
  has_subregions: boolean;
  kind_counts: Record<number, number>;
}

/**
 * Get experience counts per region per kind for a world view
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
