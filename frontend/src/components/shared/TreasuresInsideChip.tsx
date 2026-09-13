/**
 * Says a place has something to look at inside, derived from the region row's
 * `treasure_count` (offered + published treasure links).
 *
 * Silent for the kinds whose row already lists what is inside — art museums
 * (`kind_id` 2) and archaeology (5), whose museums hold finds the row lists the
 * same way. A card of either shows the holdings as the point of the row rather
 * than as a side note, so a second "N treasures inside" chip would say the same
 * thing twice. Every other kind that links treasures — places of worship among
 * them, where the treasures are a side note beside the building — gets the chip
 * where the count is actually above zero.
 *
 * Sized to match `LifecycleChip`, the badge it sits beside in every row and
 * card: MUI's own `size="small"` (24px) reads a third taller than the other
 * badges on the same line. No margin of its own — every container this chip
 * is mounted in already lays its children out with a `gap`, so an `ml` here
 * would double the space the container already gives it.
 */

import { Chip } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

/** The kinds whose row lists its holdings itself, so the chip would repeat it. */
const LISTS_ITS_OWN_CONTENTS = [2, 5];

export interface TreasuresInsideChipProps {
  count?: number | null;
  kindId: number;
}

export function TreasuresInsideChip({ count, kindId }: TreasuresInsideChipProps) {
  if (!count || LISTS_ITS_OWN_CONTENTS.includes(kindId)) return null;

  const text = `${count} ${count === 1 ? 'treasure' : 'treasures'} inside`;

  return (
    <Chip
      size="small"
      // Decorative: the chip's own `aria-label` is the one thing a screen
      // reader announces for this control.
      icon={<AutoAwesomeIcon aria-hidden="true" sx={{ fontSize: '0.75rem !important' }} />}
      label={text}
      aria-label={text}
      sx={{
        height: 18,
        fontSize: '0.6rem',
        fontWeight: 700,
        flexShrink: 0,
        '& .MuiChip-label': { px: 0.5 },
        '& .MuiChip-icon': { ml: 0.25 },
      }}
    />
  );
}
