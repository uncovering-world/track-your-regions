/**
 * One line of a review list: a bold title with a date or a count at its end,
 * and under it a caption saying what is asked, behind a stripe in the
 * question's colour. The queue's questions are drawn with it, and so are the
 * crowded cities on their own tab (#2282), so the two lists read alike.
 */

import type { ReactNode, Ref } from 'react';
import { Box, ListItemButton, Typography } from '@mui/material';

export function QueueLine({
  title, aside, detail, color, selected, onClick, lineRef, disabled = false,
}: {
  title: string;
  /** The short text at the title's end: a question's date. */
  aside?: string;
  /** The caption under the title, one line, cut where it runs out. */
  detail: ReactNode;
  /** The stripe's colour: the question's own (`KIND_COLOR`). */
  color: string;
  selected: boolean;
  onClick: () => void;
  lineRef?: Ref<HTMLDivElement>;
  /** Not to be opened now: a crowded city's lines while an Apply runs. */
  disabled?: boolean;
}) {
  return (
    <ListItemButton
      ref={lineRef}
      selected={selected}
      disabled={disabled}
      onClick={onClick}
      sx={{
        // `block` over the button's own flex row, so the two lines stack; the
        // width comes from `ListItem`'s flex, which the button grows into.
        display: 'block', py: 1, borderLeft: '3px solid', borderLeftColor: color,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {aside && (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {aside}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {detail}
      </Typography>
    </ListItemButton>
  );
}
