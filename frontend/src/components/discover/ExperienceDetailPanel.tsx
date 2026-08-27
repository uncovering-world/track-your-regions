/**
 * ExperienceDetailPanel — Right-side slide-out showing full experience details.
 * Handles large location/content lists with collapse + search.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Box,
  ButtonBase,
  Typography,
  IconButton,
  Chip,
  Button,
  Divider,
  Checkbox,
  Collapse,
  TextField,
  InputAdornment,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import LanguageIcon from '@mui/icons-material/Language';
import TuneIcon from '@mui/icons-material/Tune';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SearchIcon from '@mui/icons-material/Search';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import RemoveDoneIcon from '@mui/icons-material/RemoveDone';
import { useQuery } from '@tanstack/react-query';
import {
  fetchExperience,
  fetchExperienceLocations,
  fetchExperienceTreasures,
  type Experience,
  type ExperienceTreasure,
} from '../../api/experiences';
import { useAuth } from '../../hooks/useAuth';
import {
  useVisitedExperiences,
  useVisitedLocations,
  useExperienceVisitedStatus,
  useViewedTreasures,
} from '../../hooks/useVisitedExperiences';
import { useVirtualizer } from '@tanstack/react-virtual';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { subscribeToHoverTarget, useHoverActions, useHoverSelector } from '../../hooks/useHoverContext';

import { CATEGORY_COLORS } from '../../utils/categoryColors';
import { EmptyState } from '../shared/EmptyState';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { ContentTile } from './ContentTile';
import { locationLabel } from '../../utils/locationLabel';
import { inDangerLabel } from '../../utils/dangerLabel';

const LOCATIONS_COLLAPSE_THRESHOLD = 15;
const CONTENTS_COLLAPSE_THRESHOLD = 15;
const CONTENTS_INITIAL_SHOW = 20;

interface ExperienceDetailPanelProps {
  experience: Experience;
  onClose: () => void;
  /** Curator: opens curation dialog */
  onCurate?: () => void;
}

