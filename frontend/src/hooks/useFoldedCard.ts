/**
 * What a card the open list does not hold names now (#1247, ADR-0086).
 *
 * A merge folds one place into another, and the folded place's address still
 * answers — with the surviving place's card (ADR-0046 decision 5). The by-id
 * read follows the merge, so its answer carries the survivor's id where the
 * address carried the folded one: that is how a link shared before a merge
 * opens the place it now is, rather than being dropped as a card the list does
 * not hold.
 *
 * A part of a serial site (ADR-0100) is in no list either: it is reached
 * through its site, and its own address — a link to the Temple of Karnak —
 * moves to Ancient Thebes' card opened at the temple's point. A part that
 * holds a kind of its own keeps its card: the Karnak Temple Complex, once the
 * temple is merged into it, is a place of worship part of Ancient Thebes.
 *
 * Asked only for a card the list has answered without — a place nobody merged
 * costs no request. Kept under a key of its own rather than the card's: the
 * answer is the survivor's detail under the folded id, and cached as the
 * folded place's card it would stand for that place once a merge is undone.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchExperience } from '../api/experiences';
import { ApiError } from '../api/fetchUtils';
import { queryKeys } from '../api/queryKeys';

/**
 * The place a folded card now is: its id, and its name for the address's
 * slug; for a part, the site's, with the part's point to open it at.
 */
export interface FoldedInto {
  id: number;
  name: string;
  /** The part's point, which the site's card opens it at; null for a merge. */
  pointId: number | null;
  /** The part's name, for the point's slug. */
  pointName?: string;
}

const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * `undefined` while the answer is out, or when the read failed for a reason
 * that says nothing about the card — a failed read must not spend a shared
 * link; `null` when the card is not one to open (hidden, refused, elsewhere,
 * gone) and the address drops it; the surviving place when a merge folded it;
 * the site, at the part's point, when the card is a part.
 */
export function useFoldedCard(id: number | null, missing: boolean): FoldedInto | null | undefined {
  const asked = id !== null && missing;
  const { data, error } = useQuery({
    queryKey: queryKeys.experience.survivor(id ?? 0),
    queryFn: () => fetchExperience(id!),
    enabled: asked,
    retry: (count, failure) => !isNotFound(failure) && count < 1,
  });
  if (!asked) return null;
  // A part with a kind of its own is a place in its own right (ADR-0100 decision 2): its card is its own.
  if (data?.part_of && data.kinds.length === 0) {
    const { part_of: whole } = data;
    return { id: whole.id, name: whole.name, pointId: whole.point_id, pointName: data.name };
  }
  if (data) return data.id === id ? null : { id: data.id, name: data.name, pointId: null };
  return isNotFound(error) ? null : undefined;
}
