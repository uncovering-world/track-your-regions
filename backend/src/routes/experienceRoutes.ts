/**
 * Experience Routes
 *
 * Public endpoints for browsing experiences.
 * User visited endpoints are in userRoutes.ts
 */

import { defineRoute, routerOf } from '../api/route.js';
import {
  AcceptSourceResult,
  AdmissionResult,
  CurationLog,
  DeclineHeldResult,
  DeclineSourceResult,
  ExperienceEditResult,
  ExperienceStateResult,
  LocationEditResult,
  LocationStateResult,
  ManualExperienceCreated,
  PublishResult,
  RefuseArrivalResult,
  RefuseContentsResult,
  RegionMembershipResult,
  UnrefuseContentsResult,
  WorkEditResult,
} from '../api/responses/curation.js';
import { PublishWaitingResult } from '../api/responses/admin.js';
import { ReviewAnswerResult, ReviewQueue, RunSetAside } from '../api/responses/reviewQueue.js';
import {
  ExperienceDetail,
  ExperienceKinds,
  ExperienceLocationsResponse,
  ExperienceSearch,
  ExperiencesByRegionResponse,
  ExperienceTreasuresResponse,
  NewBadgesSeen,
  RegionExperienceCounts,
  RegionExperienceLocationsResponse,
  SiteFindsResponse,
} from '../api/responses/experiences.js';
import { WorldPointsResponse } from '../api/responses/worldPoints.js';
import {
  getExperience,
  getExperiencesByRegion,
  getExperienceRegionCounts,
  getRegionExperienceLocations,
  listKinds,
  searchExperiences,
  getExperienceLocations,
  getExperienceTreasures,
  getSiteFinds,
  getWorldPoints,
  rejectExperience,
  unrejectExperience,
  assignExperienceToRegion,
  unassignExperienceFromRegion,
  removeExperienceFromRegion,
  createManualExperience,
  editExperience,
  getCurationLog,
  getReviewQueue,
  setRunAside,
  bringRunBack,
  setExperienceAdmission,
  setExperienceState,
  setLocationState,
  editLocation,
  editWork,
  acceptSourceValue,
  declineSourceValue,
  declineHeldValue,
  publishExperience,
  publishWaiting,
  refuseArrival,
  refuseContents,
  unrefuseContents,
  answerReviewRows,
  markNewBadgesSeen,
} from '../controllers/experience/index.js';
import { publicReadLimiter, searchLimiter, authenticatedLimiter } from '../middleware/rateLimiter.js';
import {
  experienceSearchQuerySchema,
  experiencesByRegionQuerySchema,
  experienceRegionCountsQuerySchema,
  experienceLocationsQuerySchema,
  worldPointsQuerySchema,
  regionLocationsQuerySchema,
  idParamSchema,
  sourceIdParamSchema,
  reviewQueueQuerySchema,
  syncLogIdParamSchema,
  experienceAdmissionBodySchema,
  refuseArrivalBodySchema,
  refuseContentsBodySchema,
  reviewAnswerBodySchema,
  newBadgesSeenBodySchema,
  lifecycleStateBodySchema,
  editLocationBodySchema,
  editWorkBodySchema,
  workEditParamsSchema,
  locationIdParamSchema,
  acceptSourceBodySchema,
  declineSourceBodySchema,
  declineHeldBodySchema,
  publishExperienceBodySchema,
  regionIdParamSchema,
  idAndRegionIdParamSchema,
  rejectExperienceBodySchema,
  unrejectExperienceBodySchema,
  assignExperienceBodySchema,
  editExperienceBodySchema,
  createManualExperienceBodySchema,
} from '../types/index.js';

// =============================================================================
// Reads (ADR-0071)
// =============================================================================

