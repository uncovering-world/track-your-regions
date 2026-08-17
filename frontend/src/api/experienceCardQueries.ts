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
 * nothing. They are deliberately *not* warmed on hover; the note above the
 * definitions below says why.
 *
 * Sharing the definitions is the point of this file: the card and the readiness
 * gate must read the same keys, or the gate would wait on one request while the
 * card issued another, and nothing in a type checker would catch the drift.
 */

import { fetchExperience, fetchExperienceTreasures } from './experiences';

/** Five minutes, matching the card's own reads. */
const CARD_STALE_TIME_MS = 300000;

/** The experience itself: description, metadata, links. */
export const experienceDetailsQuery = (id: number) => ({
  queryKey: ['experience', id] as const,
  queryFn: () => fetchExperience(id),
  staleTime: CARD_STALE_TIME_MS,
});

/** What a container holds — the artworks list a museum card draws. */
export const experienceContentsQuery = (id: number) => ({
  queryKey: ['experience-contents', id] as const,
  queryFn: () => fetchExperienceTreasures(id),
  staleTime: CARD_STALE_TIME_MS,
});

// There is deliberately no prefetch here. Warming these on hover was tried and
// removed: both routes sit under `publicReadLimiter`, and so do the reads that
// draw the list itself — `by-region`, its locations batch, the region counts. Two
// requests per row a reader pauses over is how a list refuses to load itself.
// `useExperienceCardReady` waits for them on open instead, which costs the reader
// about 150 ms of spinner and costs the list nothing.
