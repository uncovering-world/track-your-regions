/**
 * The places of an object, as Discover's detail panel lists them: collapsible,
 * searchable past fifteen, virtualised, each row with its visit checkbox and —
 * for a curator — the way into correcting it (#583).
 *
 * Its own file since that correction arrived: `ExperienceDetailPanel.tsx` had
 * crossed the development guide's "split now" line, and this section was already
 * self-contained and exported for its test. The shape mirrors Map mode's
 * `LocationRow`: a place's row is where a curator meets a serial site's component
 * with the pin in view, and the two surfaces offer the same door the same way.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Box,
  ButtonBase,
  Typography,
  IconButton,
  Button,
  Checkbox,
  Collapse,
  TextField,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SearchIcon from '@mui/icons-material/Search';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import RemoveDoneIcon from '@mui/icons-material/RemoveDone';
import EditLocationAltIcon from '@mui/icons-material/EditLocationAlt';
import { useVirtualizer } from '@tanstack/react-virtual';
import { subscribeToHoverTarget, useHoverActions, useHoverSelector } from '../../hooks/useHoverContext';
import { EmptyState } from '../shared/EmptyState';
import { locationLabel } from '../../utils/locationLabel';
import { claimLabel } from '../../utils/placeClaims';

const LOCATIONS_COLLAPSE_THRESHOLD = 15;

/** One place the object has, as a row in the section's location list. */
export interface PanelLocation {
  id: number;
  name: string | null;
  ordinal: number | null;
  longitude: number;
  latitude: number;
  isVisited: boolean;
  /** The fields a curator has claimed on the place, so the row can say it is corrected. */
  curatedFields?: string[];
}

interface LocationsSectionProps {
  /** Whose places these are — a row hover names the object and the place. */
  experienceId: number;
  locations: PanelLocation[];
  totalCount: number;
  isAuthenticated: boolean;
  onMarkLocation: (id: number) => void;
  onUnmarkLocation: (id: number) => void;
  onMarkAll: () => void;
  onUnmarkAll: () => void;
  /** A curator's way into correcting a place, handed to every row unchanged. */
  onCorrect?: (location: PanelLocation) => void;
}

/**
 * Exported for its test, like `ContentsSection`: what it promises is a property
 * of the *closed* state — that a keyboard can open it — and no caller of the
 * panel can drive that.
 */
