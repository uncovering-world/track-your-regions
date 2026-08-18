/**
 * Which objects this reader asked to see as a single pin (#558).
 *
 * Drawing every place is right by default and wrong for a few rows: the Rock Art
 * of the Mediterranean Basin puts 734 rock shelters on a map of Spain — 563 of
 * them on screen at once at the zoom that frames Valencia — and it and the Roman
 * limes own a third of the 3463 pins Europe's UNESCO category draws. So the ask
 * exists — and it is per object, never a mode, because a reader who folds that
 * one site still wants the other 466 of that category's rows drawn as the places
 * they are.
 *
 * Held for the region it was made in, and *derived* rather than cleared by an
 * effect: an effect runs after render, which leaves a commit where the new
 * region's rows are drawn against the old region's folds. `showLost` in
 * `useExperienceContext` is the same shape for the same reason.
 *
 * Lives in a hook of its own because both surfaces need it and they do not share
 * a provider: Map mode reads it through `ExperienceProvider`, Discover holds its
 * own. Two readings of one region in two modes are two sessions of looking, and
 * neither is a preference worth persisting.
 */

import { useCallback, useState } from 'react';

/**
 * One frozen empty set for every region nobody has folded anything in, which is
 * nearly all of them. A fresh `new Set()` per render is a new identity, and the
 * marker builder is memoised on this value — a new one would rebuild every marker
 * in the region on each unrelated state change.
 */
const EMPTY_COLLAPSED: ReadonlySet<number> = new Set<number>();

export interface CollapsedExperiences {
  collapsedExperienceIds: ReadonlySet<number>;
  toggleCollapsedExperience: (id: number) => void;
}

export function useCollapsedExperiences(regionId: number | null): CollapsedExperiences {
  const [collapsedFor, setCollapsedFor] = useState<{
    regionId: number | null;
    ids: ReadonlySet<number>;
  }>({ regionId: null, ids: EMPTY_COLLAPSED });

  const collapsedExperienceIds = collapsedFor.regionId === regionId && regionId !== null
    ? collapsedFor.ids
    : EMPTY_COLLAPSED;

  const toggleCollapsedExperience = useCallback((id: number) => {
    setCollapsedFor((prev) => {
      const ids = new Set(prev.regionId === regionId ? prev.ids : EMPTY_COLLAPSED);
      if (!ids.delete(id)) ids.add(id);
      return { regionId, ids };
    });
  }, [regionId]);

  return { collapsedExperienceIds, toggleCollapsedExperience };
}
