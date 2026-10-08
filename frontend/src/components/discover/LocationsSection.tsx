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
  Chip,
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
import { locationLabel, pointFullName, pointOfRow } from '../../utils/locationLabel';
import { CopyNameButton } from '../shared/CopyNameButton';
import { claimLabel } from '../../utils/placeClaims';
import { foldLabel } from '@tyr/shared/labels';
import { filterParts, groupParts } from '../../utils/partGroups';
import type { LocationWithVisitedStatus } from '../../api/visited';

const LOCATIONS_COLLAPSE_THRESHOLD = 15;

/** The group of the parts in the region the list is about, which opens first (#1271). */
const IN_REGION_GROUP = 'In this region';

/** One row of the windowed list: a group's header, or a place. */
type ListRow =
  | { kind: 'group'; label: string; count: number; withPicture: number; open: boolean }
  | { kind: 'place'; loc: PanelLocation };

/**
 * One place the object has, as a row in the section's location list: the visit
 * read's place, and the fields a curator has claimed on it, so the row can say
 * it is corrected.
 */
export type PanelLocation = Pick<
  LocationWithVisitedStatus, 'id' | 'name' | 'ordinal' | 'longitude' | 'latitude' | 'isVisited'
> & {
  curatedFields?: string[];
  externalRef?: string | null;
  /** Where the part lies, `Europe > Switzerland > Aargau`, for the groups of a long list (#1271). */
  regionPath?: string | null;
  /** Whether it lies in the region the list is about; the parts there come first. */
  inRegion?: boolean;
  /** It has a picture of its own, which the "with a photo" filter keeps. */
  hasPicture?: boolean;
};

interface LocationsSectionProps {
  /** Whose places these are — a row hover names the object and the place. */
  experienceId: number;
  /** The object's name, which each place's copied full name begins with (#1268). */
  objectName: string;
  locations: PanelLocation[];
  totalCount: number;
  isAuthenticated: boolean;
  onMarkLocation: (id: number) => void;
  onUnmarkLocation: (id: number) => void;
  onMarkAll: () => void;
  onUnmarkAll: () => void;
  /** A curator's way into correcting a place, handed to every row unchanged. */
  onCorrect?: (location: PanelLocation) => void;
  /** Open a place on a card of its own (#1271), handed to every row unchanged. */
  onOpen?: (pointId: number, pointName: string) => void;
}

/**
 * Exported for its test, like `ContentsSection`: what it promises is a property
 * of the *closed* state — that a keyboard can open it — and no caller of the
 * panel can drive that.
 */
