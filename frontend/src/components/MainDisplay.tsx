import { useState, useEffect } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { ChevronLeft as OpenPanelIcon } from '@mui/icons-material';
import { RegionMapVT } from './RegionMapVT';
import { RegionDescriptionSection } from './RegionDescriptionSection';
import { useNavigation } from '../hooks/useNavigation';
import { ExperienceProvider } from '../hooks/useExperienceContext';

// Notify App.tsx about exploration mode changes
let onExplorationModeChange: ((exploring: boolean) => void) | null = null;
export function setExplorationModeListener(listener: (exploring: boolean) => void) {
  onExplorationModeChange = listener;
}

export function MainDisplay() {
  const { selectedRegion, isLoading } = useNavigation();
  const [isExploring, setIsExploring] = useState(false);

  // Reset exploration mode when region changes
  useEffect(() => {
    setIsExploring(false);
  }, [selectedRegion?.id]);

  // Notify parent about exploration mode changes
  useEffect(() => {
    onExplorationModeChange?.(isExploring);
  }, [isExploring]);

  if (isLoading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  return (
    <ExperienceProvider regionId={selectedRegion?.id ?? null} isExploring={isExploring}>
      <Box>
        {/* Header */}
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="h5" component="h2" sx={{ mb: selectedRegion?.description ? 0.5 : 0 }}>
            {selectedRegion?.name || 'Select a region'}
          </Typography>
          {selectedRegion?.description && (
            <Typography variant="body2" color="text.secondary">
              {selectedRegion.description}
            </Typography>
          )}
          {selectedRegion && !selectedRegion.description && (
            <Typography variant="body2" color="text.secondary">
              {selectedRegion.hasSubregions
                ? 'Select a subregion from the list or click on the map.'
                : 'This is a leaf region with no further subdivisions.'}
            </Typography>
          )}
        </Box>

        {/* Main content: Map + Experience List side by side */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          {/* Map - sticky when scrolling */}
          <Box
            sx={{
              flex: isExploring ? '0 0 65%' : '1 1 100%',
              position: 'sticky',
              top: 16,
              alignSelf: 'flex-start',
              transition: 'flex 0.3s ease',
            }}
          >
            <Box sx={{ position: 'relative' }}>
              <RegionMapVT />
              {/* Edge tab to open Explore panel */}
              {selectedRegion && !isExploring && (
                <Tooltip title="Explore experiences in this region" placement="left">
                  <IconButton
                    onClick={() => setIsExploring(true)}
                    sx={{
                      position: 'absolute',
                      right: -18,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      zIndex: 10,
                      width: 36,
                      height: 36,
                      bgcolor: 'primary.main',
                      color: 'white',
                      border: 1,
                      borderColor: 'primary.dark',
                      boxShadow: 2,
                      '&:hover': {
                        bgcolor: 'primary.dark',
                      },
                    }}
                  >
                    <OpenPanelIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>

          {/* Experience List - right side, only when exploring */}
          {isExploring && selectedRegion && (
            <Box
              sx={{
                flex: '0 0 35%',
                minWidth: 280,
                height: 'calc(100vh - 200px)',
                position: 'sticky',
                top: 16,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <RegionDescriptionSection onClose={() => setIsExploring(false)} />
            </Box>
          )}
        </Box>
      </Box>
    </ExperienceProvider>
  );
}
