/**
 * The rest of an explanation, one hover away.
 *
 * A curator works through nineteen refusals at a sitting, so the card carries one short
 * sentence and this carries the reasoning: how the source decides, what threshold it
 * applied, and the rule's own wording. The works it counted hang on the count itself
 * (`WorksPreview`) — that is a different question, asked by a different part of the
 * sentence. Putting all of that on every card would be four lines of
 * machinery per row and a screen nobody finishes reading; leaving it out would ask for a
 * verdict on a rule the page never explains.
 *
 * Renders nothing when there is nothing to add, rather than a question mark that answers
 * none — an affordance that disappoints is worse than no affordance.
 */

import { IconButton, Tooltip, Typography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

export function RuleHelp({ text }: { text: string | null }) {
  if (!text) return null;

  return (
    <Tooltip
      // Reachable by keyboard as well as by pointer: `IconButton` takes focus, and MUI
      // opens the tooltip on focus, so this is not a mouse-only explanation.
      title={(
        <Typography variant="caption" component="div" sx={{ whiteSpace: 'pre-line' }}>
          {text}
        </Typography>
      )}
      arrow
      slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}
    >
      <IconButton size="small" aria-label="how this rule decides" sx={{ p: 0.25 }}>
        <HelpOutlineIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}