export const experienceReadRoutes = [
  // Search experiences (full-text search)
  defineRoute({
    method: 'get', path: '/search', access: 'public', cache: 'shared-revalidate', limiter: searchLimiter,
    query: experienceSearchQuerySchema,
    response: ExperienceSearch,
    handler: searchExperiences,
  }),
  // List the kinds a traveller browses by (#819)
  defineRoute({
    method: 'get', path: '/kinds', access: 'public', cache: 'shared-revalidate', limiter: publicReadLimiter,
    response: ExperienceKinds,
    handler: listKinds,
  }),
  // The catalogue's places across the whole world, before a region is chosen
  // (#910). Above `/:id`, since a one-segment literal path of the same method
  // must not be read as an id — the order `routerOf` refuses to get wrong.
  //
  // Public, and that is the whole scope of the endpoint rather than an
  // omission: like `/search` and `/:id/finds`, it names only what any reader may
  // open and answers the same to everyone. The curator relaxation of ADR-0025
  // stops at the three by-id reads, so there is no caller-shaped answer here to
  // widen — which is also why this read may be cached and shared.
  defineRoute({
    method: 'get', path: '/points', access: 'public', cache: 'shared-revalidate', limiter: publicReadLimiter,
    query: worldPointsQuerySchema,
    response: WorldPointsResponse,
    handler: getWorldPoints,
  }),
  // Experience counts per region per kind (the Discover page's tree). `optional`
  // for the world view's own visibility, which an admin bypasses.
  defineRoute({
    method: 'get', path: '/region-counts', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    query: experienceRegionCountsQuerySchema,
    scope: ({ query }) => ({ worldViewId: query.worldViewId }),
    response: RegionExperienceCounts,
    handler: getExperienceRegionCounts,
  }),
  // Experiences by region (`optional`: a curator sees rejected items marked)
  defineRoute({
    method: 'get', path: '/by-region/:regionId', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    params: regionIdParamSchema,
    query: experiencesByRegionQuerySchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: ExperiencesByRegionResponse,
    handler: getExperiencesByRegion,
  }),
  // All locations for all experiences in a region (batch, eliminates N+1)
  defineRoute({
    method: 'get', path: '/by-region/:regionId/locations', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    params: regionIdParamSchema,
    query: regionLocationsQuerySchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: RegionExperienceLocationsResponse,
    handler: getRegionExperienceLocations,
  }),
  // One experience (`optional`: 404s on a refused row (ADR-0024) and on an
  // unread `pending` row outside a curator/admin's scope (ADR-0025); its
  // regions[] are filtered in the handler on two axes — the world view's own
  // visibility, which only an admin bypasses, and whether the region holds a
  // point of this object that this caller may see (#521), which a curator whose
  // scope reaches the object bypasses too, a manual assignment being exempt)
  defineRoute({
    method: 'get', path: '/:id', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    params: idParamSchema,
    response: ExperienceDetail,
    handler: getExperience,
  }),
  // An experience's locations (multi-location support). The region it is asked
  // about, when it names one, is held to that region's world view.
  defineRoute({
    method: 'get', path: '/:id/locations', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    params: idParamSchema,
    query: experienceLocationsQuerySchema,
    scope: ({ query }) => (query.regionId === undefined ? undefined : { regionId: query.regionId }),
    response: ExperienceLocationsResponse,
    handler: getExperienceLocations,
  }),
  // Treasures (artworks, artifacts) of an experience (`optional`: a curator or
  // admin reaching a gated museum from the queue sees its unread treasures too —
  // see getExperienceTreasures/maySeeUnreadExperience, ADR-0025)
  defineRoute({
    method: 'get', path: '/:id/treasures', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    params: idParamSchema,
    response: ExperienceTreasuresResponse,
    handler: getExperienceTreasures,
  }),
  // The finds dug up at a site and the museums that show them (#894). Public:
  // like /search, it names only what a reader may open and answers the same to
  // everyone, so it is not a caller-shaped read.
  defineRoute({
    method: 'get', path: '/:id/finds', access: 'public', cache: 'shared-revalidate', limiter: publicReadLimiter,
    params: idParamSchema,
    response: SiteFindsResponse,
    handler: getSiteFinds,
  }),
];

// =============================================================================
// Curation (ADR-0071): a curator's writes and reads on the catalogue, each
// answered for the caller alone.
// =============================================================================

