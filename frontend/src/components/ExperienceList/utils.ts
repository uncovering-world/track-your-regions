/**
 * Shared constants and helpers for the ExperienceList components.
 */

import type { Experience } from '../../api/experiences';
import type { TailSection } from './tailRows';

export const OUT_OF_REGION_INITIAL = 3;

/**
 * How many of an object's in-region places an open card mounts before asking.
 *
 * Twenty is more than any card a reader meets in one look and far below the
 * serial sites that made this necessary: the Historic Centre of Saint Petersburg
 * carries 112 places, and mounting them all cost 432 ms and left the card's
 * hover trailing the pointer by several rows. Discover's panel virtualises the
 * same list; here the card's height is measured by the list's own virtualiser,
 * so a cap with a way past it is the shape that fits.
 */
export const IN_REGION_INITIAL = 20;
export const ARTWORKS_INITIAL_LIMIT = 10;

/**
 * Whether a hover names an in-region place the cap is currently hiding.
 *
 * Only a hover from the *map* can: it names a place, the place's row is what
 * draws it, and a row past `IN_REGION_INITIAL` was never mounted — so without
 * this the marker for the fiftieth of the Historic Centre's ninety-three places
 * highlighted nothing, and the list centred the object's row instead of the
 * place. A hover from the list can only have come from a row already on screen.
 */
export function hoverRevealsCappedPlace(
  inRegionIds: readonly number[],
  hoveredLocationId: number | null,
  hoverSource: 'marker' | 'list' | null,
): boolean {
  if (hoverSource !== 'marker' || hoveredLocationId === null) return false;
  return inRegionIds.indexOf(hoveredLocationId) >= IN_REGION_INITIAL;
}

export function resolveLocationColor(isLocationHovered: boolean, isVisited: boolean): string {
  if (isLocationHovered) return 'primary.main';
  if (isVisited) return 'text.secondary';
  return 'text.primary';
}

/**
 * "12 more in this region — show them all", the way back from a filtered list (#553).
 *
 * The count is what the view is hiding, not what it holds: a reader who has
 * panned away from every object sees an empty list, and without a number saying
 * the region still has 47 of them that reads as "this region is empty" — which
 * contradicts the whole-region promise the product makes.
 */
export function outsideViewLabel(count: number): string {
  // Not `plural()`: "more" is invariant, and the helper would render "12 mores".
  // The singular is the only form an eye checks, which is how that got through.
  return `${count} more in this region — show ${count === 1 ? 'it' : 'them all'}`;
}

/**
 * One entry of the windowed list: a kind heading, or one experience under it.
 *
 * The list reads as groups and renders as a sequence, because a virtualiser counts
 * rows and a group is not a row.
 */
export type FlatRow =
  | { kind: 'header'; group: ExperienceGroupLike }
  | { kind: 'experience'; exp: Experience }
  /** The selected place's card, above the groups (`kindRows.ts` `cardAboveGroups`). */
  | { kind: 'card'; exp: Experience }
  /** The folded row that ends a group whose kind leaves places out (`tailRows.ts`, #2201). */
  | { kind: 'tail'; group: ExperienceGroupLike; section: TailSection }
  /** One place of an open tail, under that row and apart from the group's own rows. */
  | { kind: 'tail-place'; exp: Experience };

/**
 * A row's identity, not its position: the virtualiser caches measured heights
 * under it, and an index shifts whenever a group or a tail above it folds.
 */
export function rowKey(row: FlatRow): string {
  switch (row.kind) {
    case 'header': return `h:${row.group.kindName}`;
    case 'tail': return `t:${row.group.kindName}`;
    case 'card': return `c:${row.exp.id}`;
    case 'tail-place': return `p:${row.exp.id}:${row.exp.kind_id}`;
    default: return `e:${row.exp.id}:${row.exp.kind_id}`;
  }
}

/**
 * A row's height before it is measured. Measured, not guessed, because in a
 * 467-row list the guess decides where a scroll lands: only the rows a reader
 * has already passed carry a real height, and every other one is this number.
 * At 72 against a real 59 the list carried some 6000 px of height that does not
 * exist, so `scrollToIndex` aimed past its row, and the total shrank as rows
 * arrived and were measured — which moves the content under a reader who is not
 * scrolling, and shows an empty panel when the position ends up beyond the
 * shrunken end.
 *
 * Measured live on Europe: a header is 46 px, a collapsed row 59 px (65 or 85
 * where the title wraps to two or three lines); a tail's folded row is one line
 * of caption. `measureElement` still corrects each row as it renders, and an
 * expanded row is five to fifteen times taller — no estimate could cover both,
 * which is what the measuring is for.
 */
export function rowEstimate(row: FlatRow | undefined): number {
  if (row?.kind === 'header') return 46;
  if (row?.kind === 'tail') return 40;
  return 62;
}

/** Only what flattening needs, so the caller's fuller group type still fits. */
export interface ExperienceGroupLike {
  kindName: string;
  experiences: Experience[];
}

/** What the list should have open, and which card that answers. */
export interface GroupExpansion {
  /** The set to open, or null where what is already open answers the card. */
  open: Set<string> | null;
  /** The card this answers, so a reader who then collapses it is not overruled. */
  forCard: number | null;
}

