/**
 * A place named on a review card as a way to its card (#2207): the museum
 * that already shows an arrived work.
 *
 * Not the shell's `PlaceLink`, on purpose. The review page is no place
 * (`review` is in `NOT_A_PLACE`), so there is no open lens to keep and no
 * address to write relatively; and the review page is its own chunk, which
 * reaches the shell's modules only through what it already imports. The
 * one import of `PlaceLink` from here made Rolldown cut `useAppAddress`, the
 * navigation context and a handful of icons out of the entry chunk into
 * chunks of their own — requests on the map view and Discover at startup,
 * over the request budget — because a module's chunk follows the set of
 * screens that reach it. So this link is built from what the review chunk
 * already holds: the address grammar (`buildAppUrl`, which
 * `useReviewAddress` reads) and the router.
 *
 * The address is written whole, in the first world view the read says places
 * the object, at the smallest region that holds it there — the list arrives
 * most specific first (`readerRegionsJsonSql`), across every world view a
 * reader may see — on the map, since a page with no lens has no mode to
 * keep; pushed, so Back returns to the card. That world view may not be the
 * one the curator last had open, which `PlaceLink` never does and the
 * inventory row says so: reading the open one needs the navigation context,
 * the very module the chunk must not reach. A place no world view places
 * is its name, as `PlaceLink` says it.
 */

import { Link } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import type { LinkedPlace } from '../../api/experiences';
import { buildAppUrl } from '../../utils/appUrl';

export function ReviewPlaceLink({ place }: { place: LinkedPlace }) {
  const region = place.regions[0];
  if (!region) return <>{place.name}</>;
  const href = buildAppUrl(
    { mode: 'map', worldViewId: region.world_view_id, regionId: region.id, experienceId: place.id, pointId: null, kindId: null },
    { region: region.name, experience: place.name },
  );
  // A real link with an href, through the router: a plain click is a push,
  // and a middle click or the browser's menu opens the card in another tab.
  return (
    <Link
      component={RouterLink}
      to={href}
      variant="inherit"
      underline="hover"
      // The row a link sits on may itself be a control; the link answers for its own press.
      onClick={(event) => event.stopPropagation()}
      sx={{ verticalAlign: 'baseline', font: 'inherit' }}
    >
      {place.name}
    </Link>
  );
}
