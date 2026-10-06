/**
 * Which kinds' works a place's card lists, and what that shows (#1263): the
 * rule is `utils/worksByKind.ts`, this is its state on one card.
 *
 * The choice is reset whenever the card is opened anew — another place, or the
 * same place from another kind's list or from its pin — during render rather
 * than in an effect, so no frame lists the works of the kind the card was left
 * on. A place in one kind has nothing to choose: every work is listed and no
 * chip is drawn.
 */

import { useCallback, useMemo, useState } from 'react';
import { holdingsNoun } from '../utils/experienceTypes';
import {
  holdingsNounFor, kindChips, kindsChosenOnArrival, worksShown,
  type KindChip, type WorkKind,
} from '../utils/worksByKind';

export interface WorkKindsChoice<T> {
  /** The place is in several kinds, so the card offers a chip per kind. */
  severalKinds: boolean;
  chips: KindChip[];
  shown: T[];
  noun: 'finds' | 'works';
  /** Choose or drop a kind; the last chosen kind stays chosen. */
  toggle: (kindId: number) => void;
}

export function useWorkKinds<T extends { kind_ids: number[] }>(
  /** The place whose works these are; the choice is its card's, not the next place's. */
  placeId: number,
  works: T[],
  placeKinds: WorkKind[] | undefined,
  /** The kind of the list the card was opened from; null for the pin, which chooses every kind. */
  arrivalKindId: number | null,
): WorkKindsChoice<T> {
  const kinds = useMemo(() => placeKinds ?? [], [placeKinds]);
  const severalKinds = kinds.length >= 2;
  const key = `${placeId}:${arrivalKindId}:${kinds.map(kind => kind.kind_id).join(',')}`;
  const [choice, setChoice] = useState(() => ({ key, selected: kindsChosenOnArrival(kinds, arrivalKindId) }));
  if (choice.key !== key) setChoice({ key, selected: kindsChosenOnArrival(kinds, arrivalKindId) });
  const selected = choice.key === key ? choice.selected : kindsChosenOnArrival(kinds, arrivalKindId);

  const toggle = useCallback((kindId: number) => {
    setChoice(current => {
      const next = new Set(current.selected);
      if (next.has(kindId)) {
        if (next.size === 1) return current;
        next.delete(kindId);
      } else {
        next.add(kindId);
      }
      return { key: current.key, selected: next };
    });
  }, []);

  const chips = useMemo(
    () => (severalKinds ? kindChips(works, kinds, selected) : []),
    [severalKinds, works, kinds, selected],
  );
  const shown = useMemo(() => (severalKinds ? worksShown(works, selected) : works), [severalKinds, works, selected]);
  const noun = severalKinds ? holdingsNounFor(selected) : holdingsNoun(arrivalKindId ?? kinds[0]?.kind_id);

  return { severalKinds, chips, shown, noun, toggle };
}
