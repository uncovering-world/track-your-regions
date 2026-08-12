/**
 * Shared query invalidation helpers for TanStack Query.
 *
 * Groups commonly co-invalidated query keys to reduce duplication
 * across mutation handlers. Each function accepts a QueryClient and
 * optional context parameters.
 */

import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalidate experience list caches after creating, editing, assigning,
 * or rejecting an experience. Optionally scoped to a region.
 */
export function invalidateExperiences(
  queryClient: QueryClient,
  opts?: { regionId?: number | null; experienceId?: number },
) {
  if (opts?.regionId) {
    queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', opts.regionId] });
    // The location batch answers for the rows the list is showing, so anything
    // that changes which rows those are — a rejection, a lifecycle verdict or
    // its correction — leaves it stale. Keyed by region *and* by whether lost
    // rows were asked for, and a prefix match reaches both entries: dropping
    // one would leave the other to answer the next question with the old set.
    queryClient.invalidateQueries({ queryKey: ['region-locations', opts.regionId] });
  }
  queryClient.invalidateQueries({ queryKey: ['discover-experiences'] });
  queryClient.invalidateQueries({ queryKey: ['discover-region-counts'] });
  queryClient.invalidateQueries({ queryKey: ['experiences'] });
  if (opts?.experienceId) {
    queryClient.invalidateQueries({ queryKey: ['experience', opts.experienceId] });
    queryClient.invalidateQueries({ queryKey: ['curation-log', opts.experienceId] });
    // The object's own points and works, which are the two things a publication
    // actually releases (ADR-0025) and the two caches this helper did not reach.
    // `experience-contents` holds them for five minutes (`staleTime: 300000`), so
    // without these a curator who published twelve paintings is told they are
    // visible and then shown the list from before — on the very screen the card's
    // "Look at the object" sends them to.
    queryClient.invalidateQueries({ queryKey: ['experience-locations', opts.experienceId] });
    queryClient.invalidateQueries({ queryKey: ['experience-contents', opts.experienceId] });
    // The region batch holds the same points, keyed by region instead of by
    // object — and the curation queue that publishes them is not region-scoped,
    // so it cannot name the region to invalidate. Stopping at the prefix is
    // therefore the only reach it has.
    //
    // Without this the two caches disagree in the way that shows: `['experiences']`
    // above prefix-matches the by-region list, so the list refetches and the
    // just-published museum appears in it, while the batch that draws its pin is
    // held for five minutes (`useRegionLocations.ts:35`) — an object in the list
    // with nothing on the map and the `0 locations` count that hook's own
    // docblock warns about.
    if (!opts.regionId) queryClient.invalidateQueries({ queryKey: ['region-locations'] });
  }
}

/**
 * The batch counterpart: many objects changed and naming them is pointless.
 *
 * `invalidateExperiences(qc)` with nothing named deliberately reaches no object
 * keys — that is what its own "leaves it alone when nothing is named" test pins,
 * because a caller who changed one object should say which. A batch publication is
 * the other case: it changed a whole source's worth, and the object keys are
 * `['experience', id]`, `['experience-locations', id]`, `['experience-contents', id]`
 * and `['curation-log', id]` — all four the object form reaches — so their prefixes
 * cover exactly the objects that changed plus some cheap extras, cheaper than
 * enumerating 1272 ids and unable to miss one.
 *
 * `['curation-log']` is not an afterthought in that list: **one audit row per object,
 * never one for the batch** is this endpoint's headline decision, and that cache is
 * where those rows are read (`CurationDialog`). A batch that wrote forty of them and
 * left the log showing none would contradict its own promise on the first object a
 * curator opened.
 *
 * `['region-locations']` is here for the reason the object form documents: the list
 * refetches on its own because `['experiences']` prefix-matches the by-region key,
 * while the batch that draws the pins is held for five minutes. Without it the
 * curator releases forty museums and opens Map mode onto forty rows with no pins.
 *
 * `['curation', 'reviewQueue']` is here because this is the one publication path
 * that does not start on that page. Every verdict taken *in* the queue invalidates
 * it, for the reason `ReviewQueue.tsx` writes down — a card left up lets the next
 * click repeat a refusal, and with `staleTime: 60000` and no refetch-on-focus
 * nothing recovers it short of a reload. A batch removes those cards in bulk from a
 * different screen, so it has to say so.
 */
export function invalidateAfterBatchPublication(queryClient: QueryClient) {
  invalidateExperiences(queryClient);
  for (const prefix of [
    ['experience'], ['experience-locations'], ['experience-contents'],
    ['curation-log'], ['region-locations'], ['curation', 'reviewQueue'],
  ]) {
    queryClient.invalidateQueries({ queryKey: prefix });
  }
}

/**
 * Invalidate visited status caches after marking/unmarking visits.
 * Used by experience visit, location visit, and treasure view mutations.
 */
export function invalidateVisitedStatus(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
  queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
  queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
}
