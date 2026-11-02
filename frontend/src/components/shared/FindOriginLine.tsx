import { Typography, type SxProps, type Theme } from '@mui/material';
import type { ExperienceTreasure } from '../../api/experiences';
import { PlaceLink } from './PlaceLink';

/**
 * Where a find comes from, on its row or tile in the museum that shows it.
 *
 * An archaeology museum's holdings are objects taken from somewhere, and a row
 * naming only the museum tells a traveller the smaller half of what the thing
 * is (ADR-0058). Two claims answer it, in this order:
 *
 * - **found at**, the find's own place of discovery, a way to the site where the
 *   catalogue holds it (#894) and its name where it does not — a city, a
 *   region, a spot no site door has written;
 * - **from**, the site a curator confirmed it comes from, where its item names
 *   no place of discovery (#2242): the Dendera zodiac in the Louvre reads
 *   "from Dendera Temple complex". A relief cut from a standing temple was not
 *   dug up, so the line does not say "found at".
 *
 * Nothing where neither holds: a painting has a maker, not a find spot.
 */
export function FindOriginLine({ content, sx }: {
  content: Pick<ExperienceTreasure, 'found_at' | 'found_at_site' | 'from_site'>;
  sx?: SxProps<Theme>;
}) {
  const { found_at: foundAt, found_at_site: foundAtSite, from_site: fromSite } = content;
  if (!foundAt?.label && !fromSite) return null;
  return (
    <Typography variant="caption" color="text.secondary" display="block" noWrap sx={sx}>
      {foundAt?.label
        ? <>found at {foundAtSite ? <PlaceLink place={foundAtSite} /> : foundAt.label}</>
        : fromSite && <>from <PlaceLink place={fromSite} /></>}
    </Typography>
  );
}
