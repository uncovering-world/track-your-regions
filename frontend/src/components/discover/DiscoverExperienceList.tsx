/**
 * Discover's experience list: the header, the name filter and the rows.
 *
 * Split out of `DiscoverExperienceView` under the 800-line rule in
 * `docs/tech/development-guide.md` (#562). It is presentational — every piece of
 * state it reads and every handler it calls belongs to the view, which owns the
 * map beside it and the hover that ties the two together. Kept in one component
 * rather than split further because the header, the filter and the rows are one
 * thing to a reader: the list of what is here.
 */

import {
  Box, Typography, IconButton, TextField, InputAdornment, Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import type { Experience } from '../../api/experiences';
import type { ActiveView } from '../../hooks/useDiscoverExperiences';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { EmptyState } from '../shared/EmptyState';
import { ExperienceCard } from './ExperienceCard';

interface DiscoverExperienceListProps {
  activeView: ActiveView;
  experiences: Experience[];
  filteredExperiences: Experience[];
  isLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  shortSourceName: string | null;
  rejectedCount: number;
  hasCuratorScope: boolean;
  isAuthenticated: boolean;
  visitedIds: Set<number>;
  hoveredExperienceId: number | null;
  selectedExperienceId: number | null;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  cardRefsMap: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onBack: () => void;
  onSelectExperience: (id: number) => void;
  onCardMouseEnter: (id: number) => void;
  onCardMouseLeave: () => void;
  onVisitedToggle: (experienceId: number, visited: boolean, e: React.MouseEvent) => void;
  onCurate: (experience: Experience) => void;
  onAdd: () => void;
}

export function DiscoverExperienceList({
  activeView,
  experiences,
  filteredExperiences,
  isLoading,
  search,
  setSearch,
  shortSourceName,
  rejectedCount,
  hasCuratorScope,
  isAuthenticated,
  visitedIds,
  hoveredExperienceId,
  selectedExperienceId,
  listContainerRef,
  cardRefsMap,
  onBack,
  onSelectExperience,
  onCardMouseEnter,
  onCardMouseLeave,
  onVisitedToggle,
  onCurate,
  onAdd,
}: DiscoverExperienceListProps) {
  return (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderTop: '1px solid', borderColor: 'divider', minHeight: 0 }}>
          {/* List header with back button */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <IconButton size="small" onClick={onBack} aria-label="Back to the region list">
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                {shortSourceName} in {activeView.regionName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {(() => {
                  if (isLoading) return 'Loading...';
                  const ofTotal = search ? ` of ${experiences.length}` : '';
                  return `${filteredExperiences.length}${ofTotal} experiences`;
                })()}
                {hasCuratorScope && rejectedCount > 0 && (
                  <Typography component="span" variant="caption" color="error.main">
                    {' '}({rejectedCount} rejected)
                  </Typography>
                )}
              </Typography>
            </Box>
            {hasCuratorScope && activeView.regionId && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlaylistAddIcon />}
                onClick={onAdd}
                sx={{ flexShrink: 0, mr: 0.5 }}
              >
                Add
              </Button>
            )}
          </Box>

          {/* Search (only for 15+ experiences) */}
          {experiences.length > 15 && (
            <Box sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
              <TextField
                size="small"
                placeholder="Filter by name or country..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                fullWidth
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearch('')} aria-label="Clear the name filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />
            </Box>
          )}

          {/* Scrollable experience list */}
          <Box ref={listContainerRef} sx={{ flex: 1, overflowY: 'auto' }}>
            {isLoading && <LoadingSpinner size={24} padding="16px 0" />}
            {!isLoading && filteredExperiences.length === 0 && (
              <EmptyState message={search ? 'No experiences match your filter.' : 'No experiences found.'} />
            )}
            {!isLoading && filteredExperiences.length > 0 && filteredExperiences.map((exp) => (
              <ExperienceCard
                key={exp.id}
                ref={(el) => {
                  if (el) cardRefsMap.current.set(exp.id, el);
                  else cardRefsMap.current.delete(exp.id);
                }}
                experience={exp}
                isVisited={visitedIds.has(exp.id)}
                isHovered={hoveredExperienceId === exp.id}
                isSelected={selectedExperienceId === exp.id}
                onClick={() => onSelectExperience(exp.id)}
                onMouseEnter={() => onCardMouseEnter(exp.id)}
                onMouseLeave={onCardMouseLeave}
                onVisitedToggle={(e) => onVisitedToggle(exp.id, visitedIds.has(exp.id), e)}
                showCheckbox={isAuthenticated}
                onCurate={hasCuratorScope ? () => onCurate(exp) : undefined}
              />
            ))}
          </Box>
        </Box>
  );
}
