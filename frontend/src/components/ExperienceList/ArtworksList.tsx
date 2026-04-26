import { useState } from 'react';
import { Box, Typography, Checkbox } from '@mui/material';
import { useExperienceContext, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { useAuth } from '../../hooks/useAuth';
import { useViewedTreasures } from '../../hooks/useVisitedExperiences';
import type { ExperienceTreasure } from '../../api/experiences';
import { VISITED_GREEN } from '../../utils/categoryColors';
import { ARTWORKS_INITIAL_LIMIT } from './utils';

interface ArtworksListProps {
  contents: ExperienceTreasure[];
  total: number;
  experienceId: number;
}

export function ArtworksList({ contents, total, experienceId }: ArtworksListProps) {
  const { setPreviewImageUrl } = useExperienceContext();
  const { isAuthenticated } = useAuth();
  const { viewedIds, viewedCount, markViewed, unmarkViewed } = useViewedTreasures(experienceId);
  const [showAll, setShowAll] = useState(false);
  const displayContents = showAll ? contents : contents.slice(0, ARTWORKS_INITIAL_LIMIT);
  const hasMore = total > ARTWORKS_INITIAL_LIMIT;

  const handleToggleViewed = (treasureId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewedIds.has(treasureId)) {
      unmarkViewed(treasureId);
    } else {
      markViewed({ treasureId, experienceId });
    }
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 600 }}>
        Notable works ({total}){isAuthenticated && viewedCount > 0 && ` · ${viewedCount} seen`}
      </Typography>
      <Box
        sx={{
          bgcolor: 'white',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        {displayContents.map((content) => {
          const isViewed = viewedIds.has(content.id);
          return (
            <Box
              key={content.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-child': { borderBottom: 0 },
              }}
            >
              {isAuthenticated && (
                <Checkbox
                  size="small"
                  checked={isViewed}
                  onClick={(e) => handleToggleViewed(content.id, e)}
                  sx={{
                    p: 0.25,
                    flexShrink: 0,
                    '&.Mui-checked': { color: VISITED_GREEN },
                  }}
                />
              )}
              {content.image_url && (
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'grey.100',
                    borderRadius: 0.5,
                    cursor: 'pointer',
                    opacity: isViewed ? 0.5 : 1,
                  }}
                  onMouseEnter={() => setPreviewImageUrl(toThumbnailUrl(content.image_url!, 500))}
                  onMouseLeave={() => setPreviewImageUrl(null)}
                >
                  <Box
                    component="img"
                    src={toThumbnailUrl(content.image_url)}
                    alt={content.name}
                    loading="lazy"
                    sx={{
                      maxWidth: 48,
                      maxHeight: 48,
                      objectFit: 'contain',
                      borderRadius: 0.5,
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </Box>
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                    lineHeight: 1.3,
                    textDecoration: isViewed ? 'line-through' : 'none',
                    color: isViewed ? 'text.secondary' : 'text.primary',
                  }}
                  noWrap
                >
                  {content.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {[
                    content.artist,
                    content.year,
                    content.treasure_type,
                  ].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
            </Box>
          );
        })}
        {hasMore && !showAll && (
          <Box
            sx={{ textAlign: 'center', py: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            onClick={() => setShowAll(true)}
          >
            <Typography variant="caption" color="primary">
              Show all {total} works
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
