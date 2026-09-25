/**
 * Every TanStack Query key the web builds, by entity (#790, ADR-0008).
 *
 * A key is a claim about what a cached answer is an answer *to*, and an
 * invalidation is a claim about which answers a write made stale. Both are
 * built here, so a key and the invalidation that reaches it are the same
 * expression and cannot come to name different caches;
 * `frontend/eslint.config.mjs` refuses a literal key array anywhere else.
 *
 * Each entity has its whole-entity prefix (`all`, or the name of the family)
 * beside the builders for single answers. TanStack matches by prefix, so
 * invalidating `experience.locationsAll` reaches every object's locations and
 * `experience.locations(id)` reaches one; the arrays are the ones the web has
 * always used, so a prefix reaches exactly what it reached before.
 *
 * **An answer that depends on who is asking carries the caller** (`forCaller`,
 * the `visited` family): the world-view list is filtered by the caller's role,
 * and visited state is per user. Signing in or out clears the whole cache as
 * well (`useAuth`), but a key that names the caller is right on its own rather
 * than because a clear happened to run.
 */

import type { WorldPointsQuery } from './worldPoints';

type Id = number | null | undefined;
/** Whoever is asking: a signed-in user's id, or `anon`. */
type Caller = number | null | undefined;
const caller = (userId: Caller) => userId ?? 'anon';

