/**
 * ExperienceDetailPanel — Right-side slide-out showing full experience details.
 * Handles large location/content lists with collapse + search.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Box,
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

const categoryColors: Record<string, { bg: string; text: string }> = {
  cultural: { bg: '#EDE9FE', text: '#7C3AED' },
  natural: { bg: '#D1FAE5', text: '#059669' },
  mixed: { bg: '#FEF3C7', text: '#D97706' },
};

const LOCATIONS_COLLAPSE_THRESHOLD = 15;
const CONTENTS_COLLAPSE_THRESHOLD = 15;
const CONTENTS_INITIAL_SHOW = 20;

interface ExperienceDetailPanelProps {
  experience: Experience;
  onClose: () => void;
  /** Called when hovering a location in the location list */
  onHoverLocation?: (coords: { lng: number; lat: number } | null) => void;
  /** Location ID hovered on the map (for auto-scroll in location list) */
  hoveredLocationId?: number | null;
  /** Curator: opens curation dialog */
  onCurate?: () => void;
}

export function ExperienceDetailPanel({ experience, onClose, onHoverLocation, hoveredLocationId, onCurate }: ExperienceDetailPanelProps) {
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
  const catStyle = categoryColors[experience.category || ''] || { bg: '#E0E7FF', text: '#4F46E5' };

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
        {imageUrl && (
          <Box
            component="img"
            src={toThumbnailUrl(imageUrl, 960)}
            alt={experience.name}
            sx={{
              width: '100%',
              maxHeight: 300,
              objectFit: 'contain',
              borderRadius: 1.5,
              mb: 2,
              bgcolor: 'grey.100',
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
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
            <Chip label="In Danger" size="small" color="error" />
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
                label={visitedStatus === 'visited' ? 'Completed' : visitedStatus === 'partial' ? 'In Progress' : 'Not Started'}
                size="small"
                color={visitedStatus === 'visited' ? 'success' : visitedStatus === 'partial' ? 'warning' : 'default'}
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
            locations={displayLocations}
            totalCount={totalLocations}
            isAuthenticated={isAuthenticated}
            onMarkLocation={markLocationVisited}
            onUnmarkLocation={unmarkLocationVisited}
            onMarkAll={() => markAllLocations({ experienceId: experience.id })}
            onUnmarkAll={() => unmarkAllLocations({ experienceId: experience.id })}
            onHoverLocation={onHoverLocation}
            hoveredLocationId={hoveredLocationId}
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

interface LocationsSectionProps {
  locations: { id: number; name: string | null; ordinal: number; longitude: number; latitude: number; isVisited: boolean }[];
  totalCount: number;
  isAuthenticated: boolean;
  onMarkLocation: (id: number) => void;
  onUnmarkLocation: (id: number) => void;
  onMarkAll: () => void;
  onUnmarkAll: () => void;
  onHoverLocation?: (coords: { lng: number; lat: number } | null) => void;
  /** Location ID hovered on the map — triggers auto-scroll + highlight */
  hoveredLocationId?: number | null;
}

function LocationsSection({
  locations,
  totalCount,
  isAuthenticated,
  onMarkLocation,
  onUnmarkLocation,
  onMarkAll,
  onUnmarkAll,
  onHoverLocation,
  hoveredLocationId,
}: LocationsSectionProps) {
  const shouldCollapse = totalCount > LOCATIONS_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const [searchText, setSearchText] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll to hovered location (from map highlight dot hover)
  useEffect(() => {
    if (hoveredLocationId == null) return;
    const idx = filteredLocations.findIndex(l => l.id === hoveredLocationId);
    if (idx >= 0) {
      if (!expanded) setExpanded(true);
      virtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredLocationId]);

  return (
    <Box sx={{ mb: 2 }}>
      {/* Header */}
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', mb: 1 }}
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
      </Box>

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
                const isHovered = hoveredLocationId === loc.id;
                return (
                  <Box
                    key={loc.id}
                    onMouseEnter={() => onHoverLocation?.({ lng: loc.longitude, lat: loc.latitude })}
                    onMouseLeave={() => onHoverLocation?.(null)}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
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
                      {loc.name || `Location ${loc.ordinal + 1}`}
                    </Typography>
                    {isAuthenticated && (
                      <Checkbox
                        checked={loc.isVisited}
                        size="small"
                        onChange={() => loc.isVisited ? onUnmarkLocation(loc.id) : onMarkLocation(loc.id)}
                        sx={{ p: 0.5, '&.Mui-checked': { color: '#22c55e' } }}
                      />
                    )}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No locations match your filter
              </Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

// =============================================================================
// Contents / Artworks Section (collapsible, paginated, grid layout)
// =============================================================================

interface ContentsSectionProps {
  contents: { id: number; name: string; treasure_type: string; artist: string | null; year: number | null; image_url: string | null; sitelinks_count: number }[];
  totalCount: number;
  isAuthenticated: boolean;
  viewedIds: Set<number>;
  onMarkViewed: (id: number) => void;
  onUnmarkViewed: (id: number) => void;
}

function ContentsSection({
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
      {/* Header */}
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', mb: 1 }}
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
      </Box>

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
          {displayContents.map((content) => {
            const isViewed = viewedIds.has(content.id);
            const thumbUrl = content.image_url ? toThumbnailUrl(content.image_url, 120) : null;

            return (
              <Box
                key={content.id}
                sx={{
                  position: 'relative',
                  borderRadius: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  opacity: isViewed ? 0.5 : 1,
                  transition: 'opacity 0.2s',
                  '&:hover': { opacity: 1 },
                }}
                onClick={() => isViewed ? onUnmarkViewed(content.id) : onMarkViewed(content.id)}
              >
                {thumbUrl ? (
                  <Box
                    component="img"
                    src={thumbUrl}
                    alt={content.name}
                    loading="lazy"
                    sx={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: '100%',
                      aspectRatio: '1',
                      bgcolor: 'grey.100',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem', textAlign: 'center', px: 0.5 }}>
                      {content.name}
                    </Typography>
                  </Box>
                )}
                {isAuthenticated && isViewed && (
                  <CheckCircleIcon
                    sx={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      fontSize: 16,
                      color: '#22c55e',
                      bgcolor: 'white',
                      borderRadius: '50%',
                    }}
                  />
                )}
                <Tooltip title={`${content.name}${content.artist ? ` - ${content.artist}` : ''}${content.year ? ` (${content.year})` : ''}`}>
                  <Box
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      bgcolor: 'rgba(0,0,0,0.6)',
                      px: 0.5,
                      py: 0.25,
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'white', fontSize: '0.55rem', lineHeight: 1.2 }} noWrap>
                      {content.name}
                    </Typography>
                  </Box>
                </Tooltip>
              </Box>
            );
          })}
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
