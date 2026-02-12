/**
 * ExperienceCard — Supports both vertical (grid) and compact horizontal (sidebar) layouts.
 * Shows thumbnail, category, country, name, and visited status.
 */

import { forwardRef } from 'react';
import { Box, Typography, Chip, Checkbox, Tooltip, IconButton } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TuneIcon from '@mui/icons-material/Tune';
import BlockIcon from '@mui/icons-material/Block';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { CATEGORY_COLORS } from '../../utils/categoryColors';
import type { Experience } from '../../api/experiences';

interface ExperienceCardProps {
  experience: Experience;
  isVisited: boolean;
  isHovered?: boolean;
  isSelected?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onVisitedToggle?: (e: React.MouseEvent) => void;
  showCheckbox: boolean;
  /** Compact horizontal layout for sidebar */
  compact?: boolean;
  /** Curator: opens curation dialog */
  onCurate?: () => void;
}

export const ExperienceCard = forwardRef<HTMLDivElement, ExperienceCardProps>(
  function ExperienceCard(
    {
      experience,
      isVisited,
      isHovered = false,
      isSelected = false,
      onClick,
      onMouseEnter,
      onMouseLeave,
      onVisitedToggle,
      showCheckbox,
      compact = false,
      onCurate,
    },
    ref,
  ) {
    const isRejected = experience.is_rejected;
    const imageUrl = extractImageUrl(experience.image_url);
    const colors = CATEGORY_COLORS[experience.category || ''];
    const catStyle = colors
      ? { bg: colors.bg, text: colors.text, border: colors.primary }
      : { bg: '#E0E7FF', text: '#4F46E5', border: '#6366F1' };

    if (compact) {
      return (
        <Box
          ref={ref}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          sx={{
            display: 'flex',
            gap: 1.5,
            p: 1.25,
            cursor: 'pointer',
            bgcolor: isRejected
              ? 'rgba(239, 68, 68, 0.04)'
              : isHovered
                ? 'action.hover'
                : isSelected
                  ? 'primary.50'
                  : 'transparent',
            borderLeft: '3px solid',
            borderLeftColor: isRejected
              ? 'error.main'
              : isSelected ? 'primary.main' : isHovered ? catStyle.border : 'transparent',
            borderBottom: '1px solid',
            borderBottomColor: 'divider',
            transition: 'all 0.15s ease',
            '&:hover': { bgcolor: 'action.hover' },
            opacity: isRejected ? 0.55 : isVisited ? 0.7 : 1,
          }}
        >
          {/* Thumbnail */}
          <Box
            sx={{
              width: 56,
              height: 56,
              flexShrink: 0,
              borderRadius: 1,
              overflow: 'hidden',
              bgcolor: 'grey.100',
              position: 'relative',
            }}
          >
            {imageUrl ? (
              <Box
                component="img"
                src={toThumbnailUrl(imageUrl, 120)}
                alt=""
                loading="lazy"
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: isVisited ? 'saturate(0.4)' : 'none',
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Box
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: catStyle.bg,
                }}
              >
                <Typography sx={{ fontSize: '0.55rem', color: catStyle.text }}>
                  {experience.category?.charAt(0).toUpperCase() || '?'}
                </Typography>
              </Box>
            )}
            {isVisited && (
              <CheckCircleIcon
                sx={{
                  position: 'absolute',
                  bottom: 1,
                  right: 1,
                  fontSize: 14,
                  color: '#22c55e',
                  bgcolor: 'white',
                  borderRadius: '50%',
                }}
              />
            )}
          </Box>

          {/* Text content */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.25 }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                fontSize: '0.8rem',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textDecoration: isRejected ? 'line-through' : isVisited ? 'line-through' : 'none',
                color: isRejected ? 'error.main' : isVisited ? 'text.secondary' : 'text.primary',
              }}
            >
              {experience.name}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              {isRejected && (
                <Chip
                  icon={<BlockIcon sx={{ fontSize: '0.6rem !important' }} />}
                  label="Rejected"
                  size="small"
                  color="error"
                  variant="outlined"
                  sx={{
                    height: 16,
                    fontSize: '0.55rem',
                    '& .MuiChip-label': { px: 0.5 },
                    '& .MuiChip-icon': { ml: 0.25 },
                  }}
                />
              )}
              {experience.category && (
                <Chip
                  label={experience.category}
                  size="small"
                  sx={{
                    bgcolor: catStyle.bg,
                    color: catStyle.text,
                    fontWeight: 600,
                    fontSize: '0.55rem',
                    height: 16,
                    textTransform: 'capitalize',
                    '& .MuiChip-label': { px: 0.5 },
                  }}
                />
              )}
              {experience.in_danger && (
                <Tooltip title="In Danger">
                  <WarningAmberIcon sx={{ fontSize: 12, color: 'error.main' }} />
                </Tooltip>
              )}
            </Box>
            {experience.country_names?.[0] && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: '0.7rem' }}>
                {experience.country_names.length > 1
                  ? `${experience.country_names[0]} +${experience.country_names.length - 1}`
                  : experience.country_names[0]}
              </Typography>
            )}
          </Box>

          {/* Actions: checkbox + curate */}
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 0.25 }}>
            {onCurate && (
              <Tooltip title="Curate">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onCurate(); }}
                  sx={{ p: 0.25, opacity: 0.5, '&:hover': { opacity: 1 } }}
                >
                  <TuneIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            {showCheckbox && (
              <Checkbox
                checked={isVisited}
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onVisitedToggle?.(e);
                }}
                sx={{
                  p: 0.25,
                  '&.Mui-checked': { color: '#22c55e' },
                }}
              />
            )}
          </Box>
        </Box>
      );
    }

    // ── Vertical card (grid mode — kept for future use) ──
    return (
      <Box
        ref={ref}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        sx={{
          cursor: 'pointer',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: isSelected ? 'primary.main' : 'divider',
          borderLeft: '3px solid',
          borderLeftColor: catStyle.border,
          boxShadow: isSelected ? 4 : 1,
          transition: 'all 0.2s ease',
          opacity: isVisited ? 0.8 : 1,
          '&:hover': { boxShadow: 4, transform: 'translateY(-2px)' },
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ width: '100%', aspectRatio: '16 / 10', bgcolor: 'grey.100', overflow: 'hidden', position: 'relative' }}>
          {imageUrl ? (
            <Box
              component="img"
              src={toThumbnailUrl(imageUrl, 500)}
              alt={experience.name}
              loading="lazy"
              sx={{ width: '100%', height: '100%', objectFit: 'cover', filter: isVisited ? 'saturate(0.5)' : 'none' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="caption" color="text.secondary">No image</Typography>
            </Box>
          )}
          {isVisited && (
            <CheckCircleIcon sx={{ position: 'absolute', top: 8, right: 8, color: '#22c55e', fontSize: 28, bgcolor: 'white', borderRadius: '50%' }} />
          )}
        </Box>
        <Box sx={{ p: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {experience.category && (
              <Chip label={experience.category} size="small" sx={{ bgcolor: catStyle.bg, color: catStyle.text, fontWeight: 600, fontSize: '0.65rem', height: 20, textTransform: 'capitalize' }} />
            )}
            {experience.in_danger && (
              <Tooltip title="In Danger"><WarningAmberIcon sx={{ fontSize: 16, color: 'error.main' }} /></Tooltip>
            )}
          </Box>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textDecoration: isVisited ? 'line-through' : 'none', color: isVisited ? 'text.secondary' : 'text.primary' }}
          >
            {experience.name}
          </Typography>
          {experience.country_names?.[0] && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {experience.country_names.length > 1 ? `${experience.country_names[0]} +${experience.country_names.length - 1}` : experience.country_names[0]}
            </Typography>
          )}
        </Box>
      </Box>
    );
  },
);
