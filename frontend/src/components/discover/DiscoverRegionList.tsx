/**
 * DiscoverRegionList — Virtualized list of regions with text-based source count tags.
 * Each row: region name + readable source pills like "UNESCO 42 · Museums 15".
 * Click region name → navigate deeper. Click source pill → view experiences.
 *
 * Uses text labels (not icons) to scale to dozens of experience categories.
 */

import { useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Tooltip,
  IconButton,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import PlaceIcon from '@mui/icons-material/Place';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RegionExperienceCount, ExperienceCategory } from '../../api/experiences';
import { getSourceColor, shortSourceName } from '../../utils/categoryColors';

interface DiscoverRegionListProps {
  regions: RegionExperienceCount[];
  categories: ExperienceCategory[];
  isLoading: boolean;
  onNavigate: (regionId: number, regionName: string) => void;
  onCategoryClick: (regionId: number, regionName: string, categoryId: number, categoryName: string) => void;
  /** Called when curator clicks "+" to add experience of any category to a region.
   *  Only called for regions where canAddToRegion returns true (if provided). */
  onAddExperience?: (regionId: number, regionName: string) => void;
  /** Predicate to check if the curator can add to a specific region. If not provided, all regions are allowed. */
  canAddToRegion?: (regionId: number) => boolean;
}

export function DiscoverRegionList({
  regions,
  categories,
  isLoading,
  onNavigate,
  onCategoryClick,
  onAddExperience,
  canAddToRegion,
}: DiscoverRegionListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Build a lookup: categoryId → category object
  const categoryById = useMemo(() => {
    const map = new Map<number, ExperienceCategory>();
    for (const s of categories) map.set(s.id, s);
    return map;
  }, [categories]);

  const virtualizer = useVirtualizer({
    count: regions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (regions.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No regions with experiences at this level.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      ref={parentRef}
      sx={{ flex: 1, overflowY: 'auto' }}
    >
      <Box
        sx={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const region = regions[virtualRow.index];
          const hasChildren = region.has_subregions;

          // Sorted source entries (by display_priority)
          const sortedSourceEntries = Object.entries(region.category_counts)
            .map(([sid, count]) => ({ categoryId: Number(sid), count }))
            .sort((a, b) => {
              const sa = categoryById.get(a.categoryId);
              const sb = categoryById.get(b.categoryId);
              return (sa?.display_priority ?? 99) - (sb?.display_priority ?? 99);
            });

          return (
            <Box
              key={region.region_id}
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                borderLeft: '3px solid',
                borderLeftColor: region.region_color || 'primary.main',
                transition: 'background-color 0.1s ease',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {/* Region name — clickable to drill down */}
              <Box
                onClick={() => hasChildren && onNavigate(region.region_id, region.region_name)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  flex: 1,
                  minWidth: 0,
                  cursor: hasChildren ? 'pointer' : 'default',
                  py: 0.75,
                }}
              >
                {hasChildren ? (
                  <FolderIcon sx={{ fontSize: 18, color: region.region_color || 'primary.main', flexShrink: 0 }} />
                ) : (
                  <PlaceIcon sx={{ fontSize: 18, color: 'action.active', flexShrink: 0 }} />
                )}
                <Typography
                  variant="body2"
                  noWrap
                  sx={{
                    fontWeight: 500,
                    fontSize: '0.85rem',
                    '&:hover': hasChildren ? { textDecoration: 'underline' } : {},
                  }}
                >
                  {region.region_name}
                </Typography>
                {hasChildren && (
                  <ChevronRightIcon sx={{ fontSize: 16, color: 'action.active', flexShrink: 0 }} />
                )}
              </Box>

              {/* Source count pills — text labels, not icons */}
              <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, alignItems: 'center' }}>
                {sortedSourceEntries.map(({ categoryId, count }) => {
                  const source = categoryById.get(categoryId);
                  if (!source) return null;
                  const color = getSourceColor(categoryId);
                  const label = shortSourceName(source.name);

                  return (
                    <Tooltip
                      key={categoryId}
                      title={`${count} ${source.name} in ${region.region_name}`}
                    >
                      <Box
                        onClick={(e) => {
                          e.stopPropagation();
                          onCategoryClick(region.region_id, region.region_name, categoryId, source.name);
                        }}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.25,
                          px: 0.75,
                          py: 0.25,
                          borderRadius: '10px',
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          color,
                          bgcolor: `${color}12`,
                          border: `1px solid ${color}30`,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          userSelect: 'none',
                          transition: 'all 0.15s ease',
                          '&:hover': {
                            bgcolor: `${color}25`,
                            border: `1px solid ${color}60`,
                            transform: 'scale(1.05)',
                          },
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>{label}</span>
                        <span>{count}</span>
                      </Box>
                    </Tooltip>
                  );
                })}
                {onAddExperience && (!canAddToRegion || canAddToRegion(region.region_id)) && (
                  <Tooltip title={`Add experience to ${region.region_name}`}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddExperience(region.region_id, region.region_name);
                      }}
                      sx={{
                        width: 20,
                        height: 20,
                        border: '1px solid',
                        borderColor: 'action.disabled',
                        '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
                      }}
                    >
                      <AddIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
