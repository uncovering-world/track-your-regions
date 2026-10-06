/**
 * A place's works as one list, each work once and marked with the kinds that
 * hold it (#1263).
 *
 * A merged museum holds most of its works through more than one kind: all 11
 * of the Capitoline Museums' finds are among its 12 works of art, and 22 of
 * the Louvre's 29 finds among its 125. Two sub-lists, one per kind, would show
 * those collections twice, so the card lists each work once, with a chip per
 * kind of the place. A card opened from one kind's list selects that kind, and
 * the other chips say how many works they would add; a card opened from the
 * pin selects every kind.
 *
 * A work no offered membership places carries no kind (`kind_ids` empty): it
 * is the place's, and shown whichever kind is selected.
 */

import { holdingsNoun } from './experienceTypes';

/** One kind of the place, as the place's row carries it (`kinds`). */
export interface WorkKind {
  kind_id: number;
  kind_name: string;
  type: string | null;
}

/** What a work needs to be told apart by kind. */
interface KindHeld {
  kind_ids: number[];
}

/** One chip: the kind, how many works it holds, and what it would add if chosen. */
export interface KindChip {
  kind: WorkKind;
  count: number;
  /** Works it holds that the chosen kinds do not show; what choosing it adds. */
  adds: number;
  selected: boolean;
}

/** Whether a work is on the list while these kinds are chosen. */
export function isShownFor(work: KindHeld, selected: ReadonlySet<number>): boolean {
  return work.kind_ids.length === 0 || work.kind_ids.some(id => selected.has(id));
}

/** The works on the list while these kinds are chosen, in the read's order. */
export function worksShown<T extends KindHeld>(works: T[], selected: ReadonlySet<number>): T[] {
  return works.filter(work => isShownFor(work, selected));
}

/** A chip per kind of the place, in the kinds' display order. */
export function kindChips(works: KindHeld[], placeKinds: WorkKind[], selected: ReadonlySet<number>): KindChip[] {
  return placeKinds.map(kind => {
    const held = works.filter(work => work.kind_ids.includes(kind.kind_id));
    return {
      kind,
      count: held.length,
      adds: held.filter(work => !isShownFor(work, selected)).length,
      selected: selected.has(kind.kind_id),
    };
  });
}

/**
 * The kinds chosen when the card opens: the kind of the list it was opened
 * from, where the place is in it, and every kind of the place otherwise.
 */
export function kindsChosenOnArrival(placeKinds: WorkKind[], arrivalKindId: number | null): Set<number> {
  if (arrivalKindId !== null && placeKinds.some(kind => kind.kind_id === arrivalKindId)) {
    return new Set([arrivalKindId]);
  }
  return new Set(placeKinds.map(kind => kind.kind_id));
}

/**
 * What the list calls what it holds: finds where every chosen kind's
 * holdings are finds, works otherwise (`holdingsNoun`, #885).
 */
export function holdingsNounFor(selected: ReadonlySet<number>): 'finds' | 'works' {
  const nouns = new Set([...selected].map(id => holdingsNoun(id)));
  return nouns.size === 1 && nouns.has('finds') ? 'finds' : 'works';
}
