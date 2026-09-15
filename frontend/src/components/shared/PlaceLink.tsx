import { Link } from '@mui/material';
import type { LinkedPlace } from '../../api/experiences';
import { useAppAddress } from '../../hooks/useAppAddress';
import { useNavigation } from '../../hooks/useNavigation';
import { openableRegion } from '../../utils/openableRegion';

/**
 * A place one card names on another — the museum that shows a find, the site
 * a find was dug up at (#894) — as a way there, or as its name.
 *
 * A link only where the world view already open places the object (ADR-0042
 * decisions 2–4, the search's rule): the address is written whole, in the
 * reader's own world view, at the smallest region that holds the place, and
 * pushed, so Back returns to the card the link was on. Where that world view
 * does not place it — the default one, which owns no regions, or a lens that
 * has not claimed the place — the name is words, and honest ones: the
 * catalogue holds the thing and this lens cannot reach it.
 *
 * In Discover the address carries the place's kind, since a Discover card
 * opens inside its kind's list; on the map there is no kind to name.
 */
export function PlaceLink({ place }: { place: LinkedPlace }) {
  const { selectedWorldView, isCustomWorldView } = useNavigation();
  const { address, go } = useAppAddress();
  const worldViewId = isCustomWorldView ? selectedWorldView?.id ?? null : null;
  const region = openableRegion(place.regions, worldViewId);

  if (!region || address === null) return <>{place.name}</>;

  const mode = address.mode;
  return (
    <Link
      component="button"
      type="button"
      variant="inherit"
      underline="hover"
      // The row a link sits on may itself be a control (a card's row opens on
      // click); the link answers for its own press and nothing above it.
      onClick={(event) => {
        event.stopPropagation();
        go({
          mode,
          worldViewId: region.world_view_id,
          regionId: region.id,
          experienceId: place.id,
          kindId: mode === 'discover' ? place.kind_id : null,
        }, { names: { region: region.name, experience: place.name } });
      }}
      sx={{ verticalAlign: 'baseline', textAlign: 'inherit', font: 'inherit' }}
    >
      {place.name}
    </Link>
  );
}
