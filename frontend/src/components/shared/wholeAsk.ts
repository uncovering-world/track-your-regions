import { useSyncExternalStore } from 'react';

/**
 * The question after "Visited, not sure which part" (#2121, ADR-0206): which
 * places of the whole the traveller was at, asked in one line on its card
 * with the card's own list of places as the picker. Kept in the tab's memory
 * only, and forgotten with the traveller (`forgetTraveller`):
 *
 * - the wholes whose card asks now (`asking`): opened by the press that ticks
 *   the whole, closed by the press that takes it back, by naming a place and
 *   by the card closing, so nothing asks again on a later open;
 * - the wholes answered "I don't remember" (`declined`): never asked again in
 *   this session, and their count stays "? of N";
 * - the lists of places listening for the line's "Mark them in the list"
 *   (`revealers`), one per open card, which bring themselves into view.
 */
let asking: ReadonlySet<number> = new Set();
const declined = new Set<number>();
const revealers = new Map<number, Set<() => void>>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function setAsking(next: ReadonlySet<number>): void {
  asking = next;
  listeners.forEach(listener => listener());
}

/** The whole was just ticked as a whole: its card asks which places, unless the traveller said they do not remember. */
export function askWhichPlaces(wholeId: number): void {
  if (declined.has(wholeId) || asking.has(wholeId)) return;
  setAsking(new Set(asking).add(wholeId));
}

/** The question goes: the tick was taken back, a place was named or the card closed. */
export function stopAsking(wholeId: number): void {
  if (!asking.has(wholeId)) return;
  const next = new Set(asking);
  next.delete(wholeId);
  setAsking(next);
}

/** "I don't remember": the question goes and is not asked again for this whole in this session. */
export function declineAsk(wholeId: number): void {
  declined.add(wholeId);
  stopAsking(wholeId);
}

/** Whether the whole's card asks which places now: one boolean, so only its own line re-renders. */
export function useAsking(wholeId: number): boolean {
  return useSyncExternalStore(subscribe, () => asking.has(wholeId));
}

/** "Mark them in the list": the whole's open list of places brings itself into view. */
export function revealPlaces(wholeId: number): void {
  revealers.get(wholeId)?.forEach(reveal => reveal());
}

/** A list of the whole's places listening for the line, until it unmounts: the answer stops listening. */
export function onRevealPlaces(wholeId: number, reveal: () => void): () => void {
  const held = revealers.get(wholeId) ?? new Set<() => void>();
  held.add(reveal);
  revealers.set(wholeId, held);
  return () => {
    held.delete(reveal);
    if (held.size === 0) revealers.delete(wholeId);
  };
}

/** Who is signed in changed: the last traveller's questions and answers go with them. */
export function forgetWholeAsks(): void {
  declined.clear();
  setAsking(new Set());
}
