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
import { Box, ListItem, ListItemIcon, ListItemText, Checkbox, IconButton, Tooltip } from '@mui/material';
import { LocationOn as LocationIcon, EditLocationAlt as FixPlaceIcon } from '@mui/icons-material';
import { locationLabel } from '../../utils/locationLabel';
import { claimLabel } from '../../utils/placeClaims';
import { resolveLocationColor } from './utils';
import { VISITED_GREEN } from '../../utils/categoryColors';

/** What a row needs of a place — the card's own display shape, not the API's. */
export interface LocationRowData {
  id: number;
  name: string | null;
  ordinal: number | null;
  isVisited: boolean;
  /** Where it is, for the dialog a curator corrects it in. */
  latitude: number;
  longitude: number;
  /** The fields a curator has claimed on the place, so the row can say it is corrected. */
  curatedFields?: string[];
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
  /**
   * Offered to a curator: opens this place where it can be corrected. One stable
   * function per card, never a closure per row — the row is memoised and a fresh
   * prop on every render is the re-render this file exists to stop.
   */
  onCorrect?: (location: LocationRowData) => void;
}

function LocationRowComponent({
  location, showCheckbox, outOfRegion, regionPath,
  onHover, onVisitedToggle, registerRef, onCorrect,
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
        <ListItem
          component="div"
          dense
          sx={{
            py: 0.5, opacity: 0.4, bgcolor: 'grey.100', cursor: 'default',
            '& .place-fix': { opacity: 0, transition: 'opacity 0.15s ease' },
            '&:hover .place-fix, &:focus-within .place-fix': { opacity: 1 },
          }}
          // A place outside the region is still a place a curator is looking at.
          secondaryAction={onCorrect ? <FixPlaceButton location={location} onCorrect={onCorrect} /> : undefined}
        >
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
          // The curator's action lives in the row's own line and shows for the
          // row under the pointer, the one holding keyboard focus, or the one lit
          // from the map — thirty rows do not carry thirty pencils. Opacity, not
          // display: the button stays in the tab order, which is what reveals it.
          '& .place-fix': { opacity: hovered ? 1 : 0, transition: 'opacity 0.15s ease' },
          '&:hover .place-fix, &:focus-within .place-fix': { opacity: 1 },
        }}
        onMouseEnter={() => onHover(location.id)}
        secondaryAction={
          showCheckbox || onCorrect ? (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {onCorrect && <FixPlaceButton location={location} onCorrect={onCorrect} />}
              {showCheckbox && (
                <Checkbox
                  edge="end"
                  checked={location.isVisited}
                  size="small"
                  onChange={() => onVisitedToggle(location.id, location.isVisited)}
                  sx={{ '&.Mui-checked': { color: VISITED_GREEN } }}
                />
              )}
            </Box>
          ) : undefined
        }
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <LocationIcon fontSize="small" color={hovered ? 'primary' : 'action'} />
        </ListItemIcon>
        <ListItemText
          primary={locationLabel(location)}
          // "pin corrected" under the name where a curator has moved it: without
          // the word, a pin somebody put there reads as the source's.
          secondary={claimLabel(location.curatedFields) ?? undefined}
          slotProps={{
            primary: {
              variant: 'body2',
              sx: {
                textDecoration: location.isVisited ? 'line-through' : 'none',
                color: resolveLocationColor(hovered, location.isVisited),
                fontWeight: hovered ? 600 : 400,
              },
            },
            secondary: { variant: 'caption' },
          }}
        />
      </ListItem>
    </Box>
  );
}

/**
 * The way into the correction dialog from a place's row, for a curator.
 *
 * Named for the place: a list of thirty bare pencil icons is a list a screen reader
 * cannot use. The closure is made here, inside the memoised row, where a fresh
 * function costs this row's render and nobody else's.
 */
function FixPlaceButton({ location, onCorrect }: {
  location: LocationRowData;
  onCorrect: (location: LocationRowData) => void;
}) {
  const label = `Fix ${locationLabel(location)}`;
  return (
    <Tooltip title="Move or rename this place">
      <IconButton className="place-fix" size="small" aria-label={label} onClick={() => onCorrect(location)}>
        <FixPlaceIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

export const LocationRow = memo(LocationRowComponent);
