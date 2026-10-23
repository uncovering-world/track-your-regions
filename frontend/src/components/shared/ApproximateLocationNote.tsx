/**
 * The note on a point the source placed only roughly (#1912): the reason in
 * full on a point's own card or on a site of one point, and a short word with
 * the reason in its tooltip on one row of a card listing many, beside the
 * maps link it qualifies. Nothing for an exact point.
 */

import { Tooltip, Typography } from '@mui/material';
import { APPROXIMATE_SHORT, approximateLocationWords } from '../../utils/approximateLocation';
import type { ExperienceLocation } from '../../api/experiences';

export function ApproximateLocationNote({ reason, compact = false }: {
  reason: ExperienceLocation['approximate'] | undefined;
  compact?: boolean;
}) {
  if (!reason) return null;
  const words = approximateLocationWords(reason);
  if (!compact) {
    return <Typography variant="caption" color="text.secondary" component="p">{words}</Typography>;
  }
  return (
    // Focusable, so the keyboard opens the tooltip too; the tooltip names the
    // word with its reason for a screen reader.
    <Tooltip title={words}>
      <Typography variant="caption" color="text.secondary" tabIndex={0} sx={{ fontStyle: 'italic', whiteSpace: 'nowrap' }}>
        {APPROXIMATE_SHORT}
      </Typography>
    </Tooltip>
  );
}