/**
 * Which groups the list opens by itself, and when it leaves them alone.
 *
 * Two rules, in this order. **A card the selection names is opened**: a card
 * inside a collapsed group is not open, whatever the address says, so the
 * holding group joins whatever is already open. **A region's first list opens
 * its first group**, once, which is what a reader with no card in hand gets.
 *
 * Both were one rule before, fired once per region, and each half of that was
 * a way to be sent somewhere and shown nothing. A link to a museum in a region
 * whose first kind is UNESCO opened UNESCO. And a reader already standing
 * in Noord-Holland who searched "Rijksmuseum" (#592) got an address change with
 * no region change at all, so the once-per-region rule declined to fire and the
 * card stayed folded away — the defect the first half had just fixed, on the
 * path the search creates.
 *
 * `forCard` is what keeps this from fighting the reader: a card is answered
 * once, so collapsing the group afterwards stands. Returns null where there is
 * nothing to do — no groups, or a selection already answered.
 */
export function expansionForSelection<T extends ExperienceGroupLike>(opts: {
  groups: T[];
  /** The card the address names, or null. */
  selectedExperienceId: number | null;
  /** What is open now. */
  expanded: ReadonlySet<string>;
  /** Has this region's list already opened a group by itself? */
  openedForRegion: boolean;
  /** The card the last automatic opening answered. */
  openedForCard: number | null;
}): GroupExpansion | null {
  const { groups, selectedExperienceId, expanded, openedForRegion, openedForCard } = opts;
  if (groups.length === 0) return null;

  if (selectedExperienceId !== null && openedForCard !== selectedExperienceId) {
    const holding = groups.find(
      group => group.experiences.some(exp => exp.id === selectedExperienceId),
    );
    if (holding) {
      return {
        open: expanded.has(holding.kindName)
          ? null
          : new Set(expanded).add(holding.kindName),
        forCard: selectedExperienceId,
      };
    }
    // A card this region does not hold: the window between its rows arriving
    // and the address dropping the card. Fall through to the first-list rule,
    // so a reader is given a list rather than none.
  }

  if (openedForRegion) return null;
  return { open: new Set([groups[0].kindName]), forCard: openedForCard };
}

/**
 * Groups and their open experiences as one sequence, headers included.
 *
 * A collapsed group contributes its header alone. The order is the groups' own: the reader's
 * sequence must not change because the rows are now windowed.
 */
export function flattenGroups(
  groups: ExperienceGroupLike[],
  expandedGroups: Set<string>,
  cardAbove: Experience | null = null,
  /** Each group's tail by its name (`tailSections`): a row after its places, and the tail's places under it while open. */
  tails: ReadonlyMap<string, TailSection> = new Map(),
): FlatRow[] {
  const rows: FlatRow[] = cardAbove ? [{ kind: 'card', exp: cardAbove }] : [];
  for (const group of groups) {
    rows.push({ kind: 'header', group });
    if (!expandedGroups.has(group.kindName)) continue;
    for (const exp of group.experiences) rows.push({ kind: 'experience', exp });
    const section = tails.get(group.kindName);
    if (!section) continue;
    rows.push({ kind: 'tail', group, section });
    if (section.open) for (const exp of section.places ?? []) rows.push({ kind: 'tail-place', exp });
  }
  return rows;
}

/**
 * Where each experience sits in the flat list.
 *
 * Every movement of the list needs it — they live in `useListScrollAnchor` —
 * because windowing means the row a map marker points at usually has no element:
 * `itemRefs` holds nothing for it, so the virtualiser has to be asked for an
 * index instead. A movement that must not answer a change of rows reads it
 * through a ref; one that depends on it carries a guard that keeps a group
 * toggled from reaching it — the arrival of a selection is brought in once per
 * selection (#917), and the re-aim after a click only inside that click's
 * flight (#553).
 */
export function rowIndexByExperienceId(rows: FlatRow[], echoes?: ReadonlySet<unknown>): Map<number, number> {
  const m = new Map<number, number>();
  rows.forEach((row, i) => {
    // A place in several kinds is aimed at by its home row, never an echo (#1245),
    // and by its card where that stands above the groups (#1262).
    if (row.kind === 'card' || (row.kind === 'experience' && !echoes?.has(row.exp))) m.set(row.exp.id, i);
  });
  // A tail's place only where the list has no row of it: a place crowded out of
  // one kind and shown in another is aimed at by its shown row (#2201).
  rows.forEach((row, i) => {
    if (row.kind === 'tail-place' && !m.has(row.exp.id)) m.set(row.exp.id, i);
  });
  return m;
}

/**
 * The experiences among a set of windowed row indices.
 *
 * What makes a New-badge impression honest once the rows are windowed: the server
 * keeps the *first* impression, so reporting a row the reader never scrolled to
 * spends their personal window on it unseen.
 */
export function experienceIdsAtIndices(rows: FlatRow[], indices: number[]): number[] {
  const ids: number[] = [];
  for (const i of indices) {
    const row = rows[i];
    if (row && 'exp' in row) ids.push(row.exp.id);
  }
  return ids;
}

/**
 * The experiences the viewport actually intersects.
 *
 * Not the same set as the mounted rows: the virtualiser mounts `overscan` rows on
 * either side of the viewport deliberately, and those are below the fold. Counting
 * them as seen would be the smaller version of the mistake windowing exists to
 * fix — a reader who opens a region and never scrolls would spend a week's mark on
 * rows they never reached. `virtualizer.range` is that pre-overscan range.
 */
export function experienceIdsInVisibleRange(
  rows: FlatRow[],
  range: { startIndex: number; endIndex: number } | null,
): number[] {
  if (!range) return [];
  const indices: number[] = [];
  for (let i = range.startIndex; i <= range.endIndex; i++) indices.push(i);
  return experienceIdsAtIndices(rows, indices);
}
