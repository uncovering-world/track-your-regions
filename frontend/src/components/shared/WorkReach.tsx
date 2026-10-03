/**
 * How far a correction to a work reaches, said with the museums' names.
 *
 * A work is one row shared by every museum that hangs it (ADR-0025 decision 2),
 * so the form that corrects it says so before Save. A count alone — "hangs in 2
 * museums" — is a claim about rows the screen does not show, and it is wrong in
 * the one case a curator meets most: until a place several kinds admit is one
 * row (#755), a museum listed under Art Museums and under Archaeology is two
 * rows over one Wikidata item, and a work linked to both hangs in one museum.
 * So the venues are grouped by the place they are — the source's own id — and
 * the banner names each place with the kinds it is listed under.
 *
 * Each name opens the place's Wikidata item rather than its card: a venue here
 * may be refused or still unread, and those have no address a reader's screen
 * answers at.
 */

import { Alert, Box, Link } from '@mui/material';
import type { WorkVenue } from '../../api/experiences';
import { plural } from '../../utils/plural';
import { wikidataItemUrl } from '../../utils/wikidataLinks';

/** One museum as the world has it: a place, and every list the catalogue keeps it in. */
export interface VenuePlace {
  externalId: string;
  name: string;
  kinds: string[];
  /** The kinds under which readers do not see the work today, for a place they see it under another. */
  unseenKinds: string[];
  /** Whether readers are shown the work in any of this place's lists today. */
  onShow: boolean;
}

/** The venues as places: rows with one source id are one museum listed more than once. */
export function venuePlaces(venues: ReadonlyArray<WorkVenue>): VenuePlace[] {
  const places = new Map<string, VenuePlace>();
  for (const venue of venues) {
    const place = places.get(venue.externalId)
      ?? { externalId: venue.externalId, name: venue.name, kinds: [], unseenKinds: [], onShow: false };
    if (venue.kind && !place.kinds.includes(venue.kind)) place.kinds.push(venue.kind);
    if (venue.kind && !venue.onShow && !place.unseenKinds.includes(venue.kind)) place.unseenKinds.push(venue.kind);
    place.onShow = place.onShow || venue.onShow;
    places.set(venue.externalId, place);
  }
  return [...places.values()];
}

/**
 * Where readers do not see the work, said per place: nowhere in it, or in one
 * of its lists and not another. The second is the state a place listed under
 * two kinds is usually met in — on show under one, unread under the other —
 * and "listed under both" alone would hide which list the card is about.
 */
function unseenNote(place: VenuePlace): string | null {
  if (!place.onShow) return 'readers do not see it there yet';
  if (place.unseenKinds.length > 0) return `readers do not see it under ${kindList(place.unseenKinds)} yet`;
  return null;
}

function kindList(kinds: string[]): string {
  if (kinds.length <= 1) return kinds[0] ?? '';
  return `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
}

/**
 * The sentence an outcome line ends on, or null where the correction reaches one
 * list of one museum. "Carry", not "show": a venue may be refused or still gated,
 * and the row it carries is corrected all the same (`venueCountSql`).
 */
export function reachOutcome(venues: ReadonlyArray<WorkVenue> | null | undefined, count: number): string | null {
  if (!venues) return count > 1 ? `All ${count} museums holding this work carry the correction.` : null;
  const places = venuePlaces(venues);
  if (places.length > 1) return `All ${places.length} museums holding this work carry the correction.`;
  if (venues.length > 1) return `Every list ${places[0].name} is in carries the correction.`;
  return null;
}

export function WorkReach({ venues, count }: {
  /** The museums, named — absent on a read that carries the count alone. */
  venues?: ReadonlyArray<WorkVenue> | null;
  /** How many museums hang the work, for the read that names none. */
  count: number;
}) {
  if (!venues) {
    if (count <= 1) return null;
    return (
      <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
        <strong>This work hangs in {count} museums.</strong> They share one row —
        correcting it here corrects it for all of them.
      </Alert>
    );
  }
  if (venues.length <= 1) return null;
  const places = venuePlaces(venues);
  const named = (place: VenuePlace) => {
    const href = wikidataItemUrl(place.externalId);
    return href
      ? <Link href={href} target="_blank" rel="noopener noreferrer">{place.name}</Link>
      : place.name;
  };

  if (places.length === 1) {
    const [place] = places;
    return (
      <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
        <strong>This work hangs in one museum, listed {plural(venues.length, 'time')}.</strong>{' '}
        {named(place)} is in the catalogue under {kindList(place.kinds)}, and its lists share
        this work’s row — correcting it here corrects it in each of them.
        {unseenNote(place) && ` Today ${unseenNote(place)}.`}
      </Alert>
    );
  }
  return (
    <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
      <strong>This work hangs in {places.length} museums.</strong> They share one row —
      correcting it here corrects it for all of them:
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {places.map(place => (
          <li key={place.externalId}>
            {named(place)}
            {place.kinds.length > 0 && ` — ${kindList(place.kinds)}`}
            {unseenNote(place) && ` · ${unseenNote(place)}`}
          </li>
        ))}
      </Box>
    </Alert>
  );
}
