/**
 * The selected region, and the address that names it (#644).
 *
 * The address is the source of truth for *which* region is selected; this hook
 * holds the hydrated object — what the map flies to, what the header prints,
 * what the list reads its siblings from. Two directions, one place:
 *
 * - A selection made in the app — a click on the map, a row, a search result,
 *   a breadcrumb — sets the object at once, so the map flies from what the
 *   tile knew, and writes the address, pushed: Back returns to the region left.
 * - An address that arrives from elsewhere — a shared link, Back, the address
 *   bar — is followed. The region it names is read by the same ancestors query
 *   the breadcrumbs use, and becomes the selection when it answers. An answer
 *   naming a region this caller cannot see, or one of another world view,
 *   degrades the address to the world view alone, in place and in silence:
 *   the address must not become a way to tell what exists.
 *
 * Split out of `useNavigation` when the address arrived, for the size rule in
 * `docs/tech/development-guide.md` and because the world-view reconciliation
 * there has enough branches of its own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Region } from '../types';
import { fetchRegionAncestors } from '../api';
import type { AppAddress } from '../utils/appUrl';
import type { GoOptions } from './useAppAddress';

export interface SelectRegionOptions {
  /** Discover's open category list, written beside the region; the map ignores it. */
  categoryId?: number | null;
}

interface AddressedRegionInput {
  address: AppAddress | null;
  go: (next: AppAddress, options?: GoOptions) => void;
  isCustomWorldView: boolean;
  /** The session is still being restored; no read bounded by identity goes out yet. */
  authLoading: boolean;
}

/**
 * What the ancestors read can tell a selection that the tile it was clicked in
 * could not, or `null` when there is nothing left to tell it.
 *
 * Only the missing fields, so that applying the answer is what stops the next
 * run from applying it again: each branch requires the field it fills to be
 * absent, and a patch that filled a field already present would re-select the
 * region for ever.
 */
