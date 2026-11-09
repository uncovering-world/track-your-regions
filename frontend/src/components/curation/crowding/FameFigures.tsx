/**
 * What a crowded city's place weighs (#2400): the signals its score is made
 * of — readers a year, Wikipedia editions, whether a guide uses it — and the
 * score itself (ADR-0172), as one line: each signal by its name, counts
 * grouped in thousands, the guide as yes or no, the score to two decimals. A
 * curator sorting list from shadow sees at once
 * that a cathedral is read thirty times more than the chapel shadowed beside
 * it, or that two neighbours are a coin toss apart. A value not read yet is a
 * dash, never a zero. The place's card adds the rule's count against its line
 * (`better`).
 */

import { Typography } from '@mui/material';
import type { CrowdingGroupPlace } from '../../../api/crowding';

type Signals = Pick<CrowdingGroupPlace, 'readers' | 'wikipediaEditions' | 'guideUsed' | 'score'>;

const DASH = '—';

/** A count as the table printed it, or a dash before it is read. */
const countWords = (value: number | null) => (value === null ? DASH : value.toLocaleString('en'));

/** Whether a guide uses the place, or a dash before its guides are read. */
function guideWords(used: boolean | null): string {
  if (used === null) return DASH;
  return used ? 'yes' : 'no';
}

/** "Readers a year 209,401 · Editions 47 · Guide yes · Score 0.70", and the rule's count where it is given. */
export function fameWords(signals: Signals, better?: { count: number; radiusKm: number; limit: number }): string {
  const parts = [
    `Readers a year ${countWords(signals.readers)}`,
    `Editions ${countWords(signals.wikipediaEditions)}`,
    `Guide ${guideWords(signals.guideUsed)}`,
    `Score ${signals.score === null ? DASH : signals.score.toFixed(2)}`,
  ];
  if (better) parts.push(`Better within ${better.radiusKm} km ${better.count} of ${better.limit}`);
  return parts.join(' · ');
}

export function FameFigures({ signals, better }: {
  signals: Signals;
  /** The rule's count of better-known places within the radius, against the line it shadows at: the card's. */
  better?: { count: number; radiusKm: number; limit: number };
}) {
  return (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {fameWords(signals, better)}
    </Typography>
  );
}
