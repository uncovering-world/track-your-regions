/**
 * A row of the crowded-city window in words (ADR-0180, #2282): its standing,
 * the curator's pin with the rule's own reading beside it where the two
 * differ, and the rule's count.
 */

import type { CrowdingWindowRow } from '../../../api/crowding';
import type { DrawnStanding } from './crowdingStaging';

/** A row's standing as its chip names it. */
const STANDING_WORDS: Record<DrawnStanding, string> = {
  listed: 'in the list',
  shadowed: 'shadowed',
  new: 'new',
  refused: 'not taken',
};

/** A new arrival's chip says where the rule would put it once passed. */
export function standingChip(row: CrowdingWindowRow): string {
  if (row.standing !== 'new') return STANDING_WORDS[row.standing];
  return row.crowded ? 'new · the rule shadows it' : 'new · the rule lists it';
}

/** A curator's pin, with the rule's own reading beside it where the two differ. */
export function pinChip(row: CrowdingWindowRow): string | null {
  if (row.pin === null) return null;
  const pinned = row.pin === 'list' ? 'kept in the list' : 'kept in the shadow';
  if (row.pin === 'list' && row.ruleCrowded) return `${pinned} · the rule would shadow it`;
  if (row.pin === 'shadow' && !row.ruleCrowded) return `${pinned} · the rule would list it`;
  return pinned;
}

/** The rule's count, as the column says it: "10 better" — the radius is in the column's heading. */
export function outrankedWords(row: CrowdingWindowRow): string {
  if (row.outrankedBy === null) return '—';
  return `${row.outrankedBy} better`;
}
