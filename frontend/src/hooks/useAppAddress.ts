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

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { buildAppUrl, legacyRedirect, parseAppUrl, slugsOf, type AppAddress } from '../utils/appUrl';

export interface AddressNames {
  region?: string | null;
  experience?: string | null;
  point?: string | null;
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
 * whenever it is asked. It answers null where the latest address leaves it
 * nothing to write: a correction meant for a place the reader has since left
 * (#2257).
 */
export type GoTarget = AppAddress | ((current: AppAddress) => AppAddress | null);

/**
 * What `go` last wrote and the location the hook last saw, kept once per router
 * (#2308). Every instance of the hook writes through one `go` of its own, and a
 * write moves the router's location only once React renders it; kept per
 * instance, the latest address of one instance lagged another's write, and a
 * relative write through it put back the address the other had just left (the
 * header's switch to Discover undone by the slug correction).
 */
interface LatestAddress {
  /** What `go` last wrote, ahead of what any render is holding (`GoTarget`). */
  written: string;
  /** The location a render last saw, which tells a navigation from outside `go`. */
  seen: string;
}

const LatestAddressContext = createContext<LatestAddress | null>(null);

/**
 * One latest address for every `useAppAddress` under it, mounted once inside
 * the router (`App.tsx`). A hook outside it keeps its own, which is what a
 * test rendering one hook under a bare router gets.
 */
export function AppAddressProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const latest = useRef<LatestAddress | null>(null);
  if (latest.current === null) {
    const at = `${location.pathname}${location.search}`;
    latest.current = { written: at, seen: at };
  }
  return createElement(LatestAddressContext.Provider, { value: latest.current }, children);
}

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
  // Shared by every instance under the router's `AppAddressProvider` (#2308).
  const shared = useContext(LatestAddressContext);
  const own = useRef<LatestAddress>({ written: current, seen: current });
  const latest = shared ?? own.current;
  if (current !== latest.seen) {
    latest.seen = current;
    latest.written = current;
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
    const [currentPath, currentQuery = ''] = latest.written.split('?');
    const current = parseAppUrl(currentPath, currentQuery);
    // Off the map there is no address to change relatively; a caller passing a
    // function there is asking about a place on a page that has none.
    if (typeof target === 'function' && current === null) return;
    const asked = typeof target === 'function' ? target(current!) : target;
    if (asked === null) return;
    // A part belongs to its card (#1271): a write that changes the card and
    // leaves the part as it found it is not about that part, and carrying it
    // over would name a part of one object under another's address.
    const next = current && asked.experienceId !== current.experienceId && asked.pointId === current.pointId
      ? { ...asked, pointId: null }
      : asked;
    // A write names what it knows. For an id it leaves as it is, the slug
    // already in the address stands: opening a card must not strip the
    // region's, and a region brought up to date must not strip the card's.
    const kept = slugsOf(currentPath);
    const names = {
      region: options?.names?.region ?? (current?.regionId === next.regionId ? kept.region : ''),
      experience: options?.names?.experience ?? (current?.experienceId === next.experienceId ? kept.experience : ''),
      point: options?.names?.point ?? (current?.pointId === next.pointId ? kept.point : ''),
    };
    const url = buildAppUrl(next, names);
    if (url === latest.written) return;
    // A write made while the page is still at a legacy address replaces it:
    // the redirect above was about to, and a push here would leave the `?wv=`
    // form behind as a step in history.
    const replace = options?.replace === true || onLegacyRef.current;
    latest.written = url;
    navigateRef.current(url, { replace });
  }, [latest]);

  return useMemo(() => ({ address, go }), [address, go]);
}
