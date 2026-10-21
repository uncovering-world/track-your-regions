/**
 * A place's subtitle: the one line under its name that says what the place is
 * (#1795), such as Wikidata's "museum in Saint Petersburg, Russia". Drawn
 * wherever the name heads the place — the list row, the Discover card, both
 * hover cards and the detail panel — on one line, cut with an ellipsis and
 * whole in its tooltip. Renders nothing for a place with none.
 */

import { Typography } from '@mui/material';

interface PlaceSubtitleProps {
  subtitle: string | null | undefined;
}

export function PlaceSubtitle({ subtitle }: PlaceSubtitleProps) {
  const line = subtitle?.trim();
  if (!line) return null;
  return (
    <Typography
      variant="caption"
      component="div"
      color="text.secondary"
      noWrap
      title={line}
      sx={{ display: 'block', lineHeight: 1.3 }}
    >
      {line}
    </Typography>
  );
}

/**
 * The description a place's opened card shows: its paragraph, unless it only
 * repeats the subtitle the card already shows under the name. A place with a
 * subtitle and no description shows the subtitle alone, under the name.
 */
export function descriptionBeyondSubtitle(
  place: { subtitle?: string | null; description?: string | null },
): string | null {
  const description = place.description?.trim();
  if (!description) return null;
  return description === place.subtitle?.trim() ? null : description;
}
