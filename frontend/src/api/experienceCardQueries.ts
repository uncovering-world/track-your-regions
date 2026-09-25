/**
 * The two queries an expanded experience card needs, defined once.
 *
 * A card fires them when it opens, and their answers append content to a card the
 * reader is already looking at: measured on a live card, "Inscribed: 2025" and its
 * links landed 337 ms after the click and grew the row by 32 px, and a card's
 * artworks list can add far more. A row's height is measured by the virtualiser,
 * so anything arriving late moves every row below it — the list shuffles while
 * the reader reads.
 *
 * So a card is not opened until they have answered — `useExperienceCardReady`
 * waits for both, and the row shows a spinner where its chevron was, which moves
 * nothing. They are deliberately *not* warmed on hover, with one narrow
 * exception; the note above the definitions below says why, and what the
 * exception has to satisfy.
 *
 * Sharing the definitions is the point of this file: the card and the readiness
 * gate must read the same keys, or the gate would wait on one request while the
 * card issued another, and nothing in a type checker would catch the drift.
 */

import { fetchExperience, fetchExperienceTreasures, fetchSiteFinds } from './experiences';
import { queryKeys } from './queryKeys';

/** Five minutes, matching the card's own reads. */
const CARD_STALE_TIME_MS = 300000;

/** The experience itself: description, metadata, links. */
export const experienceDetailsQuery = (id: number) => ({
  queryKey: queryKeys.experience.one(id),
  queryFn: () => fetchExperience(id),
  staleTime: CARD_STALE_TIME_MS,
});

/** What a container holds — the artworks list a museum card draws. */
export const experienceContentsQuery = (id: number) => ({
  queryKey: queryKeys.experience.contents(id),
  queryFn: () => fetchExperienceTreasures(id),
  staleTime: CARD_STALE_TIME_MS,
});

/**
 * What was dug up at a site and where it is shown — the third part of a
 * site's card, and only a site's (#894). Issued for a row `hasExtent()` says is
 * one, off the loaded row and before any read, for the reason the note at the
 * foot of this file gives; a museum, a monument or a church never asks.
 */
export const siteFindsQuery = (id: number) => ({
  queryKey: queryKeys.experience.siteFinds(id),
  queryFn: () => fetchSiteFinds(id),
  staleTime: CARD_STALE_TIME_MS,
});

// There is deliberately no prefetch here. Warming these on hover was tried and
// removed: both routes sit under `publicReadLimiter`, and so do the reads that
// draw the list itself — `by-region`, its locations batch, the region counts. Two
// requests per row a reader pauses over is how a list refuses to load itself.
// `useExperienceCardReady` waits for them on open instead, which costs the reader
// about 150 ms of spinner and costs the list nothing.
//
// One caller reads on hover, and only on the terms that rule implies:
// `useExtentLayer` asks `experienceDetailsQuery` for the boundary the map draws
// around an Archaeology **site**, because a site's extent exists nowhere else.
// It is not a prefetch of the card and not a general warm — it fires for a row
// `hasExtent()` says can have an outline (kind 5, type `site`, off the loaded
// row, no request) and only once the pointer has rested 150 ms, so a swept list
// asks nothing and a museum, a monument or a church asks nothing ever. Anything
// else that wants to read on hover has to clear the same bar: a rule that rules
// most rows out before the request, and a pause that rules out the sweep.
