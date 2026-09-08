/**
 * Says a place has something to look at inside, derived from the region row's
 * `treasure_count` (offered + published treasure links).
 *
 * Silent for a museum (`category_id` 2): every museum row already carries
 * works, and a card there shows the count as the point of the row rather than
 * as a side note — a second "N treasures inside" chip would repeat it. Every
 * other kind that links treasures — places of worship among them — gets the
 * chip only where the count is actually above zero.
 *
 * Sized to match `LifecycleChip`, the badge it sits beside in every row and
 * card: MUI's own `size="small"` (24px) reads a third taller than the other
 * badges on the same line. No margin of its own — every container this chip
 * is mounted in already lays its children out with a `gap`, so an `ml` here
 * would double the space the container already gives it.
 */

import { Chip } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

const ART_MUSEUMS = 2;

export interface TreasuresInsideChipProps {
  count?: number | null;
  categoryId: number;
}

export function TreasuresInsideChip({ count, categoryId }: TreasuresInsideChipProps) {
  if (!count || categoryId === ART_MUSEUMS) return null;

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
