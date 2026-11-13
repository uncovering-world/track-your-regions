/**
 * A place's circle (#2420, #2486): every place of its type within the radius,
 * the ones the card's button counts, as one list by fame with the place itself
 * at its own rank (`circleRows`), and the groups the map's legend and each
 * dot's hover name them by, which each row's note says where its rank does
 * not:
 * - **better known**: what the rule compares the place with (`compared`),
 *   whatever the place's own score, so a neighbour a curator keeps on the
 *   list counts above a place not measured yet too;
 * - **better known, not counted**: measured above it, and left out of the
 *   comparison because it holds works a reader is shown (ADR-0173) or a
 *   curator keeps it in the shadow;
 * - **less known**: measured at or below it, so not counted against it;
 * - **not measured yet**: arrived after the last run measured fame.
 *
 * A place not measured yet is compared only with what a curator keeps on the
 * list, so its other measured neighbours are listed as measured, not as less
 * known. A type the kind exempts is never compared, and its neighbours are
 * listed the same way.
 */

import type { CrowdingPlaceView } from '../../../api/crowding';
import { notMeasuredLine } from './crowdingWords';
import { nounOf, type RuleWords } from './rowWords';

type Neighbour = CrowdingPlaceView['around'][number];

export type CircleGroup = 'compared' | 'uncounted' | 'less' | 'measured' | 'unmeasured';

/** The order the legend names the groups in. */
export const CIRCLE_GROUPS: readonly CircleGroup[] = ['compared', 'uncounted', 'less', 'measured', 'unmeasured'];

/** What each group is called, in the map's legend and a dot's hover. */
export const GROUP_WORDS: Record<CircleGroup, string> = {
  compared: 'better known, compared with it',
  uncounted: 'better known, not counted against it',
  less: 'less known, not counted against it',
  measured: 'measured, not compared with it',
  unmeasured: 'not measured yet',
};

/** The group a neighbour is listed in. */
export function groupOf(entry: Pick<Neighbour, 'score' | 'compared'>, view: Pick<CrowdingPlaceView, 'place' | 'typeExempt'>): CircleGroup {
  if (entry.compared) return 'compared';
  if (entry.score === null) return 'unmeasured';
  if (view.place.score === null || view.typeExempt) return 'measured';
  return entry.score > view.place.score ? 'uncounted' : 'less';
}

/** Why a better-known neighbour is not counted against the place, in words for its row. */
export function uncountedReason(entry: Pick<Neighbour, 'holdsWorks' | 'pin'>): string {
  if (entry.holdsWorks) return 'It holds works readers are shown.';
  return entry.pin === 'shadow' ? 'A curator keeps it in the shadow.' : 'The rule leaves it out.';
}

/**
 * What the rule does with a neighbour, in words for its row, where its rank
 * does not say it: a row above the open place is better known and counted
 * against it, one below is less known and not counted. Null where the rank
 * says it all.
 */
export function rowNote(entry: Neighbour, view: Pick<CrowdingPlaceView, 'place' | 'typeExempt' | 'measurable' | 'kind'>): string | null {
  const { place } = view;
  switch (groupOf(entry, view)) {
    case 'compared': {
      // Counted for its fame, it stands above the place; one a curator keeps on the list counts from anywhere.
      const better = entry.score !== null && place.score !== null && entry.score > place.score;
      if (better) return null;
      return entry.pin === 'list' ? 'Counted against it. A curator keeps it on the list.' : 'Counted against it.';
    }
    case 'uncounted':
      return `Not counted against it. ${uncountedReason(entry)}`;
    case 'less':
      // A tie is not counted, and the order may set it above the place.
      return entry.score === place.score ? 'As well known as it, and not counted against it.' : null;
    case 'measured':
      if (view.typeExempt) return `Not compared. ${view.kind.name} never hides a place of this type.`;
      return view.measurable ? `Not compared until ${place.name} is measured.` : `Not compared. ${place.name} is never measured.`;
    case 'unmeasured':
      return 'Not measured yet.';
  }
}

/** What the circle's order reads of a place: its fame, and its membership to break a tie. */
type Ranked = Pick<Neighbour, 'membershipId' | 'score'>;

/**
 * The circle's order (#2486): best known first, a tie broken by the
 * membership's id, the places not measured yet last. It never reads which
 * place is open, so two circles list the places they share in one order.
 */
export function byFame(a: Ranked, b: Ranked): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  return a.membershipId - b.membershipId;
}

/** One row of the circle's table: the open place, or a place around it with its note. */
export type CircleRow = {
  /** Its rank by fame in the circle, the open place counted; null for a place not measured yet. */
  rank: number | null;
} & (
  | { own: true; place: CrowdingPlaceView['place'] }
  | { own: false; entry: Neighbour; note: string | null }
);

/**
 * The circle as one list (#2486): the open place among its neighbours at its
 * own rank, every row in the order `byFame` gives, each neighbour with what
 * the rule does with it where its rank does not say it.
 */
export function circleRows(view: CrowdingPlaceView): CircleRow[] {
  const rows: CircleRow[] = [
    { own: true, place: view.place, rank: null },
    ...view.around.map(entry => ({ own: false as const, entry, note: rowNote(entry, view), rank: null })),
  ];
  const ranked = (row: CircleRow): Ranked => (row.own ? row.place : row.entry);
  rows.sort((a, b) => byFame(ranked(a), ranked(b)));
  return rows.map((row, index) => ({ ...row, rank: ranked(row).score === null ? null : index + 1 }));
}

/** The neighbours by group, for the heading and the legend to count: the list's order is `circleRows`'s. */
export function circleGroups(view: CrowdingPlaceView): Record<CircleGroup, Neighbour[]> {
  const groups: Record<CircleGroup, Neighbour[]> = { compared: [], uncounted: [], less: [], measured: [], unmeasured: [] };
  for (const entry of view.around) groups[groupOf(entry, view)].push(entry);
  return groups;
}

/**
 * What the circle's heading says the rule found, in a sentence or two:
 * "3 better-known churches within 10 km." or "The best-known church within
 * 10 km. 14 others are less known." A place not measured yet is never
 * said to have nothing above it.
 */
export function circleHeading(view: CrowdingPlaceView, rule: RuleWords): string {
  const groups = circleGroups(view);
  const within = `within ${rule.radiusKm} km`;
  if (view.typeExempt) return `${view.around.length + 1} ${nounOf(rule, view.around.length + 1)} ${within}`;
  if (view.place.score === null) return notMeasuredLine(view.measurable, view.measuringRun, groups.compared.length + view.comparedUnlisted);
  const counted = view.place.outrankedBy ?? groups.compared.length + view.comparedUnlisted;
  const less = groups.less.length;
  const others = less === 1 ? 'One other is' : `${less} others are`;
  const lessSentence = less === 0 ? '' : ` ${others} less known.`;
  // A better-known neighbour the rule leaves out (its works, a curator's shadow) is said apart, never hidden.
  const uncounted = groups.uncounted.length;
  const more = uncounted === 1 ? 'One more better known is' : `${uncounted} more better known are`;
  const uncountedSentence = uncounted === 0 ? '' : ` ${more} not counted.`;
  if (counted === 0 && uncounted === 0) return `The best-known ${nounOf(rule, 1)} ${within}.${lessSentence}`;
  if (counted === 0) return `No better-known ${nounOf(rule, 1)} ${within} counts against it.${uncountedSentence}${lessSentence}`;
  return `${counted} better-known ${nounOf(rule, counted)} ${within}.${uncountedSentence}${lessSentence}`;
}
