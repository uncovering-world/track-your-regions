/**
 * Where is this component? (#1853) The World Heritage list placed some
 * components of a serial site only roughly: to the whole minute, a cell of
 * about 1.8 × 1.5 km (the Longmen Grottoes stand 10 km from the list's point),
 * or on a point another component shares (Echmiatsin's cathedral, church and
 * cemetery on one street corner). One card per site, a row per such point.
 *
 * Each row says why the point is rough and lists what says where the component
 * really stands, nearest first within each source: an OpenStreetMap object
 * carrying the component's own World Heritage reference, the component's
 * Wikidata item, an item the component-item finder proposes for it, an
 * OpenStreetMap object named like it. A curator picks a hint, places the point
 * by hand, or keeps the list's point, which is the answer for a large area the
 * point stands for well enough (the Okavango Delta). Each answer is the
 * curator's placement of the point (`editLocation`): a claim on its
 * coordinate, which a later run keeps and which closes the question. Readers
 * see the list's point until then.
 */

import { useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Link, Stack, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { editLocation } from '../../api/curation';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { distanceLabel } from '../../utils/moveDescription';
import { safeHref } from '../../utils/safeHref';
import { wikidataItemUrl } from '../../utils/wikidataLinks';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { ComponentItemsMap, type MapFocus, type MinuteCell } from './ComponentItemsMap';
import { ItemHeader, messageFor } from './queueCard';

type OnDone = (message?: string, experienceId?: number) => void;
export type ApproximatePoint = NonNullable<ReviewQueueItem['approximate_points']>[number];
type Hint = ApproximatePoint['hints'][number];

/** Half a minute of arc, in degrees: the cell around a point given to the whole minute. */
const HALF_MINUTE = 0.5 / 60;
/** A minute of latitude, in kilometres. */
const MINUTE_KM = 1.852;

/** The whole minute a point was given to, as the box the component may stand anywhere in. */
export function minuteCell(point: { latitude: number; longitude: number }): MinuteCell {
  return {
    west: point.longitude - HALF_MINUTE, east: point.longitude + HALF_MINUTE,
    south: point.latitude - HALF_MINUTE, north: point.latitude + HALF_MINUTE,
  };
}

/** Why the list's point says only roughly where the component is. */
export function reasonWords(point: ApproximatePoint): string {
  if (point.reason === 'shared') {
    return 'The list puts it on the same point as another component of the site, so the point stands for neither.';
  }
  const wide = MINUTE_KM * Math.cos((point.latitude * Math.PI) / 180);
  return `The list gives it to the whole minute: it may stand anywhere in a cell of about ${wide.toFixed(1)} × ${MINUTE_KM.toFixed(1)} km around this point.`;
}

/** Where a hint comes from, in the curator's words. */
export function hintSource(hint: Hint): string {
  switch (hint.source) {
    case 'osm-ref': return 'OpenStreetMap, carrying its World Heritage reference';
    case 'item': return 'its own Wikidata item';
    case 'candidate': return 'an item proposed for it';
    case 'osm-name': return 'OpenStreetMap, named like it';
  }
}

/** Where a hint's own page is: its Wikidata item, or its OpenStreetMap object. */
export function hintHref(hint: Hint): string | null {
  if (hint.source === 'item' || hint.source === 'candidate') return wikidataItemUrl(hint.ref);
  const kind = { N: 'node', W: 'way', R: 'relation' }[hint.ref[0]];
  return kind ? safeHref(`https://www.openstreetmap.org/${kind}/${hint.ref.slice(1)}`) : null;
}

export function ApproximatePointsCard({ item, onDone }: { item: ReviewQueueItem; onDone: OnDone }) {
  const points = useMemo(() => item.approximate_points ?? [], [item.approximate_points]);
  const [reading, setReading] = useState<{ point: number; hint: number | null }>({ point: 0, hint: 0 });
  const [byHand, setByHand] = useState<ApproximatePoint | null>(null);
  const point = points[Math.min(reading.point, points.length - 1)];
  const hint = point && reading.hint !== null ? point.hints[reading.hint] ?? null : null;
  // Kept while the point and the hint stay the same: the map eases to its focus
  // whenever the focus changes, and a new one each render would undo a zoom.
  const focus = useMemo<MapFocus | null>(() => (point ? {
    point: { locationId: point.locationId, name: point.name ?? point.ref ?? 'This component', latitude: point.latitude, longitude: point.longitude },
    candidate: hint ? { label: hint.label ?? hint.ref, latitude: hint.latitude, longitude: hint.longitude, distance: distanceLabel(hint.metres) } : null,
  } : null), [point, hint]);
  const cell = useMemo(() => (point?.reason === 'whole-minute' ? minuteCell(point) : null), [point]);

  const place = useMutation({
    mutationFn: ({ target, at }: { target: ApproximatePoint; at: { latitude: number; longitude: number }; word: string }) => (
      editLocation(target.locationId, { latitude: at.latitude, longitude: at.longitude })
    ),
    onSettled: (data, error, { target, word }) => onDone(
      error || !data ? messageFor(item, error) : `${item.name}: ${target.name ?? target.ref ?? 'a component'} ${word}`, item.id,
    ),
  });

  if (!point || !focus) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <Typography variant="body2" sx={{ mb: 2 }}>
          The World Heritage list places {points.length === 1 ? 'one component' : `${points.length} components`} of this
          site only roughly. Say where each stands: pick a hint, place it by hand, or keep the list&apos;s point where it
          stands for a large area well enough. Readers see the list&apos;s point until you answer.
        </Typography>
        <ComponentItemsMap
          sitePoints={item.site_points ?? []}
          focus={focus}
          cell={cell}
          noCandidate="No hint picked"
        />
        <Stack spacing={2} sx={{ mt: 2 }}>
          {points.map((each, p) => (
            <Box key={each.locationId} sx={{ border: 1, borderColor: p === reading.point ? 'primary.main' : 'divider', borderRadius: 1, p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {each.name ?? 'Unnamed component'}{each.ref ? ` (${each.ref})` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">{reasonWords(each)}</Typography>
              {each.hints.length === 0 && (
                <Typography variant="body2" sx={{ mt: 1 }}>Nothing says where else it stands: place it by hand, or keep it.</Typography>
              )}
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {each.hints.map((h, i) => {
                  const href = hintHref(h);
                  return (
                    <Stack key={`${h.source}:${h.ref}`} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="body2" sx={{ minWidth: 0 }}>
                        <strong>{h.label ?? h.ref}</strong> — {hintSource(h)},{' '}
                        {href ? <Link href={href} target="_blank" rel="noopener noreferrer">{h.ref}</Link> : h.ref},{' '}
                        {distanceLabel(h.metres)} from the list&apos;s point
                      </Typography>
                      <Button size="small" onClick={() => setReading({ point: p, hint: i })}>Show on the map</Button>
                      <Button
                        size="small" variant="outlined" disabled={place.isPending}
                        onClick={() => place.mutate({ target: each, at: h, word: `moved ${distanceLabel(h.metres)} to ${h.label ?? h.ref}` })}
                      >
                        Move here
                      </Button>
                    </Stack>
                  );
                })}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                <Button size="small" onClick={() => { setReading({ point: p, hint: null }); setByHand(each); }}>
                  Place it by hand
                </Button>
                <Button
                  size="small" disabled={place.isPending}
                  onClick={() => place.mutate({ target: each, at: each, word: "kept at the list's point" })}
                >
                  Keep the list&apos;s point
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      </CardContent>
      {byHand && (
        <PointPreviewDialog
          open
          onClose={() => setByHand(null)}
          name={byHand.name ?? byHand.ref ?? 'Unnamed component'}
          latitude={byHand.latitude}
          longitude={byHand.longitude}
          correction={{
            place: {
              locationId: byHand.locationId, experienceId: item.id, objectName: item.name,
              name: byHand.name, latitude: byHand.latitude, longitude: byHand.longitude,
            },
            onDone: (message) => { setByHand(null); onDone(message, item.id); },
          }}
        />
      )}
    </Card>
  );
}
