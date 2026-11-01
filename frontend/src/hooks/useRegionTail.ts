/**
 * A region's tail (ADR-0172, #2201): the places a crowded city leaves out of
 * the region's list, read on their own and never mixed into it.
 *
 * Held by the experience provider, because two surfaces read it: the list,
 * which ends a kind's group with a folded row that opens the kind's tail in
 * place, and the map, which draws the open tails' places. Each kind's tail is
 * read when it is opened and not before, and cached as the list is.
 *
 * **A card the list lacks may be in the tail.** Search finds a crowded-out
 * place and lands in its region with its card in the address (Santa Sabina in
 * Lazio). The list does not hold it, so before the provider drops the card as
 * one the region does not hold, the tail is asked: the open tails first, then
 * every kind's tail at once. A place found there is the open card — `card` —
 * and its kind's tail is opened for it once, as the list opens a card's group
 * once (`expansionForSelection`), so a reader who folds it afterwards is not
 * overruled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, type QueryObserverResult } from '@tanstack/react-query';
import {
  fetchRegionTail, type Experience, type ExperiencesByRegionResponseCrowdedOutItem, type RegionTailResponse,
} from '../api/experiences';
import { queryKeys } from '../api/queryKeys';

export type CrowdedOutCount = ExperiencesByRegionResponseCrowdedOutItem;

export interface RegionTail {
  /** How many places each kind and type leaves out of the list; empty where none does. */
  counts: readonly CrowdedOutCount[];
  /** The kinds whose tail is open. */
  open: ReadonlySet<number>;
  /** Open a kind's tail, or fold it again. */
  toggle: (kindId: number) => void;
  /** Each open kind's tail that has arrived, the best known first; absent while it loads. */
  places: ReadonlyMap<number, Experience[]>;
  /** The open kinds whose tail could not be read: folding and opening again asks again. */
  failed: ReadonlySet<number>;
  /** The open card's place, where the list lacks it and a tail holds it. */
  card: Experience | null;
  /** A place a tail read holds, by id: the open tails', then the lookup's. */
  find: (id: number) => Experience | undefined;
}

const NO_COUNTS: readonly CrowdedOutCount[] = [];
const NO_KINDS: ReadonlySet<number> = new Set();
const STALE_MS = 300_000;

/** Stable, so `useQueries` hands back the same array while no answer changes. */
const answersOf = (results: Array<QueryObserverResult<RegionTailResponse>>) =>
  results.map(result => ({ data: result.data, failed: result.isError }));