export function ExperienceDetailPanel({ experience, onClose, onCurate }: ExperienceDetailPanelProps) {
  const { isAuthenticated } = useAuth();

  // Fetch full details
  const { data: details } = useQuery({
    queryKey: ['experience', experience.id],
    queryFn: () => fetchExperience(experience.id),
    staleTime: 300000,
  });

  // Fetch locations
  const { data: locationsData } = useQuery({
    queryKey: ['experience-locations', experience.id],
    queryFn: () => fetchExperienceLocations(experience.id),
    staleTime: 300000,
  });

  // Fetch contents
  const { data: contentsData } = useQuery({
    queryKey: ['experience-contents', experience.id],
    queryFn: () => fetchExperienceTreasures(experience.id),
    staleTime: 300000,
  });

  // Visited state
  const { visitedIds, markVisited, unmarkVisited } = useVisitedExperiences();
  const {
    markLocationVisited,
    unmarkLocationVisited,
    markAllLocations,
    unmarkAllLocations,
  } = useVisitedLocations();
  const {
    visitedStatus,
    totalLocations: visitedTotalLocations,
    visitedLocations: visitedLocationCount,
    locations: locationsWithVisitedStatus,
  } = useExperienceVisitedStatus(experience.id);
  const { viewedIds, markViewed, unmarkViewed } = useViewedTreasures(experience.id);

  const imageUrl = extractImageUrl(experience.image_url);
  // Keyed by the URL, so opening the next object does not inherit the last
  // one's failure — the panel is reused rather than remounted.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageFailed = !!imageUrl && failedUrl === imageUrl;
  const setImageFailed = () => setFailedUrl(imageUrl);
  const colors = CATEGORY_COLORS[experience.category || ''];
  const catStyle = colors ? { bg: colors.bg, text: colors.text } : { bg: '#E0E7FF', text: '#4F46E5' };

  let visitedStatusLabel = 'Not Started';
  if (visitedStatus === 'visited') visitedStatusLabel = 'Completed';
  else if (visitedStatus === 'partial') visitedStatusLabel = 'In Progress';

  let visitedStatusColor: 'success' | 'warning' | 'default' = 'default';
  if (visitedStatus === 'visited') visitedStatusColor = 'success';
  else if (visitedStatus === 'partial') visitedStatusColor = 'warning';

  const totalLocations = locationsData?.totalLocations || 0;
  const isMultiLocation = totalLocations > 1;

  // Build location list: use public locations as base, overlay visited status when authenticated
  const displayLocations = useMemo(() => {
    const publicLocs = locationsData?.locations || [];
    if (locationsWithVisitedStatus.length > 0) {
      // Auth data available — use it (has isVisited field)
      return locationsWithVisitedStatus;
    }
    // Not authenticated or auth data not yet loaded — map public locations
    return publicLocs.map(loc => ({
      id: loc.id,
      name: loc.name,
      ordinal: loc.ordinal,
      longitude: loc.longitude,
      latitude: loc.latitude,
      isVisited: false,
    }));
  }, [locationsData?.locations, locationsWithVisitedStatus]);

  // Regions from detail
  const regions = details?.regions || [];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }} noWrap>
          {experience.name}
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Scrollable content */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        {/* Image */}
        {imageUrl && !imageFailed && (
          <Box sx={{ mb: 2 }}>
            <Box
              component="img"
              src={toThumbnailUrl(imageUrl, 960)}
              alt={experience.name}
              sx={{
                width: '100%',
                maxHeight: 300,
                objectFit: 'contain',
                borderRadius: 1.5,
                bgcolor: 'grey.100',
              }}
              // State rather than hiding the element, because the credit has to
              // go with it: a line naming a photographer under a picture the
              // reader cannot see credits nothing and explains less.
              onError={setImageFailed}
            />
            {/* Under the picture rather than over it: the credit belongs to the
                photograph, and this is the largest the catalogue ever shows one. */}
            <ImageCreditLine credit={experience.image_credit} />
          </Box>
        )}

        {/* Category + country chips */}
        <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
          {experience.category && (
            <Chip
              label={experience.category}
              size="small"
              sx={{ bgcolor: catStyle.bg, color: catStyle.text, fontWeight: 600, textTransform: 'capitalize' }}
            />
          )}
          {experience.country_names?.map((name, i) => (
            <Chip key={i} label={name} size="small" variant="outlined" />
          ))}
          {experience.in_danger && (
            <Chip label={inDangerLabel(experience.danger_since)} size="small" color="error" />
          )}
        </Box>

        {/* Visited summary for multi-location */}
        {isAuthenticated && isMultiLocation && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {visitedLocationCount}/{visitedTotalLocations} locations visited
              </Typography>
              <Chip
                label={visitedStatusLabel}
                size="small"
                color={visitedStatusColor}
                sx={{ height: 22, fontSize: '0.65rem' }}
              />
            </Box>
            <LinearProgress
              variant="determinate"
              value={visitedTotalLocations > 0 ? (visitedLocationCount / visitedTotalLocations) * 100 : 0}
              sx={{
                height: 4,
                borderRadius: 2,
                bgcolor: 'grey.200',
                '& .MuiLinearProgress-bar': {
                  bgcolor: visitedStatus === 'visited' ? 'success.main' : 'warning.main',
                },
              }}
            />
          </Box>
        )}

        {/* Description */}
        {(experience.short_description || details?.description) && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {experience.short_description || details?.description}
          </Typography>
        )}

        {/* Date inscribed */}
        {details?.metadata?.dateInscribed != null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Inscribed: {String(details.metadata.dateInscribed as string | number)}
          </Typography>
        )}

        {/* Regions */}
        {regions.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>
              Regions
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {regions.map((r) => (
                <Chip key={r.id} label={r.name} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
              ))}
            </Box>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Locations section */}
        {isMultiLocation && (
          <LocationsSection
            experienceId={experience.id}
            locations={displayLocations}
            totalCount={totalLocations}
            isAuthenticated={isAuthenticated}
            onMarkLocation={markLocationVisited}
            onUnmarkLocation={unmarkLocationVisited}
            onMarkAll={() => markAllLocations({ experienceId: experience.id })}
            onUnmarkAll={() => unmarkAllLocations({ experienceId: experience.id })}
          />
        )}

        {/* Single-location visited button */}
        {isAuthenticated && !isMultiLocation && (
          <Box sx={{ mb: 2 }}>
            <Button
              variant={visitedIds.has(experience.id) ? 'outlined' : 'contained'}
              size="small"
              onClick={() => visitedIds.has(experience.id) ? unmarkVisited(experience.id) : markVisited(experience.id)}
              startIcon={visitedIds.has(experience.id) ? <CheckCircleIcon /> : undefined}
              color={visitedIds.has(experience.id) ? 'success' : 'primary'}
            >
              {visitedIds.has(experience.id) ? 'Visited' : 'Mark Visited'}
            </Button>
          </Box>
        )}

        {/* Contents / Artworks section */}
        {contentsData && contentsData.treasures.length > 0 && (
          <ContentsSection
            contents={contentsData.treasures}
            totalCount={contentsData.total}
            isAuthenticated={isAuthenticated}
            viewedIds={viewedIds}
            onMarkViewed={(id) => markViewed({ treasureId: id, experienceId: experience.id })}
            onUnmarkViewed={unmarkViewed}
          />
        )}

        <Divider sx={{ my: 2 }} />

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {onCurate && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<TuneIcon />}
              onClick={onCurate}
            >
              Curate
            </Button>
          )}
          {(() => {
            const metadata = details?.metadata;
            const wikiUrl = typeof metadata?.wikipediaUrl === 'string' && metadata.wikipediaUrl ? metadata.wikipediaUrl : null;
            const websiteUrl = typeof metadata?.website === 'string' && metadata.website ? metadata.website : null;

            return (
              <>
                {wikiUrl && (
                  <Button variant="text" size="small" startIcon={<MenuBookIcon />} component="a" href={wikiUrl} target="_blank" rel="noopener noreferrer">
                    Wikipedia
                  </Button>
                )}
                {websiteUrl && websiteUrl !== wikiUrl && (
                  <Button variant="text" size="small" startIcon={<LanguageIcon />} component="a" href={websiteUrl} target="_blank" rel="noopener noreferrer">
                    Website
                  </Button>
                )}
              </>
            );
          })()}
        </Box>
      </Box>
    </Box>
  );
}

