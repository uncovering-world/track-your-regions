/**
 * What a gated object holds that no reader has been shown yet, and the way into
 * correcting each of it.
 *
 * The unread points and works under a museum readers already see (ADR-0025
 * decision 2 — the gate is on the content row, not only on its container). Its
 * own file since the two dialogs arrived (#583, #731): `WaitingToPublish.tsx`
 * had passed the length `docs/tech/development-guide.md` splits at, and this is
 * the half of the card that is about the object's *contents* rather than about
 * the object — the same seam `ContentsSection` was taken out of the Discover
 * panel along.
 *
 * **Keyed on the object by its caller**, which is what keeps an open dialog from
 * outliving the card it was opened from. `ReviewBench` mounts `GatedCard`
 * without a key on purpose — the object preview staying open as a curator works
 * down the queue is behaviour `ObjectPreview` is written around — so a card
 * moving to the next waiting row reconciles into the same instance, and a point
 * or a work held here would then be paired with the *new* card's id and name.
 * A key remounts this and React resets it, which is the same guarantee the card
 * makes for `openPart` by hand, without a second copy of the reasoning.
 */

import { useState } from 'react';
import { Divider, Stack, Typography } from '@mui/material';
import type { ReviewQueueItem } from '../../api/experiences';
import { plural } from '../../utils/plural';
import { claimLabel } from '../../utils/placeClaims';
import { claimLabel as workClaimLabel } from '../../utils/workClaims';
import { creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import { wikidataItemUrl, wikipediaArticleUrl } from '../../utils/wikidataLinks';
import { GatedRow } from './queueCard';
import { ContentsList } from '../shared/ContentsList';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { WorkPreviewDialog } from '../shared/WorkPreviewDialog';
import type { WorkToCorrect } from '../shared/WorkCorrection';

/** An unread point as the card lists it — the row a curator can open, and correct. */
type PendingPoint = NonNullable<ReviewQueueItem['pending_points']>[number];

export function GatedContents({ group, item, contents, points, works, onDone }: {
  /** The object the rows belong to: whose caches a correction clears, and whose name leads the outcome. */
  group: { id: number; name: string };
  /** The row the card is drawn from, for the object's name as the catalogue holds it. */
  item: { name: string };
  contents?: ReviewQueueItem;
  /** The whole counts, which the lists are capped below (`CONTENTS_ROWS_SHOWN`). */
  points: number;
  works: number;
  /** The page's refresh, and where a correction's outcome line goes. */
  onDone: (message?: string) => void;
}) {
  // Which unread row a curator opened, held as the row rather than as a flag —
  // and reset by this component's own key rather than by hand, as the docblock
  // above says.
  const [openPoint, setOpenPoint] = useState<PendingPoint | null>(null);
  const [openWork, setOpenWork] = useState<WorkToCorrect | null>(null);

  return (
    <>
      {/* Ruled like every other pair of rows on the card. On the card these two
          were direct children of its own divided `Stack`, so points and works had
          a rule between them; entering it as one child now, they would have had
          12px of whitespace where every neighbouring boundary is a line. The
          outer boundary still gets its rule from the parent, so nothing doubles. */}
      <Stack spacing={1.5} divider={<Divider flexItem />}>

          {points > 0 && (
            <GatedRow label="points">
              <Typography variant="body2">
                {plural(points, 'new point')} waiting — readers are shown the rest of this object
                without them.
              </Typography>
              <ContentsList
                total={points}
                shown={contents?.pending_points?.length ?? 0}
                noun="point"
                items={(contents?.pending_points ?? []).map(point => ({
                  id: point.id,
                  primary: point.name ?? point.externalRef ?? 'Unnamed point',
                  // The coordinate, and the word that says a curator has already
                  // corrected it — without which a moved pin reads as the source's.
                  secondary: [
                    point.latitude != null && point.longitude != null
                      ? `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`
                      : null,
                    claimLabel(point.curatedFields),
                  ].filter(Boolean).join(' · ') || null,
                  // A row with a coordinate opens in the point dialog, where it can
                  // be looked at and corrected; one without has nothing to show.
                  onOpen: point.latitude != null && point.longitude != null
                    ? () => setOpenPoint(point)
                    : undefined,
                }))}
              />
            </GatedRow>
          )}

          {works > 0 && (
            <GatedRow label="works">
              <Typography variant="body2">
                {plural(works, 'new work')} waiting — the museum itself is on show already.
              </Typography>
              <ContentsList
                total={works}
                shown={contents?.pending_works?.length ?? 0}
                noun="work"
                items={(contents?.pending_works ?? []).map(work => ({
                  id: work.id,
                  primary: work.name ?? 'Untitled',
                  // The same two doors every surface that shows a work to a curator
                  // opens (`WorkCard`): the name to the item, and the article resolved
                  // from it. Both answer nothing for a row an older server sends
                  // without the id, and the row reads as it did until then.
                  href: wikidataItemUrl(work.externalId),
                  article: wikipediaArticleUrl(work.externalId),
                  secondary: [
                    creatorsBrief(work.artists, work.artistsCurated),
                    yearLabel(work.year),
                    // What a curator already answered for on this work, so a
                    // corrected title does not read as the source's.
                    workClaimLabel(work.curatedFields),
                  ].filter(Boolean).join(', ') || null,
                  // A work a curator is looking at is a work they may correct:
                  // the row opens the same dialog every other surface opens,
                  // beside the two doors out rather than instead of them.
                  openLabel: 'Correct',
                  onOpen: () => setOpenWork({
                    treasureId: work.id,
                    experienceId: group.id,
                    museumName: item.name,
                    name: work.name ?? 'Untitled',
                    artists: work.artists,
                    artistsCurated: work.artistsCurated,
                    year: work.year,
                    imageUrl: work.imageUrl,
                    imageCredit: work.imageCredit,
                    venueCount: work.venueCount,
                    treasureType: work.treasureType,
                    externalId: work.externalId,
                  }),
                }))}
              />
            </GatedRow>
          )}
      </Stack>
      {/* The unread point a curator opened: the same dialog a held part opens, and the
          correction is offered because this is a place a curator is looking at. The
          outcome line goes where the card's other answers go. `onDone` is the page's
          refresh, so the row redraws with the corrected value. */}
      {openPoint && openPoint.latitude != null && openPoint.longitude != null && (
        <PointPreviewDialog
          open
          onClose={() => setOpenPoint(null)}
          name={openPoint.name ?? openPoint.externalRef ?? 'Unnamed point'}
          latitude={openPoint.latitude}
          longitude={openPoint.longitude}
          correction={{
            place: {
              locationId: openPoint.id,
              experienceId: group.id,
              objectName: item.name,
              name: openPoint.name,
              latitude: openPoint.latitude,
              longitude: openPoint.longitude,
              // An unread point is `pending`: readers see nothing of it, and the
              // anchor will not move for it, until it is published — the form and
              // the outcome say so, with publication as the remedy rather than
              // the withdrawn card's "false alarm".
              unseen: 'unread',
            },
            onDone,
          }}
        />
      )}
      {/* The unread work, in the dialog every surface that shows a curator a
          work opens. `onDone` is the page's refresh, so the row redraws with
          the corrected value. */}
      <WorkPreviewDialog
        work={openWork}
        onClose={() => setOpenWork(null)}
        onDone={onDone}
      />
    </>
  );
}

