/**
 * The points and works a curator turned down, and the way back from each (#859).
 *
 * The third answered block at the foot of the review page, and the one ADR-0053
 * left owing: turning down unread contents was the only answer on the page with
 * no take-back, because a refused part is on no screen at all — readers never saw
 * it, and the mark took it out of every question. A mis-click could be found only
 * in the curation log.
 *
 * Shaped like `AnsweredWithdrawalCard` beside it, for the same reason it is
 * shaped that way: one card per object, its parts listed inside, each with the
 * one answer that undoes what was done to it. Both kinds are here because both
 * can be turned down in one click and a curator asking again does not think in
 * tables — but they are labelled apart, since a point comes back to the map and
 * a work comes back to a wall.
 */

import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Divider, Link, Stack, Typography,
} from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import { useMutation } from '@tanstack/react-query';
import { type ReviewQueueItem, unrefuseContents } from '../../api/experiences';
import { formatDateTime } from '../../utils/dateFormat';
import { plural } from '../../utils/plural';
import { claimLabel } from '../../utils/placeClaims';
import { claimLabel as workClaimLabel } from '../../utils/workClaims';
import { creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import { wikidataItemUrl, wikipediaArticleUrl } from '../../utils/wikidataLinks';
import { worldViewList } from '../../utils/worldViewList';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import type { UnseenReason } from '../shared/PointCorrection';
import { GatedRow, ItemHeader, messageFor } from './queueCard';
import { HelpHint } from './HelpHint';

/**
 * What decides whether the take-back is offered, and which question to name where
 * it is not — declared once, so a caller cannot supply less than the behaviour
 * turns on. `missing_since` is deliberately absent: it was the gate in an earlier
 * revision, and leaving it in the type let a test pass an object with only that
 * field, take the unblocked branch and assert the wrong caption.
 */
type BlockingFacts = Pick<
  ReviewQueueItem, 'takeable' | 'object_admission' | 'object_curation_state'
>;

type RefusedPoint = NonNullable<ReviewQueueItem['refused_points']>[number];
type RefusedWork = NonNullable<ReviewQueueItem['refused_works']>[number];
type OnDone = (message?: string, experienceId?: number) => void;
type TakeBack = Awaited<ReturnType<typeof unrefuseContents>>;

/** A part's name as a curator would say it, the way the withdrawn card says a point's. */
export function partTitle(part: { name: string | null; externalRef?: string | null }): string {
  if (part.name) return part.name;
  if (part.externalRef) return `The part the source calls ${part.externalRef}`;
  return 'An unnamed part';
}

/**
 * Who turned it down and when, and what they wrote.
 *
 * "a curator" where the name is missing, which happens for two different reasons
 * and reads the same either way: the act belongs to a region this reader does not
 * cover, or it was one of a batch answered before the log carried a name for it.
 * Somebody still decided, and saying so is more honest than an empty line.
 */
export function refusedLine(part: { refusedAt: string | null; refusedBy: string | null; note: string | null }): string {
  const when = part.refusedAt ? ` on ${formatDateTime(part.refusedAt)}` : '';
  const who = ` by ${part.refusedBy ?? 'a curator'}`;
  const note = part.note ? ` — “${part.note}”` : '';
  return `Turned down${when}${who}${note}.`;
}

/**
 * Where the source has stopped listing the part since it was turned down.
 *
 * Worth a line of its own, because it changes what asking again means: the
 * question comes back, the offer does not, and the next run will not propose it.
 * The part is on this list at all — rather than under lost places — because a
 * turned-down part is always unread, and the lost-places card asks for a state
 * an unread part never has.
 */
export function droppedBySourceLine(part: { missingSince: string | null }): string | null {
  if (!part.missingSince) return null;
  return `The source stopped listing it on ${formatDateTime(part.missingSince)}. `
    + 'Asking again brings the question back, not the offer.';
}

/**
 * What the take-back did, in the words the refusal's own line uses backwards.
 *
 * Says where the part went rather than that it succeeded: a curator who has just
 * asked about a point again needs to know it is a question once more and not that
 * anybody can see it — the take-back restores the question, never the answer.
 */
export function askedAgainOutcome(
  objectName: string, data: TakeBack | undefined, stillOffered = true,
): string {
  const points = data?.locationsRestored ?? 0;
  const works = data?.treasureLinksRestored ?? 0;
  const parts = [
    points > 0 ? plural(points, 'point') : null,
    works > 0 ? plural(works, 'work') : null,
  ].filter(Boolean).join(' and ');
  const counted = whatFollows(stillOffered, points > 0);
  // Where the re-placement failed: named for an admin through the helper every
  // other placement line uses, since a curator cannot re-assign anything.
  const stale = data?.placementFailed
    ? ` ${objectName} could not be re-placed into ${worldViewList(data.placementFailedWorldViews)} — tell an admin.`
    : '';
  return `${parts || 'Nothing'} under ${objectName} is asked about again.${counted}${stale}`;
}

/**
 * What follows the mark coming off, which the source's answer decides.
 *
 * Not cosmetic: placement's insert carries `missing_since IS NULL`, and the
 * contents card and the publish both compose `offeredLocationSql` beside the
 * unread test. For a part the source has dropped, "counts toward its regions
 * again" and "publishing shows it" are both false — the question goes back on
 * the record and nothing else moves.
 */
function whatFollows(stillOffered: boolean, aPointCameBack: boolean): string {
  if (!stillOffered) {
    return ' The question is back on record. The source no longer offers it, so nothing '
      + 'will show it until the source lists it again.';
  }
  if (aPointCameBack) {
    return ' The point counts toward its regions again, and publishing it is what shows it.';
  }
  return ' Publishing it is what shows it.';
}

/**
 * Why the take-back is not offered, where it is not — read before the button.
 *
 * The writer refuses outright on an object the source has stopped offering, so a
 * button here would 409 with nothing the curator can act on from this card. The
 * object's own question is the one to answer first, and saying that is better
 * than gating the list on it: gated, the parts would be back on no screen at all,
 * which is what this module exists to prevent.
 */
export function blockedByObject(item: BlockingFacts): string | null {
  // The verdict is the server's — `takeable` is its own precondition, evaluated by
  // the same fragment the writer reads under the lock. What is decided here is only
  // which of the three questions to name, and each of them has its own card.
  if (item.takeable !== false) return null;
  if (item.object_curation_state === 'pending') {
    return 'Nobody has passed this place yet. Answer its arrival first — publishing it '
      + 'takes its contents with it, so these are not the question to answer now.';
  }
  if (item.object_admission === 'refused') {
    return 'This place has been kept out. Put it back first — until it is back, '
      + 'nothing under it can be asked about again.';
  }
  return 'The source has stopped listing this place. Answer that question first — until '
    + 'it is answered, nothing under it can be asked about again.';
}

/** What pressing the button will actually do, which the source's answer decides. */
export function takeBackCaption(
  item: BlockingFacts, part: { missingSince: string | null }, noun: string,
): string {
  const blocked = blockedByObject(item);
  if (blocked) return blocked;
  if (part.missingSince) {
    return 'Puts the question back on record. The source no longer offers it, so nothing '
      + 'will show it until the source lists it again.';
  }
  return noun === 'point'
    ? 'Puts it back on the contents card. Publishing it is what shows it.'
    : 'Asks about this work here. It was never turned down anywhere else.';
}

const TAKE_BACK_HELP = 'These are answered, so they are not waiting on you. They are here '
  + 'because a point or work you turned down is on no other screen: readers never saw it, and '
  + 'turning it down took it out of every question — so if one of these was a mis-click, this '
  + 'is where it comes back. Asking about one again puts the question back and nothing else: '
  + 'it returns to the object’s contents card, where publishing it is still what shows it to '
  + 'anyone. A point counts toward its regions again from that moment, since an unread point '
  + 'counts its object into a region and a turned-down one does not — unless the source has '
  + 'stopped listing the part since, which its own row says: then the question comes back and '
  + 'nothing else does, because neither the contents card nor the publish nor the placement '
  + 'reaches a part the source no longer offers. What it will not undo is '
  + 'a pin the refusal took off the map: where the point was replacing another, that other one '
  + 'is a lost-places question of its own now, with its own two answers, and it stays one.';

/** One turned-down point, its place, and the one answer that undoes the refusal. */
function RefusedPointRow({ item, point, onDone }: {
  item: ReviewQueueItem;
  point: RefusedPoint;
  onDone: OnDone;
}) {
  const [showMap, setShowMap] = useState(false);
  const hasPoint = typeof point.latitude === 'number' && typeof point.longitude === 'number';

  const askAgain = useMutation({
    mutationFn: () => unrefuseContents(item.id, { locationIds: [point.id] }),
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error)
        : askedAgainOutcome(item.name, data, point.missingSince === null), item.id),
  });
  const blocked = blockedByObject(item) !== null;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">{partTitle(point)}</Typography>
      <Typography variant="body2" color="text.secondary">{refusedLine(point)}</Typography>
      {droppedBySourceLine(point) && (
        <Typography variant="caption" color="text.secondary" display="block">
          {droppedBySourceLine(point)}
        </Typography>
      )}
      {claimLabel(point.curatedFields) && (
        <Typography variant="caption" color="text.secondary" display="block">
          {claimLabel(point.curatedFields)} — the source no longer overwrites it.
        </Typography>
      )}

      {point.visited && (
        <Alert severity="info" sx={{ mt: 1, py: 0 }}>
          Someone has been here. Their record is kept whatever you decide — it is the spot
          that stops being shown, not the visit.
        </Alert>
      )}

      {hasPoint && (
        <>
          <Button
            size="small"
            startIcon={<PlaceIcon fontSize="small" />}
            onClick={() => setShowMap(true)}
            sx={{ p: 0, minWidth: 0, textTransform: 'none', mt: 0.5 }}
          >
            See where it is
          </Button>
          <PointPreviewDialog
            open={showMap}
            onClose={() => setShowMap(false)}
            name={partTitle(point)}
            latitude={point.latitude as number}
            longitude={point.longitude as number}
            correction={{
              place: {
                locationId: point.id,
                experienceId: item.id,
                objectName: item.name,
                name: point.name,
                latitude: point.latitude as number,
                longitude: point.longitude as number,
                // Which of three things is true of this point, so the dialog's own
                // sentence agrees with the button behind it rather than naming a
                // step this card has disabled.
                unseen: unseenFor(item, point),
              },
              onDone: (message) => onDone(message, item.id),
            }}
          />
        </>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          disabled={askAgain.isPending || blocked}
          onClick={() => askAgain.mutate()}
        >
          Ask about it again
        </Button>
        <Typography variant="caption" color="text.secondary">
          {takeBackCaption(item, point, 'point')}
        </Typography>
      </Stack>
    </Box>
  );
}

