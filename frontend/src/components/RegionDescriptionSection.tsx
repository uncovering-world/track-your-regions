/**
 * RegionDescriptionSection - Right panel for region exploration
 *
 * Displays:
 * - Experiences header with count and close button
 * - List of experiences grouped by source (UNESCO, Museums, Parks, etc.)
 */

import { useRef } from 'react';
import { Box, Typography, Paper, IconButton, Tooltip } from '@mui/material';
import { Close as CloseIcon, Explore as ExploreIcon } from '@mui/icons-material';
import { useNavigation } from '../hooks/useNavigation';
import { useExperienceContext } from '../hooks/useExperienceContext';
import { ExperienceList } from './ExperienceList';

interface RegionDescriptionSectionProps {
  onClose: () => void;
}

export function RegionDescriptionSection({ onClose }: RegionDescriptionSectionProps) {
  const { selectedRegion } = useNavigation();
  const { totalExperiences } = useExperienceContext();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  if (!selectedRegion) {
    return null;
  }

  return (
    <Paper sx={{ overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Experiences header with close button */}
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.100' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ExploreIcon fontSize="small" color="primary" />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Experiences
            </Typography>
            {totalExperiences > 0 && (
              <Typography variant="body2" color="text.secondary">
                ({totalExperiences})
              </Typography>
            )}
          </Box>
          <Tooltip title="Close exploration">
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Experience list grouped by source - scrollable */}
      <Box ref={scrollContainerRef} sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <ExperienceList scrollContainerRef={scrollContainerRef} />
      </Box>
    </Paper>
  );
}