export const queryKeys = {
  worldViews: {
    all: ['worldViews'] as const,
    /** The world views this caller may see: public ones, and theirs. */
    forCaller: (userId: Caller) => ['worldViews', caller(userId)] as const,
  },

  regions: {
    /** A world view's regions, as the editor and the tree read them. */
    all: ['regions'] as const,
    list: (worldViewId: Id) => ['regions', worldViewId] as const,
    rootsAll: ['rootRegions'] as const,
    roots: (worldViewId: Id) => ['rootRegions', worldViewId] as const,
    /** A region's children; `root` for the top of a world view. */
    subregionsAll: ['subregions'] as const,
    subregions: (parentId: number | 'root' | 'all-leaf' | null | undefined) => ['subregions', parentId] as const,
    membersAll: ['regionMembers'] as const,
    members: (regionId: Id) => ['regionMembers', regionId] as const,
    /** The editor's outline of one region; a display mode narrows it further. */
    geometryAll: ['regionGeometry'] as const,
    geometry: (regionId: Id) => ['regionGeometry', regionId] as const,
    geometryAs: (regionId: Id, displayMode: string) => ['regionGeometry', regionId, displayMode] as const,
    ancestors: (regionId: Id) => ['regionAncestors', regionId] as const,
  },

  divisions: {
    children: (worldViewId: Id, divisionId: Id) => ['divisions', worldViewId, divisionId] as const,
    metadata: (parentId: number | 'root' | null | undefined) => ['divisionMetadata', parentId] as const,
    ancestors: (divisionId: Id, worldViewId: Id) => ['divisionAncestors', divisionId, worldViewId] as const,
  },

  search: {
    divisions: (query: string, worldViewId: Id) => ['search', 'divisions', query, worldViewId] as const,
    regions: (query: string, worldViewId: Id) => ['search', 'regions', query, worldViewId] as const,
    experiences: (query: string) => ['search', 'experiences', query] as const,
    /** The editor's division search, which adds members to a region. */
    editor: (query: string, worldViewId: Id) => ['search', 'editor', query, worldViewId] as const,
  },

  /** One object and what it is made of. */
  experience: {
    all: ['experience'] as const,
    one: (id: Id) => ['experience', id] as const,
    locationsAll: ['experience-locations'] as const,
    locations: (id: Id) => ['experience-locations', id] as const,
    contentsAll: ['experience-contents'] as const,
    contents: (id: Id) => ['experience-contents', id] as const,
    siteFinds: (id: Id) => ['site-finds', id] as const,
    curationLogAll: ['curation-log'] as const,
    curationLog: (id: Id) => ['curation-log', id] as const,
  },

  /** The lists objects appear in, and the points that place them. */
  experiences: {
    all: ['experiences'] as const,
    /** A region's list, every `showLost` variant of it. */
    inRegion: (regionId: Id) => ['experiences', 'by-region', regionId] as const,
    byRegion: (regionId: Id, showLost: boolean) => ['experiences', 'by-region', regionId, showLost] as const,
    search: (query: string) => ['experiences', 'search', query] as const,
    kinds: ['experience-kinds'] as const,
    regionLocationsAll: ['region-locations'] as const,
    /** A region's location batch, every `includeLost` and `includeChildren` variant of it. */
    regionLocationsIn: (regionId: Id) => ['region-locations', regionId] as const,
    regionLocations: (regionId: Id, includeLost: boolean, includeChildren: boolean) =>
      ['region-locations', regionId, includeLost, includeChildren] as const,
    worldPointsAll: ['world-points'] as const,
    /**
     * The key a world-points answer is cached under: the whole question,
     * nothing else. React Query hashes it structurally, so two views that ask
     * the same question are one cache entry — which is what snapping the box
     * (`worldPointsView.ts`) is for.
     */
    worldPoints: (query: WorldPointsQuery) =>
      ['world-points', query.kindId, query.detail, query.folded, query.box] as const,
  },

  discover: {
    experiencesAll: ['discover-experiences'] as const,
    experiences: (regionId: Id) => ['discover-experiences', regionId] as const,
    regionCountsAll: ['discover-region-counts'] as const,
    regionCounts: (worldViewId: Id, parentId: Id) => ['discover-region-counts', worldViewId, parentId] as const,
  },

  curation: {
    /** Every page of the queue, under whatever filter: what an answer invalidates. */
    reviewQueueAll: ['curation', 'reviewQueue'] as const,
    reviewQueue: (...page: readonly unknown[]) => ['curation', 'reviewQueue', ...page] as const,
    scopes: ['curator-scopes'] as const,
  },

  /** Per user: each key names the caller. */
  visited: {
    experiencesAll: ['visited-experiences'] as const,
    experiences: (userId: Caller, kindId: Id) => ['visited-experiences', caller(userId), kindId] as const,
    locationsAll: ['visited-locations'] as const,
    locations: (userId: Caller, experienceId: Id) => ['visited-locations', caller(userId), experienceId] as const,
    statusAll: ['experience-visited-status'] as const,
    status: (userId: Caller, experienceId: Id) => ['experience-visited-status', caller(userId), experienceId] as const,
    treasuresAll: ['viewed-treasures'] as const,
    treasures: (userId: Caller, experienceId: Id) => ['viewed-treasures', caller(userId), experienceId] as const,
    regions: (userId: Caller, worldViewId: Id) => ['visited-regions', caller(userId), worldViewId] as const,
  },

  ai: {
    settings: ['ai-settings'] as const,
    usage: ['ai-usage'] as const,
    rules: ['ai-rules'] as const,
  },

  admin: {
    sources: ['admin', 'sources'] as const,
    experienceCounts: (worldViewId: Id, sourceId: Id) => ['admin', 'experienceCounts', worldViewId, sourceId] as const,
    dataAssertions: ['admin', 'data-assertions'] as const,
    curators: ['admin', 'curators'] as const,
    curatorActivity: (userId: Id) => ['admin', 'curatorActivity', userId] as const,
    userSearch: (query: string) => ['admin', 'userSearch', query] as const,
    regionSearch: (worldViewId: Id, query: string) => ['admin', 'regionSearch', worldViewId, query] as const,
    coverageRegionSearch: (worldViewId: Id, query: string) =>
      ['admin', 'coverageRegionSearch', worldViewId, query] as const,
    gapMoveSearch: (worldViewId: Id, query: string) => ['admin', 'gapMoveSearch', worldViewId, query] as const,
    syncLogsAll: ['admin', 'syncLogs'] as const,
    syncLogs: (page: number, rowsPerPage: number) => ['admin', 'syncLogs', page, rowsPerPage] as const,
    syncLog: (logId: Id) => ['admin', 'syncLog', logId] as const,
    syncChanges: (logId: Id, significantOnly: boolean, page: number) =>
      ['admin', 'syncChanges', logId, significantOnly, page] as const,
    wikidataCache: (sourceId: Id) => ['admin', 'wikidata-cache', sourceId] as const,
    wvExtractStatus: ['admin', 'wvExtract', 'status'] as const,
    wvImport: {
      importStatus: ['admin', 'wvImport', 'importStatus'] as const,
      matchTree: (worldViewId: Id) => ['admin', 'wvImport', 'matchTree', worldViewId] as const,
      matchStats: (worldViewId: Id) => ['admin', 'wvImport', 'matchStats', worldViewId] as const,
      coverage: (worldViewId: Id) => ['admin', 'wvImport', 'coverage', worldViewId] as const,
      childrenCoverage: (worldViewId: Id) => ['admin', 'wvImport', 'childrenCoverage', worldViewId] as const,
      rematchStatusAll: ['admin', 'wvImport', 'rematchStatus'] as const,
      rematchStatus: (worldViewId: Id) => ['admin', 'wvImport', 'rematchStatus', worldViewId] as const,
    },
  },
} as const;