/** One turned-down work link, and the answer that puts the work back in question here. */
function RefusedWorkRow({ item, work, onDone }: {
  item: ReviewQueueItem;
  work: RefusedWork;
  onDone: OnDone;
}) {
  const askAgain = useMutation({
    mutationFn: () => unrefuseContents(item.id, { treasureIds: [work.id] }),
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error)
        : askedAgainOutcome(item.name, data, work.missingSince === null), item.id),
  });
  const blocked = blockedByObject(item) !== null;

  const about = [
    creatorsBrief(work.artists, work.artistsCurated),
    yearLabel(work.year),
    workClaimLabel(work.curatedFields),
  ].filter(Boolean).join(', ');

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">
        {/* The same door every surface that shows a work to a curator opens: the
            name to the item it came from. Absent on a row an older server sends
            without the id, where the name is text as it was until then. */}
        {wikidataItemUrl(work.externalId) ? (
          <Link
            href={wikidataItemUrl(work.externalId) as string}
            target="_blank"
            rel="noopener noreferrer"
            color="inherit"
          >
            {work.name ?? 'Untitled'}
          </Link>
        ) : (work.name ?? 'Untitled')}
      </Typography>
      {about && (
        <Typography variant="caption" color="text.secondary" display="block">{about}</Typography>
      )}
      <Typography variant="body2" color="text.secondary">{refusedLine(work)}</Typography>
      {droppedBySourceLine(work) && (
        <Typography variant="caption" color="text.secondary" display="block">
          {droppedBySourceLine(work)}
        </Typography>
      )}
      {wikipediaArticleUrl(work.externalId) && (
        <Link
          variant="caption"
          href={wikipediaArticleUrl(work.externalId) as string}
          target="_blank"
          rel="noopener noreferrer"
          color="inherit"
          aria-label={`Wikipedia article for ${work.name ?? 'Untitled'}`}
        >
          Wikipedia
        </Link>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          disabled={askAgain.isPending || blocked}
          onClick={() => askAgain.mutate()}
        >
          Ask about it again
        </Button>
        <Typography variant="caption" color="text.secondary">
          {/* The mark is on the link, never on the work (ADR-0053): turning it down
              said "not this work here", and so does taking it back. */}
          {takeBackCaption(item, work, 'work')}
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * Why readers do not see this point, as the correction dialog states it.
 *
 * Three answers rather than one, and the reason is that they name different next
 * steps: normally the mark comes off and publishing shows it; where the source has
 * dropped the part, that sequence is a promise nothing can keep; where the object
 * itself is the open question, the take-back is refused outright and the caption
 * beside the disabled button already says so. A single sentence would contradict
 * the button on the same screen in two of the three.
 */
function unseenFor(
  item: BlockingFacts, part: { missingSince: string | null },
): UnseenReason {
  if (blockedByObject(item)) return 'blocked';
  return part.missingSince ? 'dropped' : 'refused';
}

/** The cap said rather than implied, per kind — the rule this list's neighbours share. */
function capLine(shown: number, total: number, noun: string): string | null {
  return total > shown ? `The ${shown} most recently turned down of ${plural(total, noun)}.` : null;
}

export function RefusedPartsCard({ item, onDone }: {
  item: ReviewQueueItem;
  onDone: OnDone;
}) {
  const points = item.refused_points ?? [];
  const works = item.refused_works ?? [];
  const pointsTotal = item.refused_points_total ?? points.length;
  const worksTotal = item.refused_works_total ?? works.length;

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <Stack spacing={1.5} divider={<Divider flexItem />}>
          {points.length > 0 && (
            <GatedRow label="points">
              {capLine(points.length, pointsTotal, 'point') && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {capLine(points.length, pointsTotal, 'point')}
                </Typography>
              )}
              {points.map(point => (
                <RefusedPointRow key={point.id} item={item} point={point} onDone={onDone} />
              ))}
            </GatedRow>
          )}
          {works.length > 0 && (
            <GatedRow label="works">
              {capLine(works.length, worksTotal, 'work') && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {capLine(works.length, worksTotal, 'work')}
                </Typography>
              )}
              {works.map(work => (
                <RefusedWorkRow key={work.id} item={item} work={work} onDone={onDone} />
              ))}
            </GatedRow>
          )}
        </Stack>
        <HelpHint text={TAKE_BACK_HELP} label="why turned-down parts are listed here" />
      </CardContent>
    </Card>
  );
}
