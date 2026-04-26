import { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Checkbox,
  IconButton,
  Button,
  Chip,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  MenuBook as WikiIcon,
  Language as WebsiteIcon,
  LocationOn as LocationIcon,
  Undo as UnrejectIcon,
  Tune as CurateIcon,
  LinkOff as RemoveFromRegionIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { useAuth } from '../../hooks/useAuth';
import {
  fetchExperience,
  fetchExperienceTreasures,
  type Experience,
  type ExperienceLocation,
  type VisitedStatus,
} from '../../api/experiences';
import { VISITED_GREEN } from '../../utils/categoryColors';
import { ArtworksList } from './ArtworksList';
import { VisitedStatusButton } from './VisitedStatusButton';
import {
  OUT_OF_REGION_INITIAL,
  computeVisitedStatus,
  resolveLocationColor,
} from './utils';

export interface ExperienceExpandedDetailsProps {
  experience: Experience;
  locations?: ExperienceLocation[];
  isLocationVisited: (locationId: number) => boolean;
  isFullyVisited: boolean;
  hoveredLocationId: number | null;
  locationRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  showCheckbox: boolean;
  onToggleAllLocations: (experienceId: number, markAsVisited: boolean) => void;
  onLocationVisitedToggle: (locationId: number, isVisited: boolean) => void;
  onLocationHover: (locationId: number | null) => void;
  onCurate?: () => void;
  onUnreject?: () => void;
  onRemoveFromRegion?: () => void;
  isRejected?: boolean;
}

export function ExperienceExpandedDetails({
  experience,
  locations,
  isLocationVisited,
  isFullyVisited,
  hoveredLocationId,
  locationRefs,
  showCheckbox,
  onToggleAllLocations,
  onLocationVisitedToggle,
  onLocationHover,
  onCurate,
  onUnreject,
  onRemoveFromRegion,
  isRejected,
}: ExperienceExpandedDetailsProps) {
  const { isAuthenticated } = useAuth();

  // Fetch full details
  const { data: details } = useQuery({
    queryKey: ['experience', experience.id],
    queryFn: () => fetchExperience(experience.id),
    staleTime: 300000,
  });

  // Fetch contents (artworks) - only if experience has contents
  const { data: contentsData } = useQuery({
    queryKey: ['experience-contents', experience.id],
    queryFn: () => fetchExperienceTreasures(experience.id),
    staleTime: 300000,
  });

  // Use batch locations from parent + global isLocationVisited
  const totalLocations = locations?.length ?? (experience.location_count ?? 0);

  // Build location display data with visited + in_region info from shared data
  const locationsWithRegionInfo = useMemo(() => {
    if (!locations || locations.length === 0) return [];
    return locations.map(loc => ({
      id: loc.id,
      name: loc.name,
      ordinal: loc.ordinal,
      longitude: loc.longitude,
      latitude: loc.latitude,
      isVisited: isLocationVisited(loc.id),
      inRegion: loc.in_region !== false,
      regionPath: loc.region_path ?? null,
    }));
  }, [locations, isLocationVisited]);

  // Split into in-region and out-of-region
  const inRegionLocs = useMemo(
    () => locationsWithRegionInfo.filter(l => l.inRegion),
    [locationsWithRegionInfo],
  );
  const outOfRegionLocs = useMemo(
    () => locationsWithRegionInfo.filter(l => !l.inRegion),
    [locationsWithRegionInfo],
  );
  const [outOfRegionExpanded, setOutOfRegionExpanded] = useState(false);

  // Compute display paths: strip common prefix segments shared by all out-of-region locations
  const outOfRegionDisplayPaths = useMemo(() => {
    const paths = outOfRegionLocs.map(l => l.regionPath);
    if (paths.length <= 1) {
      // Single location or none — show full path
      return new Map(outOfRegionLocs.map(l => [l.id, l.regionPath]));
    }
    // Split into segments and find common prefix length
    const segmented = paths.map(p => p?.split(' > ') ?? []);
    const firstSegs = segmented[0];
    let commonLen = 0;
    for (let i = 0; i < firstSegs.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- loop-counter index into string[] (path segments); same i used on both arrays
      if (segmented.every(s => s[i] === firstSegs[i])) {
        commonLen = i + 1;
      } else {
        break;
      }
    }
    return new Map(outOfRegionLocs.map((l, idx) => {
      // eslint-disable-next-line security/detect-object-injection -- idx is .map() callback index into same-length typed array
      const segs = segmented[idx];
      const trimmed = segs.slice(commonLen).join(' > ');
      return [l.id, trimmed || l.regionPath];
    }));
  }, [outOfRegionLocs]);

  // Count in-region locations
  const inRegionCount = inRegionLocs.length;
  const inRegionVisitedCount = inRegionLocs.filter(l => l.isVisited).length;

  // Compute visited status for multi-location badge
  const visitedLocations = locationsWithRegionInfo.filter(l => l.isVisited).length;
  const visitedStatus: VisitedStatus = computeVisitedStatus(visitedLocations, totalLocations);

  const imageUrl = extractImageUrl(experience.image_url);
  const isMultiLocation = totalLocations > 1;

  const categoryColorMap: Record<string, { bg: string; text: string }> = {
    cultural: { bg: '#EDE9FE', text: '#7C3AED' },
    natural: { bg: '#D1FAE5', text: '#059669' },
    mixed: { bg: '#FEF3C7', text: '#D97706' },
  };

  const categoryStyle = categoryColorMap[experience.category || ''] || { bg: '#E0E7FF', text: '#4F46E5' };

  return (
    <Box
      sx={{
        pl: 2,
        pr: 2,
        py: 1.5,
        bgcolor: 'grey.50',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Image */}
      {imageUrl && (
        <Box
          component="img"
          src={toThumbnailUrl(imageUrl, 330)}
          alt={experience.name}
          sx={{
            width: '100%',
            maxHeight: 250,
            objectFit: 'contain',
            borderRadius: 1,
            mb: 2,
            bgcolor: 'grey.100',
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}

      {/* Category & Country chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        {experience.category && (
          <Chip
            label={experience.category}
            size="small"
            sx={{
              bgcolor: categoryStyle.bg,
              color: categoryStyle.text,
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          />
        )}
        {experience.country_names?.[0] && (
          <Chip label={experience.country_names[0]} size="small" variant="outlined" />
        )}
        {experience.in_danger && (
          <Chip label="In Danger" size="small" color="error" />
        )}
        {isMultiLocation && (
          <Chip
            label={`${inRegionCount}/${totalLocations} in region`}
            size="small"
            icon={<LocationIcon fontSize="small" />}
            variant="outlined"
            color="info"
          />
        )}
      </Box>

      {/* Description */}
      {experience.short_description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {experience.short_description}
        </Typography>
      )}

      {/* Date inscribed */}
      {details?.metadata?.dateInscribed != null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Inscribed: {String(details.metadata.dateInscribed as string | number)}
        </Typography>
      )}

      {/* Museum description */}
      {details?.description && !experience.short_description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {details.description}
        </Typography>
      )}

      {/* Artworks / Contents list */}
      {contentsData && contentsData.treasures.length > 0 && (
        <ArtworksList contents={contentsData.treasures} total={contentsData.total} experienceId={experience.id} />
      )}

      {/* Multi-location list */}
      {isMultiLocation && locationsWithRegionInfo.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {isAuthenticated && showCheckbox && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              In this region: {inRegionVisitedCount}/{inRegionCount} visited
            </Typography>
          )}
          {!isAuthenticated && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              {inRegionCount} location{inRegionCount !== 1 ? 's' : ''} in this region
            </Typography>
          )}
          <List
            dense
            disablePadding
            sx={{ bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
            onMouseLeave={() => onLocationHover(null)}
          >
            {/* In-region locations (always shown) */}
            {inRegionLocs.map((loc) => {
              const isLocationHovered = hoveredLocationId === loc.id;
              return (
                <Box
                  key={loc.id}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) {
                      locationRefs.current.set(loc.id, el);
                    } else {
                      locationRefs.current.delete(loc.id);
                    }
                  }}
                >
                  <ListItem
                    dense
                    sx={{
                      py: 0.5,
                      bgcolor: isLocationHovered ? 'primary.100' : 'transparent',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={() => onLocationHover(loc.id)}
                    secondaryAction={
                      isAuthenticated && showCheckbox ? (
                        <Checkbox
                          edge="end"
                          checked={loc.isVisited}
                          size="small"
                          onChange={() => onLocationVisitedToggle(loc.id, loc.isVisited)}
                          sx={{
                            '&.Mui-checked': { color: VISITED_GREEN },
                          }}
                        />
                      ) : undefined
                    }
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <LocationIcon
                        fontSize="small"
                        color={isLocationHovered ? 'primary' : 'action'}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={loc.name || `Location ${loc.ordinal + 1}`}
                      primaryTypographyProps={{
                        variant: 'body2',
                        sx: {
                          textDecoration: loc.isVisited ? 'line-through' : 'none',
                          color: resolveLocationColor(isLocationHovered, loc.isVisited),
                          fontWeight: isLocationHovered ? 600 : 400,
                        },
                      }}
                    />
                  </ListItem>
                </Box>
              );
            })}

            {/* Out-of-region locations (collapsible) */}
            {outOfRegionLocs.length > 0 && (
              <>
                <Box sx={{ px: 1.5, py: 0.5, bgcolor: 'grey.100', borderTop: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    {outOfRegionLocs.length} outside region
                  </Typography>
                </Box>
                {(outOfRegionExpanded ? outOfRegionLocs : outOfRegionLocs.slice(0, OUT_OF_REGION_INITIAL)).map((loc) => (
                  <Box
                    key={loc.id}
                    ref={(el: HTMLDivElement | null) => {
                      if (el) {
                        locationRefs.current.set(loc.id, el);
                      } else {
                        locationRefs.current.delete(loc.id);
                      }
                    }}
                  >
                    <ListItem
                      dense
                      sx={{
                        py: 0.5,
                        opacity: 0.4,
                        bgcolor: 'grey.100',
                        cursor: 'default',
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <LocationIcon fontSize="small" color="disabled" />
                      </ListItemIcon>
                      <ListItemText
                        primary={loc.name || `Location ${loc.ordinal + 1}`}
                        secondary={outOfRegionDisplayPaths.get(loc.id) || 'Outside region'}
                        primaryTypographyProps={{
                          variant: 'body2',
                          sx: { color: 'text.disabled' },
                        }}
                        secondaryTypographyProps={{
                          variant: 'caption',
                          sx: { fontSize: '0.65rem' },
                        }}
                      />
                    </ListItem>
                  </Box>
                ))}
                {outOfRegionLocs.length > OUT_OF_REGION_INITIAL && (
                  <Box
                    sx={{
                      textAlign: 'center',
                      py: 0.5,
                      bgcolor: 'grey.100',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'grey.200' },
                    }}
                    onClick={() => setOutOfRegionExpanded(!outOfRegionExpanded)}
                  >
                    <Typography variant="caption" color="primary">
                      {outOfRegionExpanded
                        ? 'Show less'
                        : `Show ${outOfRegionLocs.length - OUT_OF_REGION_INITIAL} more`}
                    </Typography>
                  </Box>
                )}
              </>
            )}
          </List>
        </Box>
      )}

      {/* Rejection reason (when viewing rejected item) */}
      {isRejected && experience.rejection_reason && (
        <Alert severity="warning" sx={{ mb: 1.5, py: 0 }} variant="outlined">
          <Typography variant="caption">
            Rejected: {experience.rejection_reason}
          </Typography>
        </Alert>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {isAuthenticated && showCheckbox && !isMultiLocation && (
          <Button
            variant={isFullyVisited ? 'outlined' : 'contained'}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onToggleAllLocations(experience.id, !isFullyVisited);
            }}
            startIcon={isFullyVisited ? <CheckCircleIcon /> : null}
            color={isFullyVisited ? 'success' : 'primary'}
          >
            {isFullyVisited ? 'Visited' : 'Mark Visited'}
          </Button>
        )}
        {isAuthenticated && showCheckbox && isMultiLocation && (
          <VisitedStatusButton
            visitedStatus={visitedStatus}
            visitedCount={visitedLocations}
            totalCount={totalLocations}
          />
        )}
        {(() => {
          const metadata = details?.metadata;
          const wikiUrl = typeof metadata?.wikipediaUrl === 'string' && metadata.wikipediaUrl ? metadata.wikipediaUrl : null;
          const websiteUrl = typeof metadata?.website === 'string' && metadata.website ? metadata.website : null;

          return (
            <>
              {wikiUrl && (
                <IconButton size="small" component="a" href={wikiUrl} target="_blank" rel="noopener noreferrer" title="Wikipedia">
                  <WikiIcon fontSize="small" />
                </IconButton>
              )}
              {websiteUrl && websiteUrl !== wikiUrl && (
                <IconButton size="small" component="a" href={websiteUrl} target="_blank" rel="noopener noreferrer" title="Official website">
                  <WebsiteIcon fontSize="small" />
                </IconButton>
              )}
            </>
          );
        })()}

        {/* Curator actions */}
        {onCurate && !isRejected && (
          <Tooltip title="Edit, reject, or manage this experience">
            <Button
              size="small"
              variant="outlined"
              startIcon={<CurateIcon />}
              onClick={(e) => { e.stopPropagation(); onCurate(); }}
              sx={{ ml: 'auto' }}
            >
              Curate
            </Button>
          </Tooltip>
        )}
        {onUnreject && isRejected && (
          <Button
            size="small"
            variant="outlined"
            color="success"
            startIcon={<UnrejectIcon />}
            onClick={(e) => { e.stopPropagation(); onUnreject(); }}
            sx={{ ml: 'auto' }}
          >
            Unreject
          </Button>
        )}
        {onRemoveFromRegion && isRejected && (
          <Tooltip title="Remove from this region entirely">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); onRemoveFromRegion(); }}
            >
              <RemoveFromRegionIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onCurate && isRejected && (
          <Tooltip title="Edit or manage this experience">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onCurate(); }}
            >
              <CurateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}
