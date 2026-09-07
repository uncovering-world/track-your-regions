/**
 * The review page's address, read and written through this door (ADR-0051
 * decision 5) — the second door beside `useAppAddress` (#644). `/review` is
 * not a place (`parseAppUrl` answers null for it), so the list's own state —
 * order, search, filters, the selected row — gets its own grammar in
 * `parseReviewUrl`/`buildReviewUrl` and its own door here, rather than living
 * inside `useAppAddress`.
 *
 * `go` merges `next` over the current address — a field left out keeps its
 * value, a field set to its empty value clears it — builds the URL, does
 * nothing when it equals the address the page is already at, and otherwise
 * navigates: push by default, since a filter, a search, an order or a row the
 * curator *clicked* is something they did and Back should undo it; replace
 * when the caller says the move was the page's own — the selection moving on
 * by itself once a question is answered.
 *
 * `go` reads "the current address" through a ref rather than off `location`,
 * for the reason `useAppAddress` reads through one too (see its own
 * docblock): `navigate` puts the new URL in the address bar at once, while
 * React re-renders through a transition, so a component can still be holding
 * the address parsed from the *previous* URL after a write has already
 * landed. That staleness bites a sequence of absolute writes — two `go()`
 * calls made in one gesture (a handler that both sets the search text and
 * clears the selected row, say) would otherwise both merge onto
 * `location.search` from the render that was current before either call, so
 * the second overwrites the first rather than adding to it. `currentRef`
 * holds what `go` last wrote; only a navigation from *outside* it — Back, a
 * fresh entry, the page loading at a new address — is allowed to override it,
 * caught by comparing against `lastLocationRef`.
 *
 * **`next` may be a function of the current address**, and for the same
 * reason. A ref fixes what a patch is merged *onto*, not what it is computed
 * *from*: a filter chip that toggles one id out of a list reads the list off
 * the address it rendered with, and its menu stays open, so a second tick
 * before React has re-rendered — react-router defers the location update in a
 * transition — computes an array that never saw the first and replaces it.
 * A function is resolved here, against the same `currentRef` address the
 * result is merged onto, so a relative write always builds on the write
 * before it.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { buildReviewUrl, parseReviewUrl, type ReviewAddress } from '../utils/appUrl';

/**
 * What a write asks for: the fields to change, or a function of the address they change.
 *
 * The function form is the one a control with a *relative* change uses — a filter chip
 * adding an id to the list already in the address — and it is resolved against the address
 * `go` is about to merge onto rather than the one its caller rendered with.
 */
export type ReviewPatch =
  | Partial<ReviewAddress>
  | ((current: ReviewAddress) => Partial<ReviewAddress>);

export function useReviewAddress(): {
  address: ReviewAddress;
  go: (next: ReviewPatch, opts?: { replace?: boolean }) => void;
} {
  const location = useLocation();
  const navigate = useNavigate();

  const address = useMemo(() => parseReviewUrl(location.search), [location.search]);

  const current = `${location.pathname}${location.search}`;
  // What `go` last wrote, which runs ahead of what any render is holding —
  // see the docblock. A re-render at an unchanged location must not override
  // it, because that is exactly the intermediate commit the ref exists to
  // outrun; only a location that actually moved does.
  const currentRef = useRef(current);
  const lastLocationRef = useRef(current);
  if (current !== lastLocationRef.current) {
    lastLocationRef.current = current;
    currentRef.current = current;
  }
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const go = useCallback((next: ReviewPatch, opts?: { replace?: boolean }) => {
    const [, currentQuery = ''] = currentRef.current.split('?');
    const current = parseReviewUrl(currentQuery);
    const patch = typeof next === 'function' ? next(current) : next;
    const url = buildReviewUrl({ ...current, ...patch });
    if (url === currentRef.current) return;
    currentRef.current = url;
    navigateRef.current(url, { replace: opts?.replace === true });
  }, []);

  return useMemo(() => ({ address, go }), [address, go]);
}
