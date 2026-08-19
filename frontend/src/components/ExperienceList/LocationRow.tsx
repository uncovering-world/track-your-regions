/**
 * One place inside an open card.
 *
 * Memoised, and it subscribes to the hover itself — the two together are the
 * point of it existing. Passed down as a prop, the hovered place travelled
 * through the card, so the card re-rendered to deliver it and every place in it
 * re-rendered to receive it: for the Historic Centre of Saint Petersburg, 112 MUI
 * `ListItem`s with their emotion styling on every mouse move between rows.
 * Profiled in the browser on that card, one hover re-rendered 1489 fibers and
 * blocked the main thread for 600-860 ms. Reading the store here instead, the
 * pointer moving between two places re-renders those two rows.
 *
 * The remaining props are chosen so the memo can hold: `visited` rather than the
 * lookup function, and callbacks the card keeps stable. `onHover` takes the id
 * back so the card does not have to bind a new closure per row on every render —
 * a bound closure is a new prop, and a new prop is the re-render this exists to
 * stop.
 */

import { memo } from 'react';
import { useHoverSelector } from '../../hooks/useHoverContext';
import { Box, ListItem, ListItemIcon, ListItemText, Checkbox } from '@mui/material';
import { LocationOn as LocationIcon } from '@mui/icons-material';
import { locationLabel } from '../../utils/locationLabel';
import { resolveLocationColor } from './utils';
import { VISITED_GREEN } from '../../utils/categoryColors';

/** What a row needs of a place — the card's own display shape, not the API's. */
export interface LocationRowData {
  id: number;
  name: string | null;
  ordinal: number | null;
  isVisited: boolean;
}

interface LocationRowProps {
  location: LocationRowData;
  showCheckbox: boolean;
  /** Out-of-region places are shown dimmed, are not hoverable, and carry a path. */
  outOfRegion?: boolean;
  regionPath?: string | null;
  onHover: (locationId: number) => void;
  onVisitedToggle: (locationId: number, isVisited: boolean) => void;
  registerRef: (locationId: number, element: HTMLElement | null) => void;
}

function LocationRowComponent({
  location, showCheckbox, outOfRegion, regionPath,
  onHover, onVisitedToggle, registerRef,
}: LocationRowProps) {
  // One boolean, so this row re-renders only when the pointer arrives at or
  // leaves it. An out-of-region place is not hoverable and is drawn dimmed, so it
  // selects a constant false and never re-renders for a hover at all.
  const hovered = useHoverSelector(s => !outOfRegion && s.hoveredLocationId === location.id);

  if (outOfRegion) {
    return (
      <Box
        component="li"
        sx={{ listStyle: 'none' }}
        ref={(el: HTMLElement | null) => registerRef(location.id, el)}
      >
        <ListItem component="div" dense sx={{ py: 0.5, opacity: 0.4, bgcolor: 'grey.100', cursor: 'default' }}>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <LocationIcon fontSize="small" color="disabled" />
          </ListItemIcon>
          <ListItemText
            primary={locationLabel(location)}
            secondary={regionPath || 'Outside region'}
            slotProps={{
              primary: { variant: 'body2', sx: { color: 'text.disabled' } },
              secondary: { variant: 'caption', sx: { fontSize: '0.65rem' } },
            }}
          />
        </ListItem>
      </Box>
    );
  }

  return (
    // An `li`, because the `List` around these renders a `ul` and a bare `div`
    // is a child it may not have. The `ListItem` inside is the `div`, so the
    // list reads as one item per place to anything speaking the page aloud.
    <Box
      component="li"
      sx={{ listStyle: 'none' }}
      ref={(el: HTMLElement | null) => registerRef(location.id, el)}
    >
      <ListItem
        component="div"
        dense
        sx={{
          py: 0.5,
          // `action.hover`, not `primary.100`: this theme defines
          // `palette.primary.main` alone, so `primary.100` resolved to nothing
          // and a place hovered *from the map* got no background at all — while
          // the same row under the pointer got one from the `&:hover` below.
          // The two hovers mean the same thing and now look the same.
          bgcolor: hovered ? 'action.hover' : 'transparent',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={() => onHover(location.id)}
        secondaryAction={
          showCheckbox ? (
            <Checkbox
              edge="end"
              checked={location.isVisited}
              size="small"
              onChange={() => onVisitedToggle(location.id, location.isVisited)}
              sx={{ '&.Mui-checked': { color: VISITED_GREEN } }}
            />
          ) : undefined
        }
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <LocationIcon fontSize="small" color={hovered ? 'primary' : 'action'} />
        </ListItemIcon>
        <ListItemText
          primary={locationLabel(location)}
          slotProps={{
            primary: {
              variant: 'body2',
              sx: {
                textDecoration: location.isVisited ? 'line-through' : 'none',
                color: resolveLocationColor(hovered, location.isVisited),
                fontWeight: hovered ? 600 : 400,
              },
            },
          }}
        />
      </ListItem>
    </Box>
  );
}

export const LocationRow = memo(LocationRowComponent);