function completeSelectionFromAncestor(selected: Region, ancestor: Region): Partial<Region> | null {
  // The read this answer comes from is keyed on a region id alone, and it is
  // bounded by what the caller may see rather than by what their map is showing
  // (`requireVisibleWorldView`), so it can answer about another world view's
  // region. Completing the selection from such an answer would point this map at
  // that world view's regions. Refuse, and the map stays where it is.
  //
  // No region layer draws unscoped now — each names either the world view or a
  // parent id inside one — so no click should reach here with a foreign region
  // id. (The GADM layers name neither, and need not: they draw divisions, which
  // belong to no world view.) `tile_region_islands` named neither until #660
  // scoped it. This is the fence behind that.
  if (ancestor.worldViewId !== selected.worldViewId) return null;

  const patch: Partial<Region> = {};

  if (!selected.focusBbox && ancestor.focusBbox) {
    patch.focusBbox = ancestor.focusBbox;
    patch.anchorPoint = ancestor.anchorPoint;
    patch.hasSubregions = ancestor.hasSubregions;
  }

  // `tile_region_islands` draws the real coastlines of a hull region and has no
  // `parent_region_id` column, so a click on one arrives with a null parent —
  // the very id the map reads to decide which level to draw, and the list reads
  // to find the region's siblings.
  if (selected.parentRegionId == null && ancestor.parentRegionId != null) {
    patch.parentRegionId = ancestor.parentRegionId;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function useAddressedRegion({ address, go, isCustomWorldView, authLoading }: AddressedRegionInput) {
  const [selectedRegion, setSelectedRegionState] = useState<Region | null>(null);
  const [regionBreadcrumbs, setRegionBreadcrumbs] = useState<Region[]>([]);
  // Read through a ref by the setter, so the setter keeps one identity across
  // the addresses it writes: the map's click handler and the list's row handler
  // are built on it.
  const addressRef = useRef(address);
  addressRef.current = address;

  const urlRegionId = address?.regionId ?? null;
  const urlWorldViewId = address?.worldViewId ?? null;

  /** The id the address names and the selection does not hold; null when they agree. */
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const restoring = restoreId !== null;

  // One ancestors read, for whichever region is in question: the one the
  // address names and the selection does not yet hold, or else the selection
  // itself — for its breadcrumbs, and for what the tile it was clicked in could
  // not tell it. One observer rather than one per purpose, so that a restore
  // is one request and the breadcrumbs find their answer already there.
  //
  // While restoring, the read waits for the session for the reason the
  // world-view list does: it is bounded by what the caller may see, and an
  // admin's hidden region asked for anonymously answers 404 — not a 401, so
  // nothing would retry it with the token. And a 404 then is an answer —
  // hidden, or not there — not a hiccup to retry.
  const ancestorsFor = restoreId ?? selectedRegion?.id ?? null;
  const { data: regionAncestors, isError: ancestorsFailed } = useQuery({
    queryKey: ['regionAncestors', ancestorsFor],
    queryFn: () => fetchRegionAncestors(ancestorsFor!),
    enabled: ancestorsFor !== null && (restoring ? !authLoading : isCustomWorldView),
    ...(restoring ? { retry: false } : {}),
  });

  // Update region breadcrumbs from ancestors query (for custom world views)
  // Also enrich selectedRegion with what the map could not know from the tile
  // it was clicked in. A vector tile carries a region's id, name, colour and —
  // in most layers — its parent; it never carries `focus_bbox` or
  // `anchor_point`, and the islands layer carries no parent either. This read
  // fires on every selection anyway, for the breadcrumbs, and it answers with
  // the full row: the last entry it returns *is* the selected region.
  useEffect(() => {
    // A restore's answer is about the address, not the selection; below.
    if (restoring) return;
    if (regionAncestors) {
      setRegionBreadcrumbs(prev => {
        if (prev.length === regionAncestors.length && prev.every((r, i) => r.id === regionAncestors[i].id)) {
          return prev;
        }
        return regionAncestors;
      });
      const lastAncestor = regionAncestors[regionAncestors.length - 1];
      if (lastAncestor && selectedRegion && lastAncestor.id === selectedRegion.id) {
        const patch = completeSelectionFromAncestor(selectedRegion, lastAncestor);
        if (patch) setSelectedRegionState({ ...selectedRegion, ...patch });
      }
    } else if (!selectedRegion) {
      setRegionBreadcrumbs(prev => prev.length === 0 ? prev : []);
    }
  }, [restoring, regionAncestors, selectedRegion]);

  /** What the address named the last time the follow ran; see below. */
  const lastSeenUrlRegionId = useRef<number | null | undefined>(undefined);

  // Follow the address. Acts only when the address itself moved: a selection
  // made here writes the address through the router's startTransition, so for
  // a commit the new selection stands beside the old address, and following
  // that would undo the click. The world-view reconciliation guards the same
  // way, for the same reason.
  useEffect(() => {
    // Off the map — the account and admin pages — there is nothing to follow.
    if (address === null) return;
    if (urlRegionId === lastSeenUrlRegionId.current) return;
    lastSeenUrlRegionId.current = urlRegionId;
    if (urlRegionId === null) {
      setSelectedRegionState(null);
      setRegionBreadcrumbs([]);
      setRestoreId(null);
      return;
    }
    setRestoreId(urlRegionId === selectedRegion?.id ? null : urlRegionId);
  }, [address, urlRegionId, selectedRegion?.id]);

  // The restore's answer: the region the address named becomes the selection,
  // or the address is degraded to the world view alone.
  useEffect(() => {
    if (restoreId === null || address === null) return;
    if (!regionAncestors && !ancestorsFailed) return;
    const last = regionAncestors?.[regionAncestors.length - 1];
    // The world view is checked against the address, not the selection: on a
    // Back across a switch the world-view state is still catching up.
    if (regionAncestors && last && last.id === restoreId && last.worldViewId === urlWorldViewId) {
      setSelectedRegionState(last);
      setRegionBreadcrumbs(regionAncestors);
      setRestoreId(null);
      return;
    }
    // Not there, not visible, or not this world view: one silence for all three.
    setRestoreId(null);
    go({ ...address, regionId: null, experienceId: null, categoryId: null }, { replace: true });
  }, [restoreId, regionAncestors, ancestorsFailed, address, urlWorldViewId, go]);

  // Bring the slug up to date once the name is known: in place, since it is a
  // correction and not a step. `go` keeps the card's slug, which is not known
  // here.
  useEffect(() => {
    if (address === null || address.regionId === null) return;
    if (!selectedRegion || selectedRegion.id !== address.regionId || !selectedRegion.name) return;
    go(address, { replace: true, names: { region: selectedRegion.name } });
  }, [address, selectedRegion, go]);

  /**
   * A selection made in the app: the object now, the address with it. A new
   * region is a new panel, so the card goes; the category is Discover's to say.
   */
  const setSelectedRegion = useCallback((region: Region | null, options?: SelectRegionOptions) => {
    setSelectedRegionState(region);
    if (!region) setRegionBreadcrumbs([]);
    // A click outranks a restore still in flight.
    setRestoreId(null);
    const at = addressRef.current;
    if (at === null) return;
    go({
      ...at,
      regionId: region?.id ?? null,
      experienceId: null,
      categoryId: options?.categoryId ?? null,
    }, { names: { region: region?.name } });
  }, [go]);

  /**
   * What a departing world view leaves behind. The selection and its trail,
   * not a restore the address is asking for: on a Back across a switch the
   * world-view reconciliation clears the old context in the same pass that the
   * follow above asked for the new region, and that ask must survive it.
   */
  const clearRegion = useCallback(() => {
    setSelectedRegionState(null);
    setRegionBreadcrumbs([]);
  }, []);

  return { selectedRegion, setSelectedRegion, regionBreadcrumbs, clearRegion };
}