export const experienceCurationRoutes = [
  // Create a new manual experience (Curator Picks)
  defineRoute({
    method: 'post', path: '/', access: 'curator', cache: 'no-store',
    status: 201,
    body: createManualExperienceBodySchema,
    response: ManualExperienceCreated,
    handler: createManualExperience,
  }),

  // Reject an experience from a region
  defineRoute({
    method: 'post', path: '/:id/reject', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: rejectExperienceBodySchema,
    response: RegionMembershipResult,
    handler: rejectExperience,
  }),

  // Unreject an experience from a region
  defineRoute({
    method: 'post', path: '/:id/unreject', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: unrejectExperienceBodySchema,
    response: RegionMembershipResult,
    handler: unrejectExperience,
  }),

  // Manually assign an experience to a region
  defineRoute({
    method: 'post', path: '/:id/assign', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: assignExperienceBodySchema,
    response: RegionMembershipResult,
    handler: assignExperienceToRegion,
  }),

  // Edit an experience's fields (curator)
  defineRoute({
    method: 'patch', path: '/:id/edit', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: editExperienceBodySchema,
    response: ExperienceEditResult,
    handler: editExperience,
  }),

  // Get curation log for an experience
  defineRoute({
    method: 'get', path: '/:id/curation-log', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    response: CurationLog,
    handler: getCurationLog,
  }),

  // Records that the reader has now seen these chips. A POST because it writes:
  // the read that produced the chips stays idempotent, and an impression set by
  // a prefetch or a crawler is not one. No `/:id/…` route of its method and
  // segment count has a parameter where this has `seen`, so no id can take it,
  // and `routerOf` refuses the order that would.
  //
  // Rate-limited as an ordinary authenticated user action — `authenticatedLimiter`
  // is what docs/tech/rate-limiting.md's table gives those, and this is the one
  // endpoint here a client calls on its own initiative rather than in response to a
  // click.
  //
  // Curation routes below carry the same limiter, and the reason differs rather
  // than the presence. This one is limited because an unauthenticated-shaped
  // user action needs a ceiling; most of those are limited despite being
  // `curator` because a branch of theirs does post-commit region placement that
  // costs the same whoever sends it (§ 5), and the set-aside pair is limited as
  // an ordinary curator action, as `docs/tech/rate-limiting.md` says of it. A curation route
  // added here is exempt by default and joins them only if it reaches that kind of
  // work.
  defineRoute({
    method: 'post', path: '/new-badges/seen', access: 'signed-in', cache: 'no-store', limiter: authenticatedLimiter,
    body: newBadgesSeenBodySchema,
    response: NewBadgesSeen,
    handler: markNewBadgesSeen,
  }),

  // Decisions a sync run cannot make for itself: whether an object the source
  // stopped listing is delisted, destroyed, or was never gone, and whether a
  // value the source proposed should displace a curator's edit.
  defineRoute({
    method: 'get', path: '/review/queue', access: 'curator', cache: 'no-store',
    query: reviewQueueQuerySchema,
    response: ReviewQueue,
    handler: getReviewQueue,
  }),
  // A curator's own "not now" on a run's whole batch (ADR-0051 decision 4), and
  // the way back — `reviewQueueSetAside.ts` has the reasoning, including why
  // neither needs an object-scope check. Three segments, so `set-aside` cannot
  // be read as an id the way `/:id/state` below could otherwise mistake it for.
  defineRoute({
    method: 'put', path: '/review/set-aside/:syncLogId', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: syncLogIdParamSchema,
    response: RunSetAside,
    handler: setRunAside,
  }),
  defineRoute({
    method: 'delete', path: '/review/set-aside/:syncLogId', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: syncLogIdParamSchema,
    response: RunSetAside,
    handler: bringRunBack,
  }),
  // A selection of rows, one answer (#852): the batch form of every single-row
  // answer above and below, answering each object through the writer its own
  // card calls, one transaction and one audit row per object. Rate-limited on
  // § 5's criterion with `publish-waiting`'s force — up to a hundred publishes,
  // and a verdict on a withdrawn point re-places the object after its commit,
  // once per point. Two segments under `review/`, so `/:id/…` cannot take it.
  defineRoute({
    method: 'post', path: '/review/answer', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    body: reviewAnswerBodySchema,
    response: ReviewAnswerResult,
    handler: answerReviewRows,
  }),
  defineRoute({
    method: 'post', path: '/:id/state', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: lifecycleStateBodySchema,
    response: ExperienceStateResult,
    handler: setExperienceState,
  }),
  // The same question about one point inside the object (ADR-0026, #541). Three
  // segments, so it cannot collide with `/:id/state` above.
  //
  // Rate-limited where its object-level twin is not, and on the criterion rather than
  // on resemblance (`docs/tech/rate-limiting.md` § 5): an answer that changes what a
  // reader sees re-places the point, in either direction. A withdrawn point holds no
  // `auto` region rows — the run that marked it re-placed the experience, and placement
  // takes offered points only — so revealing one has to place it, and hiding one has to
  // stop it counting toward a region. Either way the call is `placeAfterRelease` after
  // committing, exactly as a publication releasing a withdrawal does, and it costs the
  // same regardless of who sends it.
  defineRoute({
    method: 'post', path: '/locations/:locationId/state', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: locationIdParamSchema,
    body: lifecycleStateBodySchema,
    response: LocationStateResult,
    handler: setLocationState,
  }),
  // The correction beside the verdict, and rate-limited with it: it writes a claim,
  // moves the object's anchor where the object is one point, and re-places the
  // experience into regions afterwards — the same shape of work as the line above.
  defineRoute({
    method: 'patch', path: '/locations/:locationId/edit', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: locationIdParamSchema,
    body: editLocationBodySchema,
    response: LocationEditResult,
    handler: editLocation,
  }),

  // A curator's correction to one work of one museum: what it is called, who made
  // it, when. The museum is in the path because a work hangs in more than one and
  // carries no scope of its own — see `workEditController`.
  //
  // No limiter, verified rather than assumed against § 5's criterion: the cost that
  // puts a curator route in the limited table is post-commit placement, and
  // nothing follows this handler's `client.release()` — a work
  // has no coordinate, so nothing it writes can move a pin. That puts it beside
  // `/:id/decline-source` and `/:id/decline-held` rather than beside its own
  // sibling `/locations/:locationId/edit`, which is limited precisely because a
  // corrected coordinate always re-places the object.
  defineRoute({
    method: 'patch', path: '/:id/works/:treasureId/edit', access: 'curator', cache: 'no-store',
    params: workEditParamsSchema,
    body: editWorkBodySchema,
    response: WorkEditResult,
    handler: editWork,
  }),
  // Rate-limited for the same reason `/:id/publish` below is, and it is the same
  // branch rather than a similar one: overriding a refusal on a gated arrival
  // publishes its contents through the shared `publishContents`, so it can release
  // a deferred withdrawal, and `setExperienceAdmission` then calls
  // `placeAfterAdmissionRelease` → `placeAfterRelease` after its client is
  // released — `assignRegionsForExperiences` once per world view with geometry.
  // Post-commit work that is expensive regardless of who sends it, which is the
  // criterion in `docs/tech/rate-limiting.md` § 5.
  defineRoute({
    method: 'post', path: '/:id/admission', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: idParamSchema,
    body: experienceAdmissionBodySchema,
    response: AdmissionResult,
    handler: setExperienceAdmission,
  }),
  // Joined the limited set when accepting a coordinate stopped being a pure claim
  // release: it puts the object's pin back on the source's coordinate, and a pin
  // that moves is a region fact, so this too reaches `placeAfterRelease` after its
  // client is released — the same post-commit sweep as the three routes above.
  defineRoute({
    method: 'post', path: '/:id/accept-source', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: idParamSchema,
    body: acceptSourceBodySchema,
    response: AcceptSourceResult,
    handler: acceptSourceValue,
  }),
  // The other answer to the same card, and exempt on the criterion rather than by
  // resemblance to its opposite: that one stopped being exempt when accepting a
  // coordinate started moving a pin. This one writes one small row inside one
  // transaction and schedules no post-commit work at all — it does not even touch
  // the experience, because the value it refuses had already won every run.
  defineRoute({
    method: 'post', path: '/:id/decline-source', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: declineSourceBodySchema,
    response: DeclineSourceResult,
    handler: declineSourceValue,
  }),
  // The same answer one gate over (#722): "not this" to a value the source's gate
  // held, rather than to one a curator had claimed. Exempt on the same criterion as
  // the line above and for the same reason — it writes a handful of small rows
  // inside one transaction, touches no column a reader sees, and schedules nothing
  // after the commit. Its opposite, `/:id/publish`, is limited because publishing
  // can reach `placeAfterRelease`; refusing cannot, because refusing writes nothing
  // that could move a pin.
  defineRoute({
    method: 'post', path: '/:id/decline-held', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: declineHeldBodySchema,
    response: DeclineHeldResult,
    handler: declineHeldValue,
  }),

  // The no that the two gated kinds without one lacked (#852, ADR-0053): keeping
  // out an object nobody has passed, and turning down the unread points and works
  // under one readers already see. The two part on the criterion the line above
  // states. Refusing an arrival writes one membership row inside one transaction,
  // touches nothing a reader sees — the row was hidden already — and schedules
  // nothing after the commit, so it is exempt. Refusing contents is limited, for
  // the branch `/:id/publish` is limited for: a refused point counts toward no
  // region any more and takes off the map any pin it was holding, so the object
  // is re-placed into every world view with geometry after the commit.
  defineRoute({
    method: 'post', path: '/:id/refuse-arrival', access: 'curator', cache: 'no-store',
    params: idParamSchema,
    body: refuseArrivalBodySchema,
    response: RefuseArrivalResult,
    handler: refuseArrival,
  }),
  defineRoute({
    method: 'post', path: '/:id/refuse-contents', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: idParamSchema,
    body: refuseContentsBodySchema,
    response: RefuseContentsResult,
    handler: refuseContents,
  }),

  // The way back from the second of those (#859), which ADR-0053 left as its own
  // follow-up. The same body names the same rows — the ids of the points and works,
  // or neither for all of them — so it is validated by the same schema rather than
  // a copy that could drift from it. Limited for the reason its opposite is: a point
  // asked about again counts toward its regions once more, so the object is
  // re-placed after the commit.
  defineRoute({
    method: 'post', path: '/:id/unrefuse-contents', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: idParamSchema,
    body: refuseContentsBodySchema,
    response: UnrefuseContentsResult,
    handler: unrefuseContents,
  }),

  // Release everything one source is holding (ADR-0025 decision 5, and
  // `docs/tech/experiences.md` § "Turning a source's gate on, and letting it go").
  // The batch form of `/:id/publish` below, and rate-limited for the same reason with
  // more force: it runs that transaction once per waiting object and can reach the
  // post-commit placement on any of them.
  //
  // Mounted under `sources/` rather than `:id/` so it cannot be read as an
  // action on one experience. Its position among the `:id` routes is free, and
  // that is worth stating because the obvious guess is wrong. Two `:id` routes are
  // three segments like this one — `/:id/assign/:regionId` and
  // `/:id/remove-from-region/:regionId` — but both are `DELETE`, and Express matches
  // per method, so no `POST` sibling can capture `sources` as an id. Even a future
  // `POST /:id/assign/:regionId` would not: its middle segment is a literal, and
  // `publish-waiting` is not `assign`. What would collide is a `POST /:id/:action/:x`
  // with a parameter in the middle, and there is none.
  defineRoute({
    method: 'post', path: '/sources/:sourceId/publish-waiting', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: sourceIdParamSchema,
    response: PublishWaitingResult,
    handler: publishWaiting,
  }),

  // The other half of what a gated source leaves open (ADR-0025): whether a
  // reader may see an unread row at all, its unread points and works, and the
  // content proposal a run made against a row that was already visible. Not the only
  // writer that moves a row off `pending`, and never was: `/:id/admission` has done it
  // since ADR-0025 § 4.5 — overriding a refusal on an unread arrival marks it read —
  // and `publish-waiting` above now does it per object for a whole source. Still the
  // only one that clears `pending_change_sync_log_id` in answer to a person, because
  // the batch deliberately leaves held proposals for the card that can show them and
  // an admission override does not touch the pointer.
  //
  // Rate-limited, like `/:id/admission` above and unlike the curator routes that
  // end at their commit, and the reason is this repo's own criterion rather than an
  // analyser's: `docs/tech/rate-limiting.md` § 5 exempts curator routes because the
  // *attack* surface needs a compromised account, and says the exemption stops
  // applying when a request is expensive to the system regardless of who sends it.
  // This one can be: where a publish releases a deferred withdrawal it re-places
  // the object into every world view with geometry after committing, deleting and
  // reinserting region rows. The rule is the branch, not the endpoint — which is
  // why the override shares it.
  //
  // `authenticatedLimiter` (60/min) rather than `expensiveAdminLimiter` (5/min)
  // because the expensive branch fires only for a moved point while the ordinary
  // publish is one transaction, and a curator works a queue in batches — the first
  // gated round is about 18 arrivals. Five a minute would answer 429 in the middle
  // of the work this whole stage exists to make possible; sixty bounds a runaway
  // client without a person ever noticing it.
  defineRoute({
    method: 'post', path: '/:id/publish', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    params: idParamSchema,
    body: publishExperienceBodySchema,
    response: PublishResult,
    handler: publishExperience,
  }),

  // Unassign an experience from a region (manual only)
  defineRoute({
    method: 'delete', path: '/:id/assign/:regionId', access: 'curator', cache: 'no-store',
    params: idAndRegionIdParamSchema,
    response: RegionMembershipResult,
    handler: unassignExperienceFromRegion,
  }),

  // Remove an experience from a region entirely (any assignment type, keeps rejection as guard)
  defineRoute({
    method: 'delete', path: '/:id/remove-from-region/:regionId', access: 'curator', cache: 'no-store',
    params: idAndRegionIdParamSchema,
    response: RegionMembershipResult,
    handler: removeExperienceFromRegion,
  }),
];

// The reads first: none of them is a route of a method and a shape a curation
// route below shares, and `routerOf` refuses any order in which one would
// answer for another.
export default routerOf([...experienceReadRoutes, ...experienceCurationRoutes]);