// =============================================================================
// Locations Section (collapsible, searchable for large lists)
// =============================================================================

/** One place the object has, as a row in the section's location list. */
interface PanelLocation {
  id: number;
  name: string | null;
  ordinal: number | null;
  longitude: number;
  latitude: number;
  isVisited: boolean;
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
}: PanelLocationRowProps) {
  const { setHoveredFromList } = useHoverActions();
  const isHovered = useHoverSelector(
    s => s.hoverSource === 'marker' && s.hoveredLocationId === loc.id);
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

// =============================================================================
// Contents / Artworks Section (collapsible, paginated, grid layout)
// =============================================================================

interface ContentsSectionProps {
  contents: ExperienceTreasure[];
  totalCount: number;
  isAuthenticated: boolean;
  viewedIds: Set<number>;
  onMarkViewed: (id: number) => void;
  onUnmarkViewed: (id: number) => void;
}

/**
 * Exported for its test: what this section promises is that a museum's works can
 * be reached at all, and that is a property of the *closed* state, which no
 * caller of the panel can drive.
 */
export function ContentsSection({
  contents,
  totalCount,
  isAuthenticated,
  viewedIds,
  onMarkViewed,
  onUnmarkViewed,
}: ContentsSectionProps) {
  const shouldCollapse = totalCount > CONTENTS_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const [showAll, setShowAll] = useState(false);
  const [searchText, setSearchText] = useState('');

  const viewedCount = contents.filter((c) => viewedIds.has(c.id)).length;
  const displayContents = useMemo(() => {
    let filtered = contents;
    if (searchText) {
      const lower = searchText.toLowerCase();
      filtered = filtered.filter((c) =>
        c.name.toLowerCase().includes(lower) ||
        (c.artist || '').toLowerCase().includes(lower),
      );
    }
    if (!showAll && !searchText) {
      filtered = filtered.slice(0, CONTENTS_INITIAL_SHOW);
    }
    return filtered;
  }, [contents, showAll, searchText]);

  return (
    <Box sx={{ mb: 2 }}>
      {/* The header is the only way into this section, and the section is shut by
          default for anything past `CONTENTS_COLLAPSE_THRESHOLD` — which is most
          museums. As a `<div onClick>` it was not a tab stop, so the works grid
          inside could be operated by keyboard in principle and reached by nobody:
          `Collapse` hides its contents outright while shut, so there was no way in
          at all. A real control, then, carrying `aria-expanded` so a reader is told
          whether the thing they are about to open is open. */}
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
        <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
          Notable Works ({totalCount})
        </Typography>
        {isAuthenticated && viewedCount > 0 && (
          <Typography variant="caption" color={viewedCount === totalCount ? 'success.main' : 'text.secondary'}>
            {viewedCount} seen
          </Typography>
        )}
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ButtonBase>

      <Collapse in={expanded} timeout="auto">
        {/* Search for large lists */}
        {totalCount > CONTENTS_COLLAPSE_THRESHOLD && (
          <TextField
            size="small"
            placeholder="Filter works..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            fullWidth
            sx={{ mb: 1 }}
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
        )}

        {/* Artwork grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 1,
            maxHeight: 400,
            overflowY: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 1,
            bgcolor: 'background.paper',
          }}
        >
          {displayContents.map((content) => (
            <ContentTile
              key={content.id}
              content={content}
              isViewed={viewedIds.has(content.id)}
              isAuthenticated={isAuthenticated}
              onToggleViewed={() => (viewedIds.has(content.id)
                ? onUnmarkViewed(content.id)
                : onMarkViewed(content.id))}
            />
          ))}
        </Box>

        {/* Show more button */}
        {!showAll && !searchText && totalCount > CONTENTS_INITIAL_SHOW && (
          <Button size="small" variant="text" onClick={() => setShowAll(true)} sx={{ mt: 0.5 }}>
            Show all {totalCount} works
          </Button>
        )}
      </Collapse>
    </Box>
  );
}
