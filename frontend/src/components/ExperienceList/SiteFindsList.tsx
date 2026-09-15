import { useExperienceContext } from '../../hooks/useExperienceContext';
import { SiteFinds } from '../shared/SiteFinds';
import type { SiteFind } from '../../api/experiences';

/**
 * Map mode's copy of a site's finds (#894): the shared list, with the map's
 * overlay for the larger picture.
 *
 * A wrapper rather than a hook call inside the card, for the reason
 * `ArtworksList` reads the overlay's setter itself: the context's value
 * changes whenever a preview opens or closes, and a card that subscribed to it
 * would rebuild everything it draws — the picture, the chips, every place —
 * each time a thumbnail is hovered. Discover renders `SiteFinds` directly; it
 * has no overlay.
 */
export function SiteFindsList({ finds, total }: { finds: SiteFind[]; total: number }) {
  const { setArtworkPreview } = useExperienceContext();
  return <SiteFinds finds={finds} total={total} onPreview={setArtworkPreview} />;
}
