/**
 * The map's world layer: whether it is drawn, which kind it draws, and whether
 * it is folded (#910).
 *
 * Kept out of `RegionMapVT` because that component is already the map's chrome,
 * its four tile sources and its loading states; what this holds is one question
 * (is a region selected?) and two pieces of view state, one of which lives in
 * the address.
 *
 * **The kind is in the address** (`?kind=`, `docs/tech/addresses.md`): a link to
 * the world map of Archaeology has to open on Archaeology, and the same
 * parameter already names Discover's open kind. It degrades the way every other
 * id in an address does — silently, once the kinds have answered, and only then:
 * an empty list is what stands in while the read is in flight, and treating it
 * as an answer would spend a shared link on a hiccup.
 *
 * **The fold is not.** It is a way of looking at the pins on the screen in front
 * of you, the same thing `useCollapsedExperiences` holds per region and per
 * surface, and Back through it would be a step nobody took.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '../../hooks/useNavigation';
import { useAppAddress } from '../../hooks/useAppAddress';
import { fetchExperienceKinds, type ExperienceKind } from '../../api/experiences';

export interface WorldLayerState {
  /** Whether the map draws the catalogue's points instead of a region's markers. */
  active: boolean;
  /** The kind on the map, or null for every kind at once. */
  kindId: number | null;
  setKind: (kindId: number | null) => void;
  kinds: ExperienceKind[];
  /** The kind's own name, for the hover card; the tile carries only the id. */
  kindNameOf: (kindId: number | null) => string | null;
  folded: boolean;
  toggleFold: () => void;
}

export function useWorldLayer(): WorldLayerState {
  const { selectedRegion, isCustomWorldView } = useNavigation();
  const { address, go } = useAppAddress();
  const [folded, setFolded] = useState(false);

  /**
   * A custom world view with nothing selected. Not the default world view: its
   * map is the administrative tree, which owns no regions, so a pin there could
   * be hovered and never opened — and ADR-0042 refuses to answer a click by
   * writing another world view's address.
   */
  const active = isCustomWorldView && !selectedRegion;

  // The same key the list and Discover read the kinds under, so the control
  // costs no request of its own wherever one of them has already asked — and
  // none at all for a reader who arrives at a region, where this layer is not
  // drawn. These reads sit under `publicReadLimiter` beside the ones that draw
  // the list itself, so a request nobody needs is one the list may not make.
  const { data: kinds = [], isSuccess: kindsAnswered } = useQuery({
    queryKey: ['experience-kinds'],
    queryFn: fetchExperienceKinds,
    staleTime: 300000,
    enabled: active,
  });

  const addressKindId = address?.kindId ?? null;
  const known = addressKindId !== null && kinds.some(kind => kind.id === addressKindId);
  // The address is trusted until the kinds have actually answered, which is the
  // same flag the drop below waits for. Read against `kinds` alone, the empty
  // list that stands in while that read is in flight makes a *valid* kind read
  // as absent too — so a shared `/wv/5?kind=5` would mount the all-kinds tile
  // URL, fetch that heaviest variant's tiles, and then swap the whole source
  // once the answer landed, flashing the full catalogue across the one screen
  // this layer is measured on.
  const kindId = !kindsAnswered || addressKindId === null || known ? addressKindId : null;

  const setKind = useCallback((next: number | null) => {
    go(current => ({ ...current, kindId: next }));
  }, [go]);

  // A kind nobody knows leaves the address, in place: the visitor did not ask
  // for it, so it is not a step in their history. Only once the kinds have
  // actually answered — see the note at the top of this file.
  useEffect(() => {
    if (!active || !kindsAnswered) return;
    if (addressKindId !== null && !known) go(current => ({ ...current, kindId: null }), { replace: true });
  }, [active, kindsAnswered, addressKindId, known, go]);

  const kindNameOf = useCallback(
    (id: number | null) => kinds.find(kind => kind.id === id)?.name ?? null,
    [kinds],
  );

  const toggleFold = useCallback(() => setFolded(value => !value), []);

  return useMemo(
    () => ({ active, kindId, setKind, kinds, kindNameOf, folded, toggleFold }),
    [active, kindId, setKind, kinds, kindNameOf, folded, toggleFold],
  );
}
