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
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { plural } from '../../utils/plural';
import { claimLabel } from '../../utils/placeClaims';
import { claimLabel as workClaimLabel } from '../../utils/workClaims';
import { creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import { wikidataItemUrl, wikipediaArticleUrl } from '../../utils/wikidataLinks';
import { moveLabel } from '../../utils/moveDescription';
import { GatedRow } from './queueCard';
import { ContentsList } from '../shared/ContentsList';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { WorkPreviewDialog } from '../shared/WorkPreviewDialog';
import type { WorkToCorrect } from '../shared/WorkCorrection';

/** An unread point as the card lists it — the row a curator can open, and correct. */
type PendingPoint = NonNullable<ReviewQueueItem['pending_points']>[number];
type PendingWork = NonNullable<ReviewQueueItem['pending_works']>[number];

/**
 * What the unread points are, in one sentence — and a point that moved is not a
 * point that arrived.
 *
 * A gated run that finds a point somewhere else keeps the stored pin and writes
 * the new position as an unread point naming the one it replaces
 * (`locationWriter.ts`), so the object does not vanish from the map while the
 * move waits. Counted as "1 new point" it reads as a second place — Ephesus,
 * whose one point run 146 moved 158 m, read as a site made of two.
 */
export function pointsSentence(points: number, moved: number): string {
  const arrived = points - moved;
  if (moved === 0) {
    return `${plural(points, 'new point')} waiting — readers are shown the rest of this object without them.`;
  }
  if (arrived === 0) {
    return `${plural(moved, 'point')} moved — readers see the old position until you publish.`;
  }
  return `${plural(arrived, 'new point')} waiting and ${plural(moved, 'point')} moved — readers are shown `
    + 'the rest of this object without the new ones, and a moved point at its old position.';
}

/**
 * What the unread works are — and a work readers already see in another museum is
 * new to this list, not to the catalogue.
 *
 * The gate is on the link as well as on the work (ADR-0025 decision 2), so a work
 * long on show in one museum arrives unread in another that also holds it. Until a
 * place several kinds admit is one row (#755) that other museum is often the same
 * one: Boy with Thorn, on show under the Art Museums row of the Capitoline Museums,
 * arrived unread under their Archaeology row.
 */
export function worksSentence(works: number, onShow: number): string {
  const fresh = works - onShow;
  if (onShow === 0) return `${plural(works, 'new work')} waiting — the museum itself is on show already.`;
  if (fresh === 0) {
    return `${plural(works, 'work')} waiting that readers already see in another list — `
      + `publishing adds ${works === 1 ? 'it' : 'them'} to this one.`;
  }
  return `${plural(fresh, 'new work')} waiting, and ${plural(onShow, 'work')} readers already see in `
    + 'another list — the museum itself is on show already.';
}

/** Where readers already see an unread work, as its row says it — or null where they see it nowhere. */
function shownElsewhere(work: PendingWork, here: number): string | null {
  const [shown] = (work.venues ?? []).filter(venue => venue.id !== here && venue.onShow);
  if (!shown) return null;
  const kind = shown.kind ? ` (${shown.kind})` : '';
  return `already on show in ${shown.name}${kind}`;
}

/** How far an unread point is from the stored one it replaces, or null for a point that arrived. */
function movedFrom(point: PendingPoint): string | null {
  if (!point.replaces || point.latitude == null || point.longitude == null) return null;
  const move = moveLabel(
    { lon: point.replaces.longitude, lat: point.replaces.latitude },
    { lon: point.longitude, lat: point.latitude },
  );
  return move ? `moved ${move} from the position readers see` : null;
}

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
                {pointsSentence(points, Number(contents?.pending_moved_locations ?? 0))}
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
                    movedFrom(point),
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
                {worksSentence(works, Number(contents?.pending_treasures_on_show ?? 0))}
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
                    shownElsewhere(work, group.id),
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
                    venues: work.venues,
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

