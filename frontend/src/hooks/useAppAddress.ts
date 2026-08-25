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
import { buildAppUrl, legacyRedirect, parseAppUrl, type AppAddress } from '../utils/appUrl';

export interface AddressNames {
  region?: string | null;
  experience?: string | null;
}

export interface GoOptions {
  replace?: boolean;
  /** Decoration for the ids: hung on as slugs where known. */
  names?: AddressNames;
}

export function useAppAddress() {
  const location = useLocation();
  const navigate = useNavigate();

  const address = useMemo(
    () => parseAppUrl(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const current = `${location.pathname}${location.search}`;
  const currentRef = useRef(current);
  currentRef.current = current;
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

  const go = useCallback((next: AppAddress, options?: GoOptions) => {
    const url = buildAppUrl(next, options?.names);
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