export function LocationsSection({
  experienceId,
  objectName,
  locations,
  totalCount,
  isAuthenticated,
  onMarkLocation,
  onUnmarkLocation,
  onMarkAll,
  onUnmarkAll,
  onCorrect,
  onOpen,
}: LocationsSectionProps) {
  const shouldCollapse = totalCount > LOCATIONS_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const [searchText, setSearchText] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { store } = useHoverActions();

  const visitedCount = locations.filter((l) => l.isVisited).length;

  const [photoOnly, setPhotoOnly] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set([IN_REGION_GROUP]));
  const withPhotoCount = useMemo(() => locations.filter(l => l.hasPicture).length, [locations]);

  // Both sides folded, as the works filter is (#835): a search finds what the
  // screen shows whatever the row holds, and a dash typed as a hyphen. What the
  // row reads, so a part named by its reference is found by it.
  const filteredLocations = useMemo(
    () => filterParts(locations, searchText, photoOnly, foldLabel, l => locationLabel(pointOfRow(l))),
    [locations, searchText, photoOnly],
  );

  // A long list in groups (#1271): the parts in the region first, open, then
  // the rest by the first level of their region path at which they part ways —
  // the countries of the pile dwellings, the communities of the rock art. A
  // search or the photo filter opens every group, since what it left is what the
  // reader asked for.
  const { rows, groupOf } = useMemo(() => {
    const flat = (locs: PanelLocation[]) => ({
      rows: locs.map((loc): ListRow => ({ kind: 'place', loc })), groupOf: new Map<number, string>(),
    });
    if (totalCount <= LOCATIONS_COLLAPSE_THRESHOLD) return flat(filteredLocations);
    const inRegion = filteredLocations.filter(l => l.inRegion !== false);
    const groups = [
      ...(inRegion.length > 0
        ? [{ label: IN_REGION_GROUP, parts: inRegion, withPicture: inRegion.filter(l => l.hasPicture).length }]
        : []),
      ...groupParts(filteredLocations.filter(l => l.inRegion === false).map(l => ({ ...l, regionPath: l.regionPath ?? null }))),
    ];
    if (groups.length <= 1) return flat(filteredLocations);
    const filtering = searchText.trim() !== '' || photoOnly;
    const of = new Map<number, string>();
    const listed = groups.flatMap((group): ListRow[] => {
      group.parts.forEach(loc => of.set(loc.id, group.label));
      const open = filtering || openGroups.has(group.label);
      return [
        { kind: 'group', label: group.label, count: group.parts.length, withPicture: group.withPicture, open },
        ...(open ? group.parts.map((loc): ListRow => ({ kind: 'place', loc })) : []),
      ];
    });
    return { rows: listed, groupOf: of };
  }, [filteredLocations, totalCount, searchText, photoOnly, openGroups]);

  const toggleGroup = (label: string) => setOpenGroups(current => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 40,
    overscan: 5,
  });

  // Auto-scroll to hovered location (from map highlight dot hover) — from a
  // subscription, so a pointer crossing the dots does not re-render this
  // section per move, which the hover arriving as page state would (#573).
  // Only a hover from the map: a row hover can only have come from a row
  // already on the page. Through refs, because the subscription is registered
  // once and a hover is not the moment to re-register it because the rows or
  // the fold changed.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const groupOfRef = useRef(groupOf);
  groupOfRef.current = groupOf;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => subscribeToHoverTarget(store, ({ hoveredLocationId, hoverSource }) => {
    if (hoverSource !== 'marker' || hoveredLocationId == null) return;
    const idx = rowsRef.current.findIndex(row => row.kind === 'place' && row.loc.id === hoveredLocationId);
    // A dot whose part sits in a closed group opens the group; the next hover
    // finds its row.
    const closedIn = idx < 0 ? groupOfRef.current.get(hoveredLocationId) : undefined;
    if (closedIn) setOpenGroups(current => new Set(current).add(closedIn));
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
              placeholder="Find a place"
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
            {withPhotoCount > 0 && (
              <Chip
                size="small"
                label={`With a photo · ${withPhotoCount}`}
                color={photoOnly ? 'primary' : 'default'}
                variant={photoOnly ? 'filled' : 'outlined'}
                onClick={() => setPhotoOnly(!photoOnly)}
                aria-pressed={photoOnly}
              />
            )}
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
          {rows.length > 0 ? (
            <Box
              sx={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (row.kind === 'group') {
                  return (
                    <GroupHeaderRow
                      key={`group:${row.label}`}
                      row={row}
                      size={virtualRow.size}
                      start={virtualRow.start}
                      onToggle={toggleGroup}
                    />
                  );
                }
                const loc = row.loc;
                return (
                  <PanelLocationRow
                    key={loc.id}
                    experienceId={experienceId}
                    objectName={objectName}
                    loc={loc}
                    size={virtualRow.size}
                    start={virtualRow.start}
                    isAuthenticated={isAuthenticated}
                    onMarkLocation={onMarkLocation}
                    onUnmarkLocation={onUnmarkLocation}
                    onCorrect={onCorrect}
                    onOpen={onOpen}
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

/** A group's header in the windowed list: its name, how many parts and how many with a photo, and its fold. */
function GroupHeaderRow({ row, size, start, onToggle }: {
  row: Extract<ListRow, { kind: 'group' }>;
  size: number;
  start: number;
  onToggle: (label: string) => void;
}) {
  return (
    <ButtonBase
      aria-expanded={row.open}
      onClick={() => onToggle(row.label)}
      sx={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: `${size}px`,
        transform: `translateY(${start}px)`, display: 'flex', alignItems: 'center', gap: 0.5, px: 1,
        justifyContent: 'flex-start', bgcolor: 'grey.100', borderBottom: '1px solid', borderColor: 'divider',
      }}
    >
      {row.open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, textAlign: 'left' }} noWrap>{row.label}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {row.count}{row.withPicture > 0 ? ` · ${row.withPicture} with a photo` : ''}
      </Typography>
    </ButtonBase>
  );
}

interface PanelLocationRowProps {
  experienceId: number;
  objectName: string;
  loc: PanelLocation;
  size: number;
  start: number;
  isAuthenticated: boolean;
  onMarkLocation: (id: number) => void;
  onUnmarkLocation: (id: number) => void;
  onCorrect?: (location: PanelLocation) => void;
  onOpen?: (pointId: number, pointName: string) => void;
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
  objectName,
  loc,
  size,
  start,
  isAuthenticated,
  onMarkLocation,
  onUnmarkLocation,
  onCorrect,
  onOpen,
}: PanelLocationRowProps) {
  const { setHoveredFromList } = useHoverActions();
  const isHovered = useHoverSelector(
    s => s.hoverSource === 'marker' && s.hoveredLocationId === loc.id);
  const claim = claimLabel(loc.curatedFields);
  const point = pointOfRow(loc);
  const label = locationLabel(point);
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
        '& .place-fix, & .place-copy': { opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s ease' },
        '&:hover .place-fix, &:focus-within .place-fix, &:hover .place-copy, &:focus-within .place-copy': { opacity: 1 },
        ...(isHovered && {
          bgcolor: 'action.selected',
          borderLeft: '3px solid',
          borderLeftColor: '#f97316',
        }),
      }}
    >
      <LocationOnIcon fontSize="small" color={loc.isVisited ? 'success' : 'action'} sx={{ flexShrink: 0 }} />
      {/* The name opens the place's own card (#1271), and nothing else on the row
          does: the copy, the correction and the visited box answer for themselves. */}
      <Typography
        variant="body2"
        noWrap
        {...(onOpen ? {
          role: 'button',
          tabIndex: 0,
          onClick: () => onOpen(loc.id, label),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen(loc.id, label);
            }
          },
        } : {})}
        sx={{
          flex: 1,
          textDecoration: loc.isVisited ? 'line-through' : 'none',
          color: loc.isVisited ? 'text.secondary' : 'text.primary',
          cursor: onOpen ? 'pointer' : 'default',
          '&:hover': onOpen ? { textDecoration: 'underline' } : undefined,
        }}
      >
        {label}
      </Typography>
      {/* "pin corrected" beside the name where a curator has moved it: without the
          word, a pin somebody put there reads as the source's. */}
      {claim && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
          {claim}
        </Typography>
      )}
      <CopyNameButton fullName={pointFullName(objectName, point)} className="place-copy" />
      {onCorrect && (
        <Tooltip title="Move or rename this place">
          {/* Named for the place, as the checkbox beside it is: a list of thirty bare
              pencils is a list a screen reader cannot use. */}
          <IconButton className="place-fix" size="small" aria-label={`Fix ${label}`} onClick={() => onCorrect(loc)}>
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
              ? `${label} — mark as not visited`
              : `${label} — mark as visited`,
          }}
          onChange={() => loc.isVisited ? onUnmarkLocation(loc.id) : onMarkLocation(loc.id)}
          sx={{ p: 0.5, '&.Mui-checked': { color: '#22c55e' } }}
        />
      )}
    </Box>
  );
}
