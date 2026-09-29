/**
 * Says that what was dug up at a site is on view in a museum, derived from
 * the region row's `finds_count` (#907) — the length of the site's own list
 * of finds, which opening the row shows (`SiteFinds`).
 *
 * The sibling of `TreasuresInsideChip`, and a different statement: not "there
 * is something to see inside" but "what was found here is on view somewhere
 * else" — Amarna's Nefertiti in Berlin, the Mask of Agamemnon from Mycenae in
 * Athens. The must-see badge cannot carry it, since nearly every archaeology
 * row wears that already. Silent at zero, which is every row that is not a
 * site: the count is only ever asked of one.
 *
 * Sized and spaced as `TreasuresInsideChip` is, for the reason given there: it
 * sits beside the same badges in the same rows and cards.
 */

import { Chip, Tooltip } from '@mui/material';
import MuseumOutlinedIcon from '@mui/icons-material/MuseumOutlined';

export interface FindsOnViewChipProps {
  count?: number | null;
}

export function FindsOnViewChip({ count }: FindsOnViewChipProps) {
  if (!count) return null;

  const text = `${count} ${count === 1 ? 'find' : 'finds'} on view`;
  // Where they are is the card's to say; the chip says only that they are
  // somewhere a traveller can go and see them.
  const meaning = count === 1
    ? 'A find from here is on view in a museum'
    : `${count} finds from here are on view in a museum`;

  return (
    <Tooltip title={`${meaning} — open the card to see where`}>
      <Chip
        size="small"
        // Decorative: the chip's `aria-label` is what a screen reader announces.
        icon={<MuseumOutlinedIcon aria-hidden="true" sx={{ fontSize: '0.75rem !important' }} />}
        label={text}
        aria-label={meaning}
        sx={{
          height: 18,
          fontSize: '0.6rem',
          fontWeight: 700,
          flexShrink: 0,
          '& .MuiChip-label': { px: 0.5 },
          '& .MuiChip-icon': { ml: 0.25 },
        }}
      />
    </Tooltip>
  );
}
