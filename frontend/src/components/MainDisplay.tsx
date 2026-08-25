import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { ChevronLeft as OpenPanelIcon } from '@mui/icons-material';
import { RegionMapVT } from './RegionMapVT';
import { RegionDescriptionSection } from './RegionDescriptionSection';
import { SetupInstructions } from './SetupInstructions';
import { useNavigation } from '../hooks/useNavigation';
import { useAuth } from '../hooks/useAuth';
import { useAppAddress } from '../hooks/useAppAddress';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ExperienceProvider, useExperienceContext } from '../hooks/useExperienceContext';

// Notify App.tsx about exploration mode changes
let onExplorationModeChange: ((exploring: boolean) => void) | null = null;
export function setExplorationModeListener(listener: (exploring: boolean) => void) {
  onExplorationModeChange = listener;
}

/** The tab names the place: the open card, then the region. */
function MapPageTitle() {
  const { selectedRegion } = useNavigation();
  const { selectedExperienceId, getExperienceById } = useExperienceContext();
  const experience = selectedExperienceId === null ? undefined : getExperienceById(selectedExperienceId);
  useDocumentTitle([experience?.name, selectedRegion?.name].filter(Boolean).join(' · ') || null);
  return null;
}

export function MainDisplay() {
  const { selectedRegion, worldViews, isLoading } = useNavigation();
  const { isAuthenticated } = useAuth();
  const { address, go } = useAppAddress();
  const [exploring, setExploring] = useState(false);
  // A card in the address is open in the panel, so the panel is open: a link to
  // a card lands on the card, not on a closed panel with a card inside it.
  //
  // Scoped to the region the card belongs to, the way `ExperienceProvider`
  // scopes the selection it derives. A selection made in the app sets the region
  // urgently and writes the address through the router's transition, so there is
  // a commit holding the new region beside the *previous* region's card — and
  // reading that as "a card is open here" would leave the panel open on a region
  // the reader has just moved to.
  const arrivedAtCard = address !== null
    && address.experienceId !== null
    && address.regionId === (selectedRegion?.id ?? null);
  const isExploring = exploring || arrivedAtCard;

  // Read rather than depended on: this effect answers a change of *region*, and
  // depending on the address would re-run it when the card closes — which is
  // the moment the panel must survive.
  const arrivedAtCardRef = useRef(arrivedAtCard);
  arrivedAtCardRef.current = arrivedAtCard;

  // A new region closes the panel — unless its address names a card of that
  // region, which is a link straight to one. That is also what keeps the panel
  // open when a reader
  // who followed such a link closes the card: they came for the place, and are
  // now browsing the rest of it, so the list must not vanish under them. The
  // region arrives after the address on a restore, so this effect is where the
  // flag can be set from it; seeding the initial state instead would be undone
  // by this very run.
  useEffect(() => {
    setExploring(arrivedAtCardRef.current);
  }, [selectedRegion?.id]);

  // Closing the panel closes the card it holds, as a step: Back reopens it.
  const closeExploration = useCallback(() => {
    setExploring(false);
    if (address !== null && address.experienceId !== null) go(at => ({ ...at, experienceId: null }));
  }, [address, go]);

  // Notify parent about exploration mode changes
  useEffect(() => {
    onExplorationModeChange?.(isExploring);
  }, [isExploring]);

  // Fresh installation: no custom world views — show setup steps
  if (!isLoading && worldViews.length === 0) {
    return <SetupInstructions isAuthenticated={isAuthenticated} />;
  }

  if (isLoading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  return (
    <ExperienceProvider regionId={selectedRegion?.id ?? null} isExploring={isExploring}>
      <MapPageTitle />
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
                    onClick={() => setExploring(true)}
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
              <RegionDescriptionSection onClose={closeExploration} />
            </Box>
          )}
        </Box>
      </Box>
    </ExperienceProvider>
  );
}
