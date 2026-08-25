/**
 * The app's address, read and written through one door (#644).
 *
 * `address` is what the URL names — parsed by `utils/appUrl.ts`, null on a page
 * that is not a place. `go` writes an address: `push` by default, because
 * selecting a region or opening a card is something the visitor did and Back
 * should undo it; `replace` for corrections — a slug brought up to date, an id
 * the visitor may not see dropped, a legacy `?wv=` moved into the path — which
 * are not the visitor's doing and must not be a step in their history.
 *
 * Writing the address the page is already at does nothing, so a canonical
 * rewrite is idempotent and a follow-effect that answers its own write cannot
 * loop. `go` keeps one identity for the life of the hook: react-router's
 * `navigate` changes with the location, and every effect that took it as a
 * dependency would otherwise re-run on each address it writes.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { buildAppUrl, legacyRedirect, parseAppUrl, slugsOf, type AppAddress } from '../utils/appUrl';

export interface AddressNames {
  region?: string | null;
  experience?: string | null;
}

export interface GoOptions {
  replace?: boolean;
  /** Decoration for the ids: hung on as slugs where known. */
  names?: AddressNames;
}

/**
 * Where to go: an address, or — safer for a change *relative* to where the page
 * is — a function of the latest address `go` knows.
 *
 * The two differ in a window that is easy to miss. `navigate` puts the new URL
 * in the address bar through `history.replaceState` at once, while React
 * re-renders through a transition, so every component can still be holding the
 * address parsed from the *previous* URL while the bar already reads the new
 * one. A handler firing there and spreading its rendered `address` would build
 * on the stale one and undo the write that just landed. The functional form is
 * handed the latest instead, so "the same place, in Discover" means that
 * whenever it is asked.
 */
export type GoTarget = AppAddress | ((current: AppAddress) => AppAddress);

export function useAppAddress() {
  const location = useLocation();
  const navigate = useNavigate();

  const address = useMemo(
    () => parseAppUrl(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const current = `${location.pathname}${location.search}`;
  // What `go` last wrote, which runs ahead of what any render is holding — see
  // `GoTarget`. Only a navigation from *outside* `go` overrides it: Back, a
  // link, the legacy redirect. A re-render at an unchanged location must not,
  // because that is exactly the intermediate commit the ref exists to outrun —
  // a handler that sets state urgently and writes the address renders again at
  // the previous location while the router's own update is still in its
  // transition, and taking the render's value there would put the stale URL
  // back and let the next relative write undo the first.
  const currentRef = useRef(current);
  const lastLocationRef = useRef(current);
  if (current !== lastLocationRef.current) {
    lastLocationRef.current = current;
    currentRef.current = current;
  }
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // The form every link carried before #644, brought to the canonical one on
  // arrival. In place: a bookmark is not a step the visitor took.
  const legacyTarget = legacyRedirect(location.pathname, location.search);
  const onLegacyRef = useRef(false);
  onLegacyRef.current = legacyTarget !== null;
  useEffect(() => {
    if (legacyTarget !== null) navigate(legacyTarget, { replace: true });
  }, [legacyTarget, navigate]);

  const go = useCallback((target: GoTarget, options?: GoOptions) => {
    // The latest address this hook knows: the one it last wrote, which is ahead
    // of what any render is holding inside the window described on `GoTarget`.
    const [currentPath, currentQuery = ''] = currentRef.current.split('?');
    const current = parseAppUrl(currentPath, currentQuery);
    // Off the map there is no address to change relatively; a caller passing a
    // function there is asking about a place on a page that has none.
    if (typeof target === 'function' && current === null) return;
    const next = typeof target === 'function' ? target(current!) : target;
    // A write names what it knows. For an id it leaves as it is, the slug
    // already in the address stands: opening a card must not strip the
    // region's, and a region brought up to date must not strip the card's.
    const kept = slugsOf(currentPath);
    const names = {
      region: options?.names?.region ?? (current?.regionId === next.regionId ? kept.region : ''),
      experience: options?.names?.experience ?? (current?.experienceId === next.experienceId ? kept.experience : ''),
    };
    const url = buildAppUrl(next, names);
    if (url === currentRef.current) return;
    // A write made while the page is still at a legacy address replaces it:
    // the redirect above was about to, and a push here would leave the `?wv=`
    // form behind as a step in history.
    const replace = options?.replace === true || onLegacyRef.current;
    currentRef.current = url;
    navigateRef.current(url, { replace });
  }, []);

  return useMemo(() => ({ address, go }), [address, go]);
}
