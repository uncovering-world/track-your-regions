/**
 * Experience Routes
 *
 * Public endpoints for browsing experiences.
 * User visited endpoints are in userRoutes.ts
 */

import { Router } from 'express';
import {
  listExperiences,
  getExperience,
  getExperiencesByRegion,
  getExperienceRegionCounts,
  getRegionExperienceLocations,
  listCategories,
  searchExperiences,
  getExperienceLocations,
  getExperienceTreasures,
  rejectExperience,
  unrejectExperience,
  assignExperienceToRegion,
  unassignExperienceFromRegion,
  removeExperienceFromRegion,
  createManualExperience,
  editExperience,
  getCurationLog,
  getReviewQueue,
  setExperienceAdmission,
  setExperienceState,
  setLocationState,
  editLocation,
  acceptSourceValue,
  declineSourceValue,
  publishExperience,
  publishWaiting,
  markNewBadgesSeen,
} from '../controllers/experience/index.js';
import { requireAuth, requireCurator, optionalAuth } from '../middleware/auth.js';
import { requireVisibleWorldView } from '../middleware/worldViewVisibility.js';
import { publicReadLimiter, searchLimiter, authenticatedLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/errorHandler.js';
import {
  experienceSearchQuerySchema,
  experienceListQuerySchema,
  experiencesByRegionQuerySchema,
  experienceRegionCountsQuerySchema,
  experienceLocationsQuerySchema,
  regionLocationsQuerySchema,
  idParamSchema,
  categoryIdParamSchema,
  reviewQueueQuerySchema,
  experienceAdmissionBodySchema,
  newBadgesSeenBodySchema,
  lifecycleStateBodySchema,
  editLocationBodySchema,
  locationIdParamSchema,
  acceptSourceBodySchema,
  declineSourceBodySchema,
  publishExperienceBodySchema,
  regionIdParamSchema,
  idAndRegionIdParamSchema,
  rejectExperienceBodySchema,
  unrejectExperienceBodySchema,
  assignExperienceBodySchema,
  editExperienceBodySchema,
  createManualExperienceBodySchema,
} from '../types/index.js';

const router = Router();

// =============================================================================
// Public Experience Routes
// =============================================================================

// Search experiences (full-text search)
router.get('/search', searchLimiter, validate(experienceSearchQuerySchema, 'query'), searchExperiences);

// List experience categories
router.get('/categories', publicReadLimiter, listCategories);

// Get experience counts per region per category (for Discover page tree)
router.get('/region-counts', publicReadLimiter, validate(experienceRegionCountsQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('worldViewIdQuery'), getExperienceRegionCounts);

// Get experiences by region (optionalAuth to support curator rejection visibility)
router.get('/by-region/:regionId', publicReadLimiter, validate(regionIdParamSchema, 'params'), validate(experiencesByRegionQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('regionIdParam'), getExperiencesByRegion);

// Get all locations for all experiences in a region (batch, eliminates N+1)
router.get('/by-region/:regionId/locations', publicReadLimiter, validate(regionIdParamSchema, 'params'), validate(regionLocationsQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('regionIdParam'), getRegionExperienceLocations);

// List experiences with filtering (optionalAuth: admins may filter by regionId
// on a hidden world view; everyone else 404s on that regionId per requireVisibleWorldView)
router.get('/', publicReadLimiter, validate(experienceListQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('regionIdQuery'), listExperiences);

// =============================================================================
// Curation Routes (require curator auth)
// =============================================================================
// These must be defined BEFORE the /:id catch-all route

// Create a new manual experience (Curator Picks)
router.post('/', requireAuth, requireCurator, validate(createManualExperienceBodySchema), createManualExperience);

// Reject an experience from a region
router.post('/:id/reject', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(rejectExperienceBodySchema), rejectExperience);

// Unreject an experience from a region
router.post('/:id/unreject', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(unrejectExperienceBodySchema), unrejectExperience);

// Manually assign an experience to a region
router.post('/:id/assign', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(assignExperienceBodySchema), assignExperienceToRegion);

// Edit an experience's fields (curator)
router.patch('/:id/edit', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(editExperienceBodySchema), editExperience);

// Get curation log for an experience
router.get('/:id/curation-log', validate(idParamSchema, 'params'), requireAuth, requireCurator, getCurationLog);

// Records that the reader has now seen these chips. A POST because it writes:
// the read that produced the chips stays idempotent, and an impression set by
// a prefetch or a crawler is not one. Above `/:id` for the same reason as the
// review routes below — a two-segment literal path must not be read as an id.
//
// Rate-limited as an ordinary authenticated user action — `authenticatedLimiter`
// is what docs/tech/rate-limiting.md's table gives those, and this is the one
// endpoint here a client calls on its own initiative rather than in response to a
// click.
//
// Not "unlike the curation routes below", which is what this comment used to say:
// two of them carry the same limiter now (`/:id/admission`, `/:id/publish`). The
// difference is the reason rather than the presence. This one is limited because
// an unauthenticated-shaped user action needs a ceiling; those two are limited
// despite `requireCurator` because one branch does post-commit region placement
// that costs the same whoever sends it (§ 5). A curation route added here is
// exempt by default and joins them only if it reaches that kind of work.
router.post('/new-badges/seen', authenticatedLimiter, requireAuth, validate(newBadgesSeenBodySchema), markNewBadgesSeen);

// Decisions a sync run cannot make for itself: whether an object the source
// stopped listing is delisted, destroyed, or was never gone, and whether a
// value the source proposed should displace a curator's edit.
router.get('/review/queue', requireAuth, requireCurator, validate(reviewQueueQuerySchema, 'query'), getReviewQueue);
router.post('/:id/state', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(lifecycleStateBodySchema), setExperienceState);
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
router.post('/locations/:locationId/state', authenticatedLimiter, validate(locationIdParamSchema, 'params'), requireAuth, requireCurator, validate(lifecycleStateBodySchema), setLocationState);
// The correction beside the verdict, and rate-limited with it: it writes a claim,
// moves the object's anchor where the object is one point, and re-places the
// experience into regions afterwards — the same shape of work as the line above.
router.patch('/locations/:locationId/edit', authenticatedLimiter, validate(locationIdParamSchema, 'params'), requireAuth, requireCurator, validate(editLocationBodySchema), editLocation);
// Rate-limited for the same reason `/:id/publish` below is, and it is the same
// branch rather than a similar one: overriding a refusal on a gated arrival
// publishes its contents through the shared `publishContents`, so it can release
// a deferred withdrawal, and `setExperienceAdmission` then calls
// `placeAfterAdmissionRelease` → `placeAfterRelease` after its client is
// released — `assignRegionsForExperiences` once per world view with geometry.
// Post-commit work that is expensive regardless of who sends it, which is the
// criterion in `docs/tech/rate-limiting.md` § 5.
router.post('/:id/admission', authenticatedLimiter, validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(experienceAdmissionBodySchema), setExperienceAdmission);
// Joined the limited set when accepting a coordinate stopped being a pure claim
// release: it puts the object's pin back on the source's coordinate, and a pin
// that moves is a region fact, so this too reaches `placeAfterRelease` after its
// client is released — the same post-commit sweep as the three routes above.
router.post('/:id/accept-source', authenticatedLimiter, validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(acceptSourceBodySchema), acceptSourceValue);
// The other answer to the same card, and exempt on the criterion rather than by
// resemblance to its opposite: that one stopped being exempt when accepting a
// coordinate started moving a pin. This one writes one small row inside one
// transaction and schedules no post-commit work at all — it does not even touch
// the experience, because the value it refuses had already won every run.
router.post('/:id/decline-source', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(declineSourceBodySchema), declineSourceValue);

// Release everything one source is holding (ADR-0025 decision 5, and
// `docs/tech/experiences.md` § "Turning a source's gate on, and letting it go").
// The batch form of `/:id/publish` below, and rate-limited for the same reason with
// more force: it runs that transaction once per waiting object and can reach the
// post-commit placement on any of them.
//
// Mounted under `categories/` rather than `:id/` so it cannot be read as an
// action on one experience. Its position among the `:id` routes is free, and
// that is worth stating because the obvious guess is wrong. Two `:id` routes are
// three segments like this one — `/:id/assign/:regionId` and
// `/:id/remove-from-region/:regionId` — but both are `DELETE`, and Express matches
// per method, so no `POST` sibling can capture `categories` as an id. Even a future
// `POST /:id/assign/:regionId` would not: its middle segment is a literal, and
// `publish-waiting` is not `assign`. What would collide is a `POST /:id/:action/:x`
// with a parameter in the middle, and there is none.
router.post(
  '/categories/:categoryId/publish-waiting',
  authenticatedLimiter,
  validate(categoryIdParamSchema, 'params'),
  requireAuth,
  requireCurator,
  publishWaiting,
);

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
// Rate-limited, like `/:id/admission` above and unlike the three other curator
// routes there, and the reason is this repo's own criterion rather than an
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
router.post('/:id/publish', authenticatedLimiter, validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(publishExperienceBodySchema), publishExperience);

// Unassign an experience from a region (manual only)
router.delete('/:id/assign/:regionId', validate(idAndRegionIdParamSchema, 'params'), requireAuth, requireCurator, unassignExperienceFromRegion);

// Remove an experience from a region entirely (any assignment type, keeps rejection as guard)
router.delete('/:id/remove-from-region/:regionId', validate(idAndRegionIdParamSchema, 'params'), requireAuth, requireCurator, removeExperienceFromRegion);

// Get single experience (optionalAuth: 404s on a refused row (ADR-0024) and
// on an unread `pending` row outside a curator/admin's scope (ADR-0025); its
// regions[] are filtered in the controller on two axes — the world view's own
// visibility, which only an admin bypasses, and whether the region holds a
// point of this object that this caller may see (#521), which a curator whose
// scope reaches the object bypasses too, a manual assignment being exempt)
router.get('/:id', publicReadLimiter, validate(idParamSchema, 'params'), optionalAuth, getExperience);

// Get locations for an experience (multi-location support; optionalAuth
// for the same regionId visibility guard as the list endpoint above)
router.get('/:id/locations', publicReadLimiter, validate(idParamSchema, 'params'), validate(experienceLocationsQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('regionIdQuery'), getExperienceLocations);

// Get treasures (artworks, artifacts) for an experience (optionalAuth: a
// curator or admin reaching a gated museum from the queue sees its unread
// treasures too — see getExperienceTreasures/maySeeUnreadExperience, ADR-0025)
router.get('/:id/treasures', publicReadLimiter, validate(idParamSchema, 'params'), optionalAuth, getExperienceTreasures);

export default router;