export function useRegionTail(opts: {
  regionId: number | null;
  /** The list's `crowdedOut`, or undefined until the list has answered. */
  counts: readonly CrowdedOutCount[] | undefined;
  /** The open card, on the region this provider shows. */
  selectedExperienceId: number | null;
  /** Whether the list holds the open card. */
  listHoldsSelected: boolean;
}): RegionTail & {
  /** Whether the tail has said all it can about the open card: a card it does not hold may be dropped. */
  settled: boolean;
} {
  const { regionId, selectedExperienceId, listHoldsSelected } = opts;
  const counts = opts.counts ?? NO_COUNTS;

  // Held for the region it was opened in, as a kind's type is: a tail opened
  // in Lazio says nothing about Toscana's list.
  const [openFor, setOpenFor] = useState<{ regionId: number | null; kinds: ReadonlySet<number> } | null>(null);
  const open = openFor !== null && openFor.regionId === regionId ? openFor.kinds : NO_KINDS;
  const setOpen = useCallback((kindId: number, isOpen: boolean) => {
    setOpenFor(prev => {
      const next = new Set(prev !== null && prev.regionId === regionId ? prev.kinds : NO_KINDS);
      if (isOpen) next.add(kindId);
      else next.delete(kindId);
      return { regionId, kinds: next };
    });
  }, [regionId]);
  const toggle = useCallback((kindId: number) => setOpen(kindId, !open.has(kindId)), [open, setOpen]);

  const openKinds = useMemo(() => [...open], [open]);
  const answers = useQueries({
    queries: openKinds.map(kindId => ({
      queryKey: queryKeys.experiences.tail(regionId, kindId),
      queryFn: () => fetchRegionTail(regionId!, kindId),
      enabled: regionId !== null,
      staleTime: STALE_MS,
    })),
    combine: answersOf,
  });
  const places = useMemo(() => {
    const byKind = new Map<number, Experience[]>();
    openKinds.forEach((kindId, i) => {
      const answer = answers[i]?.data;
      if (answer) byKind.set(kindId, answer.experiences);
    });
    return byKind;
  }, [openKinds, answers]);
  const failed = useMemo(
    () => new Set(openKinds.filter((_, i) => answers[i]?.failed && !answers[i]?.data)),
    [openKinds, answers],
  );

  const inOpenTail = useMemo(() => {
    if (selectedExperienceId === null || listHoldsSelected) return undefined;
    for (const rows of places.values()) {
      const hit = rows.find(exp => exp.id === selectedExperienceId);
      if (hit) return hit;
    }
    return undefined;
  }, [places, selectedExperienceId, listHoldsSelected]);

  // Every kind's tail at once, asked only for a card the list lacks in a region
  // that leaves something out, and only where no open tail holds it already.
  const lookupNeeded = opts.counts !== undefined && counts.length > 0
    && selectedExperienceId !== null && !listHoldsSelected && inOpenTail === undefined;
  const lookup = useQuery({
    queryKey: queryKeys.experiences.tail(regionId, null),
    queryFn: () => fetchRegionTail(regionId!, null),
    enabled: lookupNeeded && regionId !== null,
    staleTime: STALE_MS,
  });
  const lookedUp = lookupNeeded ? lookup.data?.experiences.find(exp => exp.id === selectedExperienceId) : undefined;
  const card = inOpenTail ?? lookedUp ?? null;
  // Only an answer counts, as for the list: a lookup still on its way, or one
  // that failed, says nothing about what the tail holds.
  const settled = !lookupNeeded || lookedUp !== undefined || lookup.data !== undefined;

  // The card's kind's tail is opened once per card, so folding it stands.
  const openedForCard = useRef<number | null>(null);
  useEffect(() => {
    if (card === null) {
      // A selection that has left the remembered card forgets it, so coming
      // back opens its tail again; the same card, briefly without its row
      // while the tail refetches, keeps a reader's fold.
      if (selectedExperienceId !== openedForCard.current) openedForCard.current = null;
      return;
    }
    if (openedForCard.current === card.id) return;
    openedForCard.current = card.id;
    if (!open.has(card.kind_id)) setOpen(card.kind_id, true);
  }, [card, open, setOpen, selectedExperienceId]);

  const lookupRows = lookup.data?.experiences;
  const find = useCallback((id: number) => {
    for (const rows of places.values()) {
      const hit = rows.find(exp => exp.id === id);
      if (hit) return hit;
    }
    return lookupRows?.find(exp => exp.id === id);
  }, [places, lookupRows]);

  return useMemo(
    () => ({ counts, open, toggle, places, failed, card, find, settled }),
    [counts, open, toggle, places, failed, card, find, settled],
  );
}

/**
 * The open tails' places the map draws beside the list's: each once, and none
 * the list already holds — a place crowded out of one kind and shown in another
 * is drawn as the other kind's row.
 */
export function tailPins(listed: readonly Experience[], places: ReadonlyMap<number, Experience[]>): Experience[] {
  if (places.size === 0) return [];
  const seen = new Set(listed.map(exp => exp.id));
  const pins: Experience[] = [];
  for (const rows of places.values()) {
    for (const exp of rows) {
      if (seen.has(exp.id)) continue;
      seen.add(exp.id);
      pins.push(exp);
    }
  }
  return pins;
}
