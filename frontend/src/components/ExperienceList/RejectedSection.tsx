/**
 * The curator's list of what this region refused, under the reader's list.
 *
 * Split out of `ExperienceList` under the 800-line rule in
 * `docs/tech/development-guide.md`. It is a curator affordance rather than part
 * of the reader's list, which is why it renders below the windowed rows and
 * outside the virtualiser: these are few, and they are the one path that reaches
 * the scroll effects' element fallback — an element and no row index.
 *
 * Deliberately not filtered by the map's view (#553). The question it answers is
 * "what did this region turn down", which is about the region rather than about
 * the camera, and a curator scanning it should not have rows appear and vanish
 * as they pan.
 */

import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography, Collapse } from '@mui/material';
import { ExpandLess, ExpandMore, Block as RejectIcon } from '@mui/icons-material';
import type { ReactNode } from 'react';
import type { Experience } from '../../api/experiences';

/** What the header controls, so a screen reader can follow it to the rows. */
const REJECTED_ROWS_ID = 'experience-list-rejected-rows';

interface RejectedSectionProps {
  experiences: Experience[];
  open: boolean;
  onToggle: () => void;
  /** The list's own row renderer, so a rejected row looks like every other. */
  renderRow: (exp: Experience) => ReactNode;
}

export function RejectedSection({ experiences, open, onToggle, renderRow }: RejectedSectionProps) {
  if (experiences.length === 0) return null;

  return (
    <Box>
      {/* A button rather than a `div` with an `onClick`: it is the control that
          opens the section, and on a `div` a keyboard cannot reach it and nothing
          announces whether it is open. Here `aria-controls` can point somewhere
          real — unlike a category's rows, these live inside one `Collapse`. */}
      <ListItemButton
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={REJECTED_ROWS_ID}
        sx={{
          bgcolor: 'error.50',
          '&:hover': { bgcolor: 'grey.200' },
          borderTop: '2px solid',
          borderColor: 'error.200',
        }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          <RejectIcon fontSize="small" color="error" />
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'error.main' }}>
              Rejected ({experiences.length})
            </Typography>
          }
        />
        {open ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse id={REJECTED_ROWS_ID} in={open} timeout="auto" unmountOnExit>
        <List disablePadding>
          {/* One `li` per row here too. */}
          {experiences.map((exp) => (
            <Box component="li" key={exp.id} sx={{ listStyle: 'none' }}>
              {renderRow(exp)}
            </Box>
          ))}
        </List>
      </Collapse>
    </Box>
  );
}
