import { useSyncExternalStore } from 'react';
import { matchMutation, type QueryClient } from '@tanstack/react-query';
import type { RemovedVisit } from '../../api/client.generated';
import { queryKeys } from '../../api/queryKeys';

/**
 * The visits the traveller's last untick removed, while one of them held a
 * trip (#2120, ADR-0202): what "Visit removed, with its trips · Undo" offers
 * to put back. One untick at a time, since the line answers the last click;
 * an untick that removed no trip leaves nothing to undo.
 *
 * It is the traveller's own: it records whose untick made it (`owner`) and
 * answers no one else, every change of who is signed in forgets it
 * (`forgetTraveller`, from `useAuth`), and an untick started before that
 * change notes nothing after it (`writeOrigin`).
 *
 * The next visit write takes it away, whichever control made it: every visit
 * write carries `queryKeys.visited.write`, and the removal watches the query
 * client for the next one to start. The untick that noted it has started
 * already; the Undo's own restore is marked in its `meta` (`UNDOES_REMOVAL`)
 * and clears the removal once the visits are back. A list showing another
 * region than the one that first drew it takes it away too (`drawRemovalIn`).
 */
interface Removal { visits: RemovedVisit[]; owner: number; scope: unknown }

/** The scope of a removal no list has drawn yet. */
const UNDRAWN = Symbol('undrawn');
let removal: Removal | null = null;
let stopWatching: (() => void) | undefined;
/** Which sign-in this is: moved on by every change of who is signed in. */
let signIn = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The `meta` key of the one visit write that leaves the removal on screen: its own Undo. */
export const UNDOES_REMOVAL = 'undoesRemoval';

/**
 * Who started a visit write, and in which sign-in. Taken in the write's
 * `onMutate`, since its later callbacks see the hook's latest render, which
 * may be another traveller's.
 */
export interface WriteOrigin { owner: number | undefined; signIn: number }

export function writeOrigin(owner: number | undefined): WriteOrigin {
  return { owner, signIn };
}

function keep(next: Removal | null, client?: QueryClient): void {
  stopWatching?.();
  stopWatching = next && client
    ? client.getMutationCache().subscribe(({ type, mutation }) => {
      if (type === 'added' && matchMutation({ mutationKey: queryKeys.visited.write }, mutation)
        && !mutation.options.meta?.[UNDOES_REMOVAL]) clearRemovedVisits();
    })
    : undefined;
  removal = next;
  listeners.forEach(listener => listener());
}

/**
 * Kept by every untick's answer: the visits it removed, if any held a trip,
 * until `client` starts the next visit write. An untick of an earlier sign-in
 * keeps nothing.
 */
export function noteRemovedVisits(removed: RemovedVisit[], client: QueryClient, origin: WriteOrigin | undefined): void {
  if (origin?.owner === undefined || origin.signIn !== signIn) return;
  const withTrips = removed.some(visit => visit.trips.length > 0);
  keep(withTrips ? { visits: removed, owner: origin.owner, scope: UNDRAWN } : null, client);
}

/** The Undo put the visits back, or the list shows another region. */
export function clearRemovedVisits(): void {
  if (removal !== null) keep(null);
}

/** Who is signed in changed: nothing the last traveller's visit writes left stays. */
export function forgetTraveller(): void {
  signIn += 1;
  clearRemovedVisits();
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
