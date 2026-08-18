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
import { representablePlaces } from './buildMarkers';
import { useRegionLocations } from '../../hooks/useRegionLocations';

interface FoldPlacesControlProps {
  /** How many places the object draws when unfolded; under two, nothing renders. */
  places: number;
  folded: boolean;
  onToggle: () => void;
}

/**
 * The control itself, given its answer rather than finding it: Map mode and
 * Discover hold their folds separately (see `useCollapsedExperiences`) and read
 * places through different paths, and both want the same chip in the same place.
 */
export function FoldPlacesControl({ places, folded, onToggle }: FoldPlacesControlProps) {
  if (places < 2) return null;

  return (
    <Chip
      icon={folded ? <PlaceIcon fontSize="small" /> : <LayersClearIcon fontSize="small" />}
      label={folded ? `Show all ${places} places` : 'Show as one pin'}
      size="small"
      color="primary"
      onClick={onToggle}
      sx={{
        // Top centre, because both surfaces put the experience hover card in the
        // bottom-left corner at the same z-index and later in DOM order — Map
        // mode whenever the hovered point is in the top-right quadrant, Discover
        // always. The card is `pointerEvents: 'none'`, so the click still landed;
        // the control was simply invisible while a marker was hovered, which is
        // most of the time a reader is deciding to fold something. Nothing else
        // sits at the top centre: the region card is top-left, the zoom controls
        // top-right.
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
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

interface SelectedObjectFoldControlProps {
  regionId: number;
}

/** Map mode's wrapper: the selected object, its places, and this region's folds. */
export function SelectedObjectFoldControl({ regionId }: SelectedObjectFoldControlProps) {
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

  // The shared rule, not a copy of it: the doc says every surface asks this one
  // function, and two lines that merely agree today are how that stops being true.
  // `places < 2` covers the empty case, so no guard is needed above it.
  const places = representablePlaces(locationsByExperience[selectedExperienceId]).length;

  return (
    <FoldPlacesControl
      places={places}
      folded={collapsedExperienceIds.has(selectedExperienceId)}
      onToggle={() => toggleCollapsedExperience(selectedExperienceId)}
    />
  );
}
