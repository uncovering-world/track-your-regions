/**
 * One category heading in the experience list: its name, its count, and the
 * curator's way to add an object under it.
 *
 * Split out of `ExperienceList` when the view filter (#553) gave the count a
 * second number and pushed that file past the 800-line rule in
 * `docs/tech/development-guide.md`. Presentational: every piece of state it
 * reads and every handler it calls belongs to the list.
 */

import { ListItem, ListItemButton, ListItemText, Typography, Tooltip, IconButton } from '@mui/material';
import { ExpandLess, ExpandMore, Add as AddIcon } from '@mui/icons-material';
import type { ExperienceGroupLike } from './utils';

interface GroupHeaderProps {
  group: ExperienceGroupLike;
  expanded: boolean;
  onToggle: () => void;
  /**
   * How many the category holds in the whole region, or null when the list is
   * not filtering — where it would only repeat the number already printed.
   */
  regionTotal: number | null;
  canAdd: boolean;
  onAdd: () => void;
}

export function GroupHeader({
  group, expanded, onToggle, regionTotal, canAdd, onAdd,
}: GroupHeaderProps) {
  // Both numbers while the view is filtering: "12 of 467" says what is here *and*
  // that the category holds more, which one number cannot (#553).
  const shown = group.experiences.length;
  const count = regionTotal !== null && regionTotal > shown ? `${shown} of ${regionTotal}` : `${shown}`;
  // The row's name as it is: since migration 045 no source row starts with
  // "Top ", so "Add new art museums" needs nothing stripped (#818).
  const addLabel = `Add new ${group.categoryName.toLowerCase()}`;

  return (
    <ListItem
      component="div"
      disablePadding
      sx={{ bgcolor: 'grey.100', '&:hover': { bgcolor: 'grey.200' } }}
    >
      {/* A button, not a `div` with an `onClick`: this is the control that opens
          and closes a category, and on a `div` it cannot be reached by keyboard
          at all, nor does anything announce whether the group is open. The add
          button stays outside it — a button inside a button is invalid, and its
          click must not toggle the group.

          No `aria-controls`: the rows of an expanded group are absolutely
          positioned siblings produced by the virtualiser, not children of one
          element, so there is no id to point at. A reference to nothing is worse
          than none; `aria-expanded` alone still announces the state. */}
      <ListItemButton onClick={onToggle} aria-expanded={expanded}>
        <ListItemText
          primary={
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {group.categoryName} ({count})
            </Typography>
          }
        />
        {/* Inside the button, not beside it: the chevron is the thing a reader
            aims at to open a category, and as a sibling of the button it is
            inert — the button's `flexGrow` stops at the add button. That also
            leaves the two headers extracted from this file behaving alike. */}
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      {/* Per-source "+" button to create a new experience under this source */}
      {canAdd && (
        <Tooltip title={addLabel}>
          <IconButton
            size="small"
            aria-label={addLabel}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            sx={{ mr: 0.5 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </ListItem>
  );
}
