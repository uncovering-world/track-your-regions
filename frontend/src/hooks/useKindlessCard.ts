/**
 * A card Discover's address names without a kind (#2236): Map mode hands
 * Discover its open card so, and a shared link may. Its kind is the object's
 * own. The object is the region list's place or, where a crowded city left it
 * out of that list (ADR-0172), a place found in a kind's tail: Santa Sabina,
 * shadowed among Lazio's places of worship, opens in its kind's tail rather
 * than being dropped.
 */

import { useEffect } from 'react';
import type { Experience } from '../api/experiences';
import type { AppAddress } from '../utils/appUrl';
import { kindToOpenIn } from '../utils/placeKinds';
import type { useAppAddress } from './useAppAddress';
import type { FoldedInto } from './useFoldedCard';

/**
 * Which card the tails are asked about: the open kind's, or — for a card the
 * address names without a kind (#2236) — the addressed one, looked for in every
 * kind's tail. The rows are the same either way: with no kind open the list is
 * the region's whole.
 */
export function kindlessLookup(opts: {
  address: AppAddress | null;
  addressedExperienceId: number | null;
  kindId: number | null;
  selectedExperienceId: number | null;
}): { unkinded: boolean; cardId: number | null } {
  const unkinded = opts.address !== null && opts.addressedExperienceId !== null && opts.kindId === null;
  return { unkinded, cardId: unkinded ? opts.addressedExperienceId : opts.selectedExperienceId };
}

/** What a card without a kind is: the list's place, a tail's, or none once the list and every tail have answered. */
export function kindlessOutcome(opts: {
  unkinded: boolean;
  addressedObject: Experience | undefined;
  tail: { card: Experience | null; settled: boolean };
  kindsKnown: boolean;
  listAnswered: boolean;
}): { object: Experience | undefined; missing: boolean; ready: boolean } {
  const ready = opts.unkinded && opts.kindsKnown && opts.listAnswered;
  if (!ready) return { object: undefined, missing: false, ready };
  const object = opts.addressedObject ?? opts.tail.card ?? undefined;
  return { object, missing: object === undefined && opts.tail.settled, ready };
}

/**
 * A card the address names without a kind (Map mode's open card, a shared
 * link): its kind is the object's own, read off the object and written into
 * the address in place. The object is the region list's place, or a place a
 * crowded city left out of that list, found in a tail (#2236); one found in
 * neither is moved where a merge folded it (#1247) or dropped. Not before the
 * kinds and the region have answered — until then every object is unknown —
 * and a read that failed is not an answer: it must not spend a shared link on
 * a hiccup.
 */
export function useKindlessCard(opts: {
  address: AppAddress | null;
  object: Experience | undefined;
  /** Whether the list and every tail have answered without it. */
  missing: boolean;
  /** Whether the card has no kind and the kinds and the list have answered. */
  ready: boolean;
  kinds: ReadonlyArray<{ id: number }>;
  foldedInto: FoldedInto | null | undefined;
  moveOrDrop: (at: AppAddress, into: FoldedInto | null) => void;
  go: ReturnType<typeof useAppAddress>['go'];
}): void {
  const { address, object, missing, ready, kinds, foldedInto, moveOrDrop, go } = opts;
  useEffect(() => {
    if (address === null || !ready) return;
    if (object === undefined) {
      if (missing && foldedInto !== undefined) moveOrDrop(address, foldedInto);
      return;
    }
    // A kind that offers the card, read off `kinds` as the list filter is (#1245).
    const openIn = kindToOpenIn(object);
    const kind = openIn === null ? undefined : kinds.find(c => c.id === openIn);
    go(
      kind ? { ...address, kindId: kind.id } : { ...address, experienceId: null },
      { replace: true, names: { experience: object.name } },
    );
  }, [address, ready, object, missing, kinds, foldedInto, moveOrDrop, go]);
}
