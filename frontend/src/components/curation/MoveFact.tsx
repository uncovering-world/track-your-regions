/**
 * A proposed coordinate on a review card: the numbers, and the move on a map.
 *
 * The coordinates row prints the stored point, the proposed one and how far apart
 * they are. Whether the new point is the better one is not in those numbers — it
 * is in what lies under each of them — so the proposed side opens the place's own
 * dialog on the move: both pins and the arrow between them (`PointPreviewDialog`'s
 * `movedTo`). One map at a time, since the dialog mounts nothing while closed.
 */

import { useState } from 'react';
import { Box, Link } from '@mui/material';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';

interface Point {
  latitude: number;
  longitude: number;
}

/** A changeset coordinate (`{ lat, lon }`) as the dialog takes a point, or undefined where it is not one. */
function pointOf(value: unknown): Point | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { lat, lon } = value as { lat?: unknown; lon?: unknown };
  return typeof lat === 'number' && typeof lon === 'number' ? { latitude: lat, longitude: lon } : undefined;
}

/**
 * The coordinate a card's proposal would move the object to, where it proposes one.
 * The fields are typed by what is read of them: the vocabulary (`fieldMeaning.tsx`)
 * renders this component, and importing its field type back would close a cycle.
 */
export function proposedPoint(
  proposed: ReadonlyArray<{ field: string; new?: unknown }> | null | undefined,
): Point | undefined {
  return pointOf(proposed?.find(field => field.field === 'location')?.new);
}

export function MoveFact({ before, after, label }: {
  /** The stored coordinate and the proposed one, as the changeset carries them. */
  before: unknown;
  after: unknown;
  /** The proposed coordinate as the row prints it. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const from = pointOf(before);
  const to = pointOf(after);
  if (!from || !to) return <>{label}</>;
  return (
    <>
      {label}
      <Box component="span" sx={{ mx: 0.75, color: 'text.disabled' }}>·</Box>
      <Link component="button" type="button" variant="body2" underline="hover" onClick={() => setOpen(true)}>
        see the move on the map
      </Link>
      <PointPreviewDialog
        open={open}
        onClose={() => setOpen(false)}
        name="The proposed move"
        latitude={from.latitude}
        longitude={from.longitude}
        movedTo={to}
      />
    </>
  );
}
