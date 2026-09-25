/**
 * Shared query invalidation helpers for TanStack Query.
 *
 * Each helper names what a write changed — an object, a batch of them, a
 * caller's visits — and derives the caches that answer about it from the key
 * factory (`api/queryKeys.ts`, #790), so the keys a helper reaches are the
 * keys the reads were built with rather than a second spelling of them.
 */

import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';

/**
 * Invalidate experience list caches after creating, editing, assigning,
 * or rejecting an experience. Optionally scoped to a region.
 */
export function invalidateExperiences(
  queryClient: QueryClient,
  opts?: { regionId?: number | null; experienceId?: number },
) {
  if (opts?.regionId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.experiences.inRegion(opts.regionId) });
    // The location batch answers for the rows the list is showing, so anything
    // that changes which rows those are — a rejection, a lifecycle verdict or
    // its correction — leaves it stale. The full key is region, `includeLost`
    // and `includeChildren` — three entries today, since Map mode reads a region
    // without its descendants under either `includeLost` and Discover reads it
    // with them and without lost rows — and this prefix match
    // reaches every one of them: naming more of the key would clear one and
    // leave the rest to answer the next question with the old set.
    queryClient.invalidateQueries({ queryKey: queryKeys.experiences.regionLocationsIn(opts.regionId) });
  }
  queryClient.invalidateQueries({ queryKey: queryKeys.discover.experiencesAll });
  queryClient.invalidateQueries({ queryKey: queryKeys.discover.regionCountsAll });
  queryClient.invalidateQueries({ queryKey: queryKeys.experiences.all });
  // The map's world layer (#910), unscoped on purpose: it is keyed on the kind,
  // the tier, the fold and the box, and a curator's verdict is not. Any of the
  // writes that reach this helper can change what it draws — a refused
  // arrival, a lost place, a withdrawn point — and there is no region in that
  // key to narrow by.
  //
  // This is the whole reason the layer reads an endpoint rather than a tile
  // source. Martin kept an in-process cache under the tile URL with no headers
  // and no way in: a place marked lost was measured still being drawn until the
  // server restarted. One line here is what that cost.
  queryClient.invalidateQueries({ queryKey: queryKeys.experiences.worldPointsAll });
  if (opts?.experienceId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.one(opts.experienceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLog(opts.experienceId) });
    // The object's own points and works, which are the two things a publication
    // actually releases (ADR-0025) and the two caches this helper did not reach.
    // `experience-contents` holds them for five minutes (`staleTime: 300000`), so
    // without these a curator who published twelve paintings is told they are
    // visible and then shown the list from before — on the very screen the card's
    // "Look at the object" sends them to.
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.locations(opts.experienceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.contents(opts.experienceId) });
    // The region batch holds the same points, keyed by region instead of by
    // object — and the curation queue that publishes them is not region-scoped,
    // so it cannot name the region to invalidate. Stopping at the prefix is
    // therefore the only reach it has.
    //
    // Without this the two caches disagree in the way that shows: `queryKeys.experiences.all`
    // above prefix-matches the by-region list, so the list refetches and the
    // just-published museum appears in it, while the batch that draws its pin is
    // held for five minutes (the `staleTime` in `useRegionLocations.ts`) — an object in the list
    // with nothing on the map and the `0 locations` count that hook's own
    // docblock warns about.
    if (!opts.regionId) queryClient.invalidateQueries({ queryKey: queryKeys.experiences.regionLocationsAll });
  }
}

/**
 * The batch counterpart: many objects changed and naming them is pointless.
 *
 * `invalidateExperiences(qc)` with nothing named deliberately reaches no object
 * keys — that is what its own "leaves it alone when nothing is named" test pins,
 * because a caller who changed one object should say which. A batch publication is
 * the other case: it changed a whole source's worth, and the object keys are
 * `queryKeys.experience.one(id)`, `.locations(id)`, `.contents(id)` and
 * `.curationLog(id)` — all four the object form reaches — so their prefixes
 * cover exactly the objects that changed plus some cheap extras, cheaper than
 * enumerating 1272 ids and unable to miss one.
 *
 * `queryKeys.experience.curationLogAll` is not an afterthought in that list:
 * **one audit row per object, never one for the batch** is this endpoint's
 * headline decision, and that cache is where those rows are read (`CurationDialog`). A batch that wrote forty of them and
 * left the log showing none would contradict its own promise on the first object a
 * curator opened.
 *
 * `queryKeys.experiences.regionLocationsAll` is here for the reason the object
 * form documents: the list refetches on its own because `queryKeys.experiences.all`
 * prefix-matches the by-region key, while the batch that draws the pins is held
 * for five minutes. Without it the curator releases forty museums and opens Map
 * mode onto forty rows with no pins.
 *
 * `queryKeys.curation.reviewQueueAll` is here because this is the one publication path
 * that does not start on that page. Every verdict taken *in* the queue invalidates
 * it, for the reason `ReviewQueue.tsx` writes down — a card left up lets the next
 * click repeat a refusal, and with `staleTime: 60000` and no refetch-on-focus
 * nothing recovers it short of a reload. A batch removes those cards in bulk from a
 * different screen, so it has to say so.
 */
export function invalidateAfterBatchPublication(queryClient: QueryClient) {
  invalidateExperiences(queryClient);
  for (const prefix of [
    queryKeys.experience.all, queryKeys.experience.locationsAll, queryKeys.experience.contentsAll,
    queryKeys.experience.curationLogAll, queryKeys.experiences.regionLocationsAll,
    queryKeys.curation.reviewQueueAll,
  ]) {
    queryClient.invalidateQueries({ queryKey: prefix });
  }
}

/**
 * Invalidate visited status caches after marking/unmarking visits.
 * Used by experience visit, location visit, and treasure view mutations.
 */
export function invalidateVisitedStatus(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.visited.experiencesAll });
  queryClient.invalidateQueries({ queryKey: queryKeys.visited.locationsAll });
  queryClient.invalidateQueries({ queryKey: queryKeys.visited.statusAll });
}
