/**
 * Whether an experience card can be opened at the size it will keep.
 *
 * A card's height is measured by the virtualiser, so anything that arrives after
 * it opens moves every row below it. Three things arrive late: the details query
 * (a line of metadata, measured at 32 px, 337 ms after the click), the contents
 * query (an artworks list, which can be twenty rows), and the picture (250 px,
 * measured at 1.3 s). Opening first and filling in afterwards is what makes the
 * list shuffle under a reader.
 *
 * So the card waits until all three have settled and then opens once. Settled,
 * not succeeded: most of these pictures never arrive — of 1604 experiences, 1260
 * carry a `whc.unesco.org/document/<id>` url that answers 403 at the source and
 * 404 through the thumbnail proxy (#557) — and a failure answers as quickly as a
 * success, so waiting for the answer costs nothing where there is nothing to show.
 *
 * The wait is capped — including for the locations batch, which is why that term
 * belongs here rather than beside the condition that mounts the card. A request
 * that hangs must not leave a reader clicking a row that never opens, so past the
 * cap the card opens with whatever it has; a picture landing after that appends,
 * which is the old behaviour and the lesser evil.
 *
 * A hovered row shortens the wait rather than removing it: the row warms the
 * picture alone, so the two queries still have to answer — about 150 ms against
 * the picture's 1.3 s. Warming the queries too was tried and removed, because they
 * share `publicReadLimiter` with the reads that draw the list itself.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { experienceContentsQuery, experienceDetailsQuery } from '../api/experienceCardQueries';
import { cardImageUrl, isImageSettled, preloadImage } from '../utils/imagePreload';

/** How long a card may wait for its parts before opening incomplete. */
const READY_CAP_MS = 1500;

export function useExperienceCardReady(
  experienceId: number,
  rawImageUrl: string | null | undefined,
  enabled: boolean,
  /**
   * The region's locations batch, which decides a fourth part of the height: the
   * points panel, the `n/N in region` chip and the visited button are all absent
   * until it lands. One request serves the whole region, so a reader who opens a
   * multi-location row while it is still in flight would otherwise get a card that
   * looks complete and then grows a list of points.
   */
  locationsSettled = true,
): boolean {
  // Same keys the card itself reads, so this starts the requests rather than
  // duplicating them, and the card finds them done.
  const details = useQuery({ ...experienceDetailsQuery(experienceId), enabled });
  const contents = useQuery({ ...experienceContentsQuery(experienceId), enabled });

  const imageUrl = cardImageUrl(rawImageUrl);

  // Both answers below are *derived* from the card being asked about, never
  // stored as a bare yes. Today that is belt and braces: there is one instance per
  // mounted row, each with `enabled = isSelected`, so moving from one card to
  // another is one instance going false and another going true, and there is no
  // previous answer to carry anywhere. It was not always so — an earlier revision
  // kept a second instance for "the selection", where a latch keyed to `enabled`
  // did carry one card's answer into the next — and deriving costs nothing while
  // surviving the next caller who tries that again.
  const [settledUrl, setSettledUrl] = useState<string | null>(null);
  const imageSettled = !imageUrl || settledUrl === imageUrl || isImageSettled(imageUrl);
  useEffect(() => {
    if (!imageUrl || isImageSettled(imageUrl)) return;
    // The fetch waits for the card to be asked for: starting it here regardless
    // would preload every row the window holds, which is the request storm the
    // hover-rest rule in `ExperienceListItem` avoids.
    if (!enabled) return;
    let cancelled = false;
    preloadImage(imageUrl).finally(() => { if (!cancelled) setSettledUrl(imageUrl); });
    return () => { cancelled = true; };
  }, [enabled, imageUrl]);

  // The cap belongs to one experience, not to "a card is open": a reader who
  // waited out a slow card and then chose another must not have the second one
  // declared ready on the first one's expired patience.
  const [cappedFor, setCappedFor] = useState<number | null>(null);
  const capReached = cappedFor === experienceId;
  useEffect(() => {
    // Cleared on close, not merely ignored: a closed card must not carry its
    // expired patience back into its next opening and be declared ready before
    // anything about it has been asked.
    if (!enabled) { setCappedFor(null); return; }
    const timer = setTimeout(() => setCappedFor(experienceId), READY_CAP_MS);
    return () => clearTimeout(timer);
  }, [enabled, experienceId]);

  if (!enabled) return false;
  if (capReached) return true;
  return !details.isPending && !contents.isPending && imageSettled && locationsSettled;
}
