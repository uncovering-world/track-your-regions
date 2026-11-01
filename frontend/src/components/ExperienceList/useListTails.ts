/**
 * The region list's groups with their tails (ADR-0172, #2201): the groups a
 * crowded kind needs added (`withTailGroups`) and each group's tail row
 * (`tailSections`), from the tail `useRegionTail` holds.
 *
 * The kinds' names are read only where a crowded kind has no place in the
 * region's list to name it — the kinds read the world layer already holds.
 * And the points of the tail's cards the reader opened, which the region's
 * batch leaves out (`useTailLocations`).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchExperienceKinds, type RegionExperienceLocation } from '../../api/experiences';
import { queryKeys } from '../../api/queryKeys';
import type { RegionTail } from '../../hooks/useRegionTail';
import type { KindTypeEntry } from '../../utils/kindTypeIndex';
import type { KindGroup } from './kindRows';
import { tailSections, withTailGroups, type TailKind, type TailSection } from './tailRows';
import { useTailLocations } from './useTailLocations';

const NO_KINDS: readonly TailKind[] = [];

export function useListTails(opts: {
  regionId: number | null;
  /** The list's groups before a type narrows them. */
  groups: KindGroup[];
  tail: RegionTail;
  kindTypeIndex: ReadonlyMap<string, KindTypeEntry>;
  kindTypes: ReadonlyMap<string, string>;
  selectedExperienceId: number | null;
}): {
  groups: KindGroup[];
  sections: ReadonlyMap<string, TailSection>;
  /** By place id, the points of the tail's cards opened in this region. */
  points: Readonly<Record<number, RegionExperienceLocation[]>>;
} {
  const { regionId, groups, tail, kindTypeIndex, kindTypes, selectedExperienceId } = opts;
  const points = useTailLocations(regionId, tail.card?.id ?? null);

  const kindIdsInRegion = useMemo(
    () => new Set([...kindTypeIndex.values()].map(entry => entry.kindId)),
    [kindTypeIndex],
  );
  const unnamed = tail.counts.some(entry => !kindIdsInRegion.has(entry.kindId));
  const { data: kindsData } = useQuery({
    queryKey: queryKeys.experiences.kinds,
    queryFn: fetchExperienceKinds,
    enabled: unnamed,
  });
  const kinds = useMemo<readonly TailKind[]>(
    () => kindsData?.map(kind => ({ id: kind.id, name: kind.name, priority: kind.display_priority })) ?? NO_KINDS,
    [kindsData],
  );

  const withTails = useMemo(
    () => withTailGroups(groups, tail.counts, new Set(kindTypeIndex.keys()), kinds, tail.card),
    [groups, tail.counts, tail.card, kindTypeIndex, kinds],
  );

  const sections = useMemo(() => {
    const kindIdOf = new Map<string, number>(kinds.map(kind => [kind.name, kind.id]));
    for (const [name, entry] of kindTypeIndex) kindIdOf.set(name, entry.kindId);
    if (tail.card) kindIdOf.set(tail.card.kind_name, tail.card.kind_id);
    return tailSections({
      groupNames: withTails.map(group => group.kindName),
      kindIdOf,
      counts: tail.counts,
      kindTypes,
      open: tail.open,
      places: tail.places,
      failed: tail.failed,
      keepId: selectedExperienceId,
    });
  }, [withTails, kinds, kindTypeIndex, kindTypes, tail.counts, tail.open, tail.places, tail.failed, tail.card, selectedExperienceId]);

  return { groups: withTails, sections, points };
}
