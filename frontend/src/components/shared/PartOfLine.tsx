/**
 * The whole a place is a part of, on the place's own card, for a visitor
 * (#2118): "Part of Cathedral, Alcázar and Archivo de Indias in Seville ·
 * 3 places". Seville Cathedral, in Places of worship, said nothing about being
 * one of the site's three places. The count is the whole's places a reader is
 * shown (`part_of.places`), and the line is drawn only while a reader may be
 * sent to the whole, which the name links to where the open world view
 * places it (`PlaceLink`).
 */

import { Typography } from '@mui/material';
import type { ExperienceDetail } from '../../api/experiences';
import { plural } from '../../utils/plural';
import { PlaceLink } from './PlaceLink';

export function PartOfLine({ partOf }: { partOf: ExperienceDetail['part_of'] | undefined }) {
  if (!partOf || partOf.places === null) return null;
  const places = plural(partOf.places, 'place');
  return (
    <Typography variant="body2" sx={{ mb: 1.5 }}>
      Part of <PlaceLink place={{ id: partOf.id, name: partOf.name, kind_id: partOf.kind_id, regions: partOf.regions }} /> · {places}
    </Typography>
  );
}