export function LocationsSection({
  experienceId,
  locations,
  totalCount,
  isAuthenticated,
  onMarkLocation,
  onUnmarkLocation,
  onMarkAll,
  onUnmarkAll,
  onCorrect,
}: LocationsSectionProps) {
  const shouldCollapse = totalCount > LOCATIONS_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const [searchText, setSearchText] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { store } = useHoverActions();

  const visitedCount = locations.filter((l) => l.isVisited).length;

  const filteredLocations = useMemo(() => {
    if (!searchText) return locations;
    const lower = searchText.toLowerCase();
    return locations.filter((l) => (l.name || '').toLowerCase().includes(lower));
  }, [locations, searchText]);

  const virtualizer = useVirtualizer({
    count: filteredLocations.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 40,
    overscan: 5,
  });

  // Auto-scroll to hovered location (from map highlight dot hover) — from a
  // subscription, so a pointer crossing the dots does not re-render this
  // section per move; the hover used to arrive as page state, which did (#573).
  // Only a hover from the map: a row hover can only have come from a row
  // already on the page. Through refs, because the subscription is registered
  // once and a hover is not the moment to re-register it because the rows or
  // the fold changed.
  const filteredRef = useRef(filteredLocations);
  filteredRef.current = filteredLocations;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => subscribeToHoverTarget(store, ({ hoveredLocationId, hoverSource }) => {
    if (hoverSource !== 'marker' || hoveredLocationId == null) return;
    const idx = filteredRef.current.findIndex(l => l.id === hoveredLocationId);
    if (idx >= 0) {
      if (!expandedRef.current) setExpanded(true);
      // Smooth stays: these rows are fixed-height estimates with no
      // `measureElement`, which is the case TanStack supports it for.
      virtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
    }
  }), [store, virtualizer]);

  return (
    <Box sx={{ mb: 2 }}>
      {/* Same disclosure, and if anything the sharper of the two: each row inside
          carries a visit checkbox, so a signed-in keyboard reader was locked out of
          *recording* — on a serial site of more than fifteen places, which is every
          site whose list is worth opening. Ticking off the places you have stood in
          is what this product is for, so the header that hides them is not a lesser
          case than the works grid. */}
      <ButtonBase
        component="div"
        role="button"
        aria-expanded={expanded}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', mb: 1,
          width: '100%', textAlign: 'inherit',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <LocationOnIcon fontSize="small" color="action" />
        <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
          Locations ({totalCount})
        </Typography>
        {isAuthenticated && (
          <Typography variant="caption" color={visitedCount === totalCount ? 'success.main' : 'text.secondary'}>
            {visitedCount}/{totalCount} visited
          </Typography>
        )}
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ButtonBase>

      <Collapse in={expanded} timeout="auto">
        {/* Batch actions + search for large lists */}
        {totalCount > LOCATIONS_COLLAPSE_THRESHOLD && (
          <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Filter locations..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              sx={{ flex: 1 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            {isAuthenticated && (
              <>
                <Tooltip title="Mark all visited">
                  <IconButton size="small" onClick={onMarkAll} color="success">
                    <DoneAllIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Unmark all">
                  <IconButton size="small" onClick={onUnmarkAll} color="default">
                    <RemoveDoneIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Box>
        )}

        {/* Batch actions for smaller lists */}
        {isAuthenticated && totalCount <= LOCATIONS_COLLAPSE_THRESHOLD && totalCount > 1 && (
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
            <Button size="small" variant="text" startIcon={<DoneAllIcon />} onClick={onMarkAll}>
              Mark all
            </Button>
            <Button size="small" variant="text" startIcon={<RemoveDoneIcon />} onClick={onUnmarkAll}>
              Unmark all
            </Button>
          </Box>
        )}

        {/* Virtualized location list */}
        <Box
          ref={scrollContainerRef}
          sx={{
            maxHeight: 350,
            overflowY: 'auto',
            bgcolor: 'background.paper',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {filteredLocations.length > 0 ? (
            <Box
              sx={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const loc = filteredLocations[virtualRow.index];
                return (
                  <PanelLocationRow
                    key={loc.id}
                    experienceId={experienceId}
                    loc={loc}
                    size={virtualRow.size}
                    start={virtualRow.start}
                    isAuthenticated={isAuthenticated}
                    onMarkLocation={onMarkLocation}
                    onUnmarkLocation={onUnmarkLocation}
                    onCorrect={onCorrect}
                  />
                );
              })}
            </Box>
          ) : (
            <EmptyState message="No locations match your filter" padding={2} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

interface PanelLocationRowProps {
  experienceId: number;
  loc: PanelLocation;
  size: number;
  start: number;
  isAuthenticated: boolean;
  onMarkLocation: (id: number) => void;
  onUnmarkLocation: (id: number) => void;
  onCorrect?: (location: PanelLocation) => void;
}

/**
 * One place in the panel's location list, subscribed to its own "is the map
 * pointing at me" boolean — a dot hover highlights this row and this row alone,
 * where the id as page state re-rendered the whole page per pointer move. Its
 * own hover writes the store, and the ring on the map is drawn from that by
 * `useDiscoverHover`'s subscription, which holds the coordinates. Only a hover
 * from the *map* highlights: the row's own pointer case is the `&:hover` CSS.
 */
function PanelLocationRow({
  experienceId,
  loc,
  size,
  start,
  isAuthenticated,
  onMarkLocation,
  onUnmarkLocation,
  onCorrect,
}: PanelLocationRowProps) {
  const { setHoveredFromList } = useHoverActions();
  const isHovered = useHoverSelector(
    s => s.hoverSource === 'marker' && s.hoveredLocationId === loc.id);
  const claim = claimLabel(loc.curatedFields);
  return (
    <Box
      onMouseEnter={() => setHoveredFromList(experienceId, loc.id)}
      onMouseLeave={() => setHoveredFromList(null, null)}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${size}px`,
        transform: `translateY(${start}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
        cursor: 'default',
        // The curator's action shows for the row under the pointer, holding
        // keyboard focus, or lit from the map — the same rule as Map mode's row.
        '& .place-fix': { opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s ease' },
        '&:hover .place-fix, &:focus-within .place-fix': { opacity: 1 },
        ...(isHovered && {
          bgcolor: 'action.selected',
          borderLeft: '3px solid',
          borderLeftColor: '#f97316',
        }),
      }}
    >
      <LocationOnIcon fontSize="small" color={loc.isVisited ? 'success' : 'action'} sx={{ flexShrink: 0 }} />
      <Typography
        variant="body2"
        noWrap
        sx={{
          flex: 1,
          textDecoration: loc.isVisited ? 'line-through' : 'none',
          color: loc.isVisited ? 'text.secondary' : 'text.primary',
        }}
      >
        {locationLabel(loc)}
      </Typography>
      {/* "pin corrected" beside the name where a curator has moved it: without the
          word, a pin somebody put there reads as the source's. */}
      {claim && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
          {claim}
        </Typography>
      )}
      {onCorrect && (
        <Tooltip title="Move or rename this place">
          {/* Named for the place, as the checkbox beside it is: a list of thirty bare
              pencils is a list a screen reader cannot use. */}
          <IconButton className="place-fix" size="small" aria-label={`Fix ${locationLabel(loc)}`} onClick={() => onCorrect(loc)}>
            <EditLocationAltIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {isAuthenticated && (
        <Checkbox
          checked={loc.isVisited}
          size="small"
          // Named, because a bare checkbox is announced as "checkbox, not checked"
          // and nothing else — neither which place it is nor what ticking it says.
          // A row of thirty of those is a list a screen reader cannot use at all.
          inputProps={{
            'aria-label': loc.isVisited
              ? `${locationLabel(loc)} — mark as not visited`
              : `${locationLabel(loc)} — mark as visited`,
          }}
          onChange={() => loc.isVisited ? onUnmarkLocation(loc.id) : onMarkLocation(loc.id)}
          sx={{ p: 0.5, '&.Mui-checked': { color: '#22c55e' } }}
        />
      )}
    </Box>
  );
}
