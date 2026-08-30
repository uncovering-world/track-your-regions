/**
 * The rest of an explanation, one hover away.
 *
 * A curator works through nineteen refusals at a sitting, so the card carries one short
 * sentence and this carries the reasoning: how the source decides, what threshold it
 * applied, the rule's own wording, what marking a point gone does. Putting all of that
 * on every card would be four lines of machinery per row and a screen nobody finishes
 * reading; leaving it out would ask for a verdict on a rule the page never explains.
 *
 * The caller says what the hint is about, because the button is the only thing a screen
 * reader gets: "how this rule decides" and "what marking a point gone does" are
 * different promises, and one label for both would be wrong for one of them. A *fact*
 * is explained differently — on its own name, in the review card's table (`FactTable`),
 * since a question mark per row was most of what made that card a pile of text.
 *
 * Renders nothing when there is nothing to add, rather than a question mark that answers
 * none — an affordance that disappoints is worse than no affordance.
 */

import { IconButton, Tooltip, Typography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

export function HelpHint({ text, label }: {
  text: string | null;
  /** What the hint explains, for the button's accessible name: "how this rule decides". */
  label: string;
}) {
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
      <IconButton size="small" aria-label={label} sx={{ p: 0.25 }}>
        <HelpOutlineIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}
