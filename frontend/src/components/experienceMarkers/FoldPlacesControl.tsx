/**
 * The map's half of the per-object fold (#558).
 *
 * The list has the count chip, which is where a reader scrolling rows asks for
 * one pin instead of forty. A reader working on the map has no rows in front of
 * them, and the pins themselves cannot carry the ask: a folded pin is unfolded by
 * clicking it, but an *unfolded* object is forty pins and clicking one of them
 * means "select this object", which is the one meaning it cannot lose.
 *
 * So the ask lives on the object the map is already about — the selected one.
 * It appears only for an object with more than one place, because folding one
 * place into one pin is not a question, and it says which way the click goes
 * rather than naming a state.
 *
 * It is deliberately not the hover card: that follows the pointer and is built
 * with `pointerEvents: 'none'`, so nothing on it can be clicked.
 */

import { Chip } from '@mui/material';
import LayersClearIcon from '@mui/icons-material/LayersClear';
import PlaceIcon from '@mui/icons-material/Place';
import { useExperienceContext } from '../../hooks/useExperienceContext';
import { useRegionLocations } from '../../hooks/useRegionLocations';

interface FoldPlacesControlProps {
  regionId: number;
}

export function FoldPlacesControl({ regionId }: FoldPlacesControlProps) {
  const {
    selectedExperienceId,
    collapsedExperienceIds,
    toggleCollapsedExperience,
    showLost,
  } = useExperienceContext();
  // The same query key the markers use, so this reads the batch already in cache
  // rather than fetching a second copy of it.
  const { locationsByExperience } = useRegionLocations(regionId, showLost);

  if (selectedExperienceId == null) return null;

  const locations = locationsByExperience[selectedExperienceId];
  if (!locations || locations.length === 0) return null;
  const inRegion = locations.filter(loc => loc.in_region !== false);
  const places = (inRegion.length > 0 ? inRegion : locations).length;
  if (places < 2) return null;

  const folded = collapsedExperienceIds.has(selectedExperienceId);

  return (
    <Chip
      icon={folded ? <PlaceIcon fontSize="small" /> : <LayersClearIcon fontSize="small" />}
      label={folded ? `Show all ${places} places` : 'Show as one pin'}
      size="small"
      color="primary"
      onClick={() => toggleCollapsedExperience(selectedExperienceId)}
      sx={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 3,
        cursor: 'pointer',
        backgroundColor: 'rgba(255,255,255,0.97)',
        color: 'text.primary',
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
        '&:hover': { backgroundColor: 'rgba(255,255,255,1)' },
      }}
    />
  );
}
