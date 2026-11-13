import { useSyncExternalStore } from 'react';
import { matchMutation, type QueryClient } from '@tanstack/react-query';
import type { RemovedVisit, TickedPlace } from '../../api/client.generated';
import { queryKeys } from '../../api/queryKeys';

/**
 * What the traveller's last visit write leaves on screen (#2120, ADR-0202),
 * kept in the shell so a visitor's entry chunk carries only these few lines:
 *
 * - the visits the last untick removed, while one of them held a trip: what
 *   "Visit removed, with its trips · Undo" offers to put back;
 * - the row the line offering a date after a tick stands under (`line`):
 *   a place's id, or a point's id negated, so the row that made the tick, and
 *   only it, draws the line.
 *
 * One of each at a time, since each answers the last click.
 *
 * Both are the traveller's own: each records whose write made it (`owner`)
 * and answers no one else, every change of who is signed in forgets them,
 * with the offer's session in the trips chunk's memory and its silence in
 * the tab's storage (`forgetTraveller`, from
 * `useAuth`), and a write started before that change notes nothing after it
 * (`writeOrigin`).
 *
 * The next visit write takes the removal away, whichever control made it:
 * every visit write carries `queryKeys.visited.write`, and the removal
 * watches the query client for the next one to start. The untick that noted
 * it has started already; the Undo's own restore is marked in its `meta`
 * (`UNDOES_REMOVAL`) and clears the removal once the visits are back. A list
 * showing another region than the one that first drew it takes it away too
 * (`drawRemovalIn`).
 */
interface Removal { visits: RemovedVisit[]; owner: number; scope: unknown }

/** The scope of a removal no list has drawn yet. */
const UNDRAWN = Symbol('undrawn');
let removal: Removal | null = null;
let stopWatching: (() => void) | undefined;
let line: { at: number; owner: number } | null = null;
/** Which sign-in this is: moved on by every change of who is signed in. */
let signIn = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emit = () => listeners.forEach(listener => listener());

/** The `meta` key of the one visit write that leaves the removal on screen: its own Undo. */
export const UNDOES_REMOVAL = 'undoesRemoval';

/**
 * Where the offer of a date keeps, in the tab's `sessionStorage`, until when it is
 * silenced and for whom (`dateOffer.ts`): never a place or the time of a
 * tick, which stay in the chunk's memory. Forgotten with the traveller.
 */
export const OFFER_SILENCE_KEY = 'tyr.tripOfferSilence';

/**
 * Who started a visit write, in which sign-in, and, for a tick, when their
 * account was made. Taken in the write's `onMutate`, since its later
 * callbacks see the hook's latest render, which may be another traveller's.
 */
export interface WriteOrigin { owner: number | undefined; signIn: number; createdAt?: string | null }

export function writeOrigin(owner: number | undefined, createdAt?: string | null): WriteOrigin {
  return { owner, signIn, createdAt };
}

/**
 * Whether a visit write's origin is still who is signed in: checked again at
 * every step that comes later than the write's own start (its answer, the
 * offer's chunk arriving, a choice on the offer's line), so nothing of one
 * traveller's tick is shown, stored or written after another signs in.
 */
export const isCurrentOrigin = (origin: WriteOrigin | undefined): origin is WriteOrigin & { owner: number } =>
  origin?.owner !== undefined && origin.signIn === signIn;

function keepRemoval(next: Removal | null, client?: QueryClient): void {
  stopWatching?.();
  stopWatching = next && client
    ? client.getMutationCache().subscribe(({ type, mutation }) => {
      if (type === 'added' && matchMutation({ mutationKey: queryKeys.visited.write }, mutation)
        && !mutation.options.meta?.[UNDOES_REMOVAL]) clearRemovedVisits();
    })
    : undefined;
  removal = next;
}

/**
 * Kept by every untick's answer: the visits it removed, if any held a trip,
 * until `client` starts the next visit write. An untick also closes the date
 * line. An untick of an earlier sign-in keeps nothing.
 */
export function noteRemovedVisits(removed: RemovedVisit[], client: QueryClient, origin: WriteOrigin | undefined): void {
  if (!isCurrentOrigin(origin)) return;
  const withTrips = removed.some(visit => visit.trips.length > 0);
  keepRemoval(withTrips ? { visits: removed, owner: origin.owner, scope: UNDRAWN } : null, client);
  line = null;
  emit();
}

/** The Undo put the visits back, or the list shows another region. */
export function clearRemovedVisits(): void {
  if (removal !== null) { keepRemoval(null); emit(); }
}

let forgetOffer: (() => void) | undefined;

/** Who is signed in changed: nothing the last traveller's visit writes left stays. */
export function forgetTraveller(): void {
  signIn += 1;
  keepRemoval(null);
  line = null;
  forgetOffer?.();
  try {
    sessionStorage.removeItem(OFFER_SILENCE_KEY);
  } catch {
    // A refused storage holds nothing to forget.
  }
  emit();
}

/** The removal as `owner` may see it: none for another traveller, or for no one signed in. */
export function removedVisitsOf(owner: number | undefined): RemovedVisit[] | null {
  return owner !== undefined && removal?.owner === owner ? removal.visits : null;
}

export function useRemovedVisits(owner: number | undefined): RemovedVisit[] | null {
  const held = useSyncExternalStore(subscribe, () => removal);
  return owner !== undefined && held?.owner === owner ? held.visits : null;
}

/** A list drawing the removal under `scope`: the first one names its region, and another region drops it. */
export function drawRemovalIn(scope: unknown): void {
  if (!removal) return;
  if (removal.scope === UNDRAWN) removal.scope = scope;
  else if (!Object.is(removal.scope, scope)) clearRemovedVisits();
}

type TickHandler = (at: number, ticked: TickedPlace[], client: QueryClient, origin: WriteOrigin & { owner: number }) => void;
let onTick: TickHandler | undefined;

/** Every tick's answer, for the offer of a date under the row `at` (#2120), unless it is of an earlier sign-in. */
export function noteTicked(at: number, ticked: TickedPlace[], client: QueryClient, origin: WriteOrigin | undefined): void {
  if (ticked.length && isCurrentOrigin(origin)) onTick?.(at, ticked, client, origin);
}

/** The offer's side, set by `lazyVisitTrips.tsx`: what a tick opens, and how the offer forgets its traveller. */
export function handleTicks(handler: TickHandler, forget: () => void): void {
  onTick = handler;
  forgetOffer = forget;
}

/** Which row the date line stands under, and whose tick opened it, set by the offer; null closes it. */
export function showDateLine(at: number | null, owner?: number): void {
  line = at === null || owner === undefined ? null : { at, owner };
  emit();
}

export const dateLineAt = () => line?.at ?? null;

/** Whether the date line stands under this row for `owner`: one boolean, so only the rows it leaves or reaches re-render. */
export function useDateLineAt(at: number, owner: number | undefined): boolean {
  return useSyncExternalStore(subscribe, () => line !== null && line.at === at && line.owner === owner);
}
