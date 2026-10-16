/**
 * DiscoverRegionList — Virtualized list of regions with text-based source count tags.
 * Each row: region name + readable kind pills like "World Heritage 42 · Art Museums 15".
 * Click region name → navigate deeper. Click source pill → view experiences.
 *
 * Uses text labels (not icons) to scale to dozens of experience kinds.
 */

import { useRef, useMemo } from 'react';
import {
  Box,
  List,
  Typography,
  Tooltip,
  IconButton,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import PlaceIcon from '@mui/icons-material/Place';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RegionExperienceCount, ExperienceKind } from '../../api/experiences';
import { kindColor, shortKindName } from '../../utils/kindColors';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { EmptyState } from '../shared/EmptyState';
import { VirtualRow } from '../shared/VirtualRow';

/** A row's height with its pills beside the name; a row whose pills wrap grows from it. */
const ROW_MIN_HEIGHT = 48;

/**
 * The least width a region's name takes, however short. The pills share its line
 * while the name's whole text and they fit, and take a line of their own when
 * not; the name truncates only when its own text is wider than the row.
 */
const NAME_MIN_WIDTH = '9rem';

interface DiscoverRegionListProps {
  regions: RegionExperienceCount[];
  kinds: ExperienceKind[];
  isLoading: boolean;
  onNavigate: (regionId: number, regionName: string) => void;
  onKindClick: (regionId: number, regionName: string, kindId: number, kindName: string) => void;
  /** Called when curator clicks "+" to add experience of any kind to a region.
   *  Only called for regions where canAddToRegion returns true (if provided). */
  onAddExperience?: (regionId: number, regionName: string) => void;
  /** Predicate to check if the curator can add to a specific region. If not provided, all regions are allowed. */
  canAddToRegion?: (regionId: number) => boolean;
}

export function DiscoverRegionList({
  regions,
  kinds,
  isLoading,
  onNavigate,
  onKindClick,
  onAddExperience,
  canAddToRegion,
}: DiscoverRegionListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Build a lookup: kindId → kind object
  const kindById = useMemo(() => {
    const map = new Map<number, ExperienceKind>();
    for (const s of kinds) map.set(s.id, s);
    return map;
  }, [kinds]);

  const virtualizer = useVirtualizer({
    count: regions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_MIN_HEIGHT,
    // Rows are measured, and a drill-down hands the window another level's
    // regions: keyed by index, an off-screen row would keep the height measured
    // for the region that held its index before.
    getItemKey: (index) => regions[index].region_id,
    overscan: 10,
  });

  if (isLoading) {
    return <LoadingSpinner size={28} padding="24px 0" />;
  }

  if (regions.length === 0) {
    return <EmptyState message="No regions with experiences at this level." />;
  }

  return (
    <Box
      ref={parentRef}
      sx={{ flex: 1, overflowY: 'auto' }}
    >
      <List
        disablePadding
        sx={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const region = regions[virtualRow.index];
          const hasChildren = region.has_subregions;

          // Sorted source entries (by display_priority)
          const sortedKindEntries = Object.entries(region.kind_counts)
            .map(([sid, count]) => ({ kindId: Number(sid), count }))
            .sort((a, b) => {
              const sa = kindById.get(a.kindId);
              const sb = kindById.get(b.kindId);
              return (sa?.display_priority ?? 99) - (sb?.display_priority ?? 99);
            });

          // A row is as tall as its pills need: they wrap under the name
          // rather than squeeze it, so the window measures each row.
          return (
            <VirtualRow
              key={virtualRow.key}
              virtualizer={virtualizer}
              index={virtualRow.index}
              start={virtualRow.start}
            >
              <Box
                sx={{
                  minHeight: ROW_MIN_HEIGHT,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 1,
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
                    flex: '1 1 auto',
                    minWidth: NAME_MIN_WIDTH,
                    maxWidth: '100%',
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
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', minWidth: 0, pb: 0.5, pt: 0.25 }}>
                  {sortedKindEntries.map(({ kindId, count }) => {
                    const source = kindById.get(kindId);
                    if (!source) return null;
                    const color = kindColor(kindId);
                    const label = shortKindName(source.name);

                    return (
                      <Tooltip
                        key={kindId}
                        title={`${count} ${source.name} in ${region.region_name}`}
                      >
                        <Box
                          onClick={(e) => {
                            e.stopPropagation();
                            onKindClick(region.region_id, region.region_name, kindId, source.name);
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
            </VirtualRow>
          );
        })}
      </List>
    </Box>
  );
}
