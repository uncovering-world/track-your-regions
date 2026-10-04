/**
 * What has arrived under a visible object and no reader has been shown: the
 * works and the new points, one row each, each with its own answer (#524).
 *
 * The other half of the card — the held-changes table — asks about things
 * readers already see; this one asks about things they do not. Laid out the
 * same way, because it is the same decision made per row: what the row is, the
 * thing the run brought, and a publish or a no for that row alone. One doubtful
 * painting no longer holds back the eleven beside it, and one painting a
 * curator does not want no longer has to wait for a card-level no that would
 * take the eleven with it.
 *
 * A row says what it is in the stripe and the mark beside it: new to the
 * catalogue, or a work readers already see in another museum's list — new here
 * and not to the catalogue (Boy with Thorn, on show under the Capitoline
 * Museums' Art Museums row, arriving under their Archaeology row). A point that
 * replaces a stored pin is not here: it is a change to what readers see, and it
 * sits in the held-changes table as a group of its own (`movedPointGroups.ts`).
 *
 * A work opens one way, by its name, into the dialog every curator surface
 * opens it in. Its Wikipedia article comes first; the Wikidata item is the
 * small id beside it, which copies (`SourceId`).
 *
 * **Keyed on the object by its caller**, which is what keeps an open dialog from
 * outliving the card it was opened from: `ReviewBench` mounts `GatedCard`
 * without a key on purpose, so a card moving to the next waiting row reconciles
 * into the same instance, and a work held open here would then be paired with
 * the *new* card's id and name. A key remounts this and React resets it.
 */

import { useState } from 'react';
import {
  Box, Button, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import type { PublishRequest, RefuseContentsBody } from '../../api/curation';
import { plural } from '../../utils/plural';
import { claimLabel } from '../../utils/placeClaims';
import { claimLabel as workClaimLabel } from '../../utils/workClaims';
import { creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import { wikipediaArticleUrl } from '../../utils/wikidataLinks';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { WorkPreviewDialog } from '../shared/WorkPreviewDialog';
import type { WorkToCorrect } from '../shared/WorkCorrection';
import { SourceId } from './SourceId';

type PendingPoint = NonNullable<ReviewQueueItem['pending_points']>[number];
type PendingWork = NonNullable<ReviewQueueItem['pending_works']>[number];

/** Where a section holds this many rows, its heading offers one no for all of them. */
export const TURN_ALL_DOWN_FROM = 5;

const STRIPE = { new: 'success.main', elsewhere: 'info.main' } as const;

/** The museum readers already see an unread work in, other than this one — or null. */
export function shownElsewhere(work: PendingWork, here: number): { name: string; kind: string | null } | null {
  const shown = (work.venues ?? []).find(venue => venue.id !== here && venue.onShow);
  return shown ? { name: shown.name, kind: shown.kind ?? null } : null;
}

/** The heading's count: what arrived, by kind, and how much of it the list shows. */
export function arrivedHeading(works: number, points: number): string {
  const parts = [works > 0 ? plural(works, 'work') : null, points > 0 ? plural(points, 'new point') : null];
  return parts.filter(Boolean).join(', ');
}

function Mark({ tone, children }: { tone: keyof typeof STRIPE; children: string }) {
  return (
    <Typography component="span" sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: STRIPE[tone] }}>
      ● {children}
    </Typography>
  );
}

export function RowAnswer({ busy, onPublish, onRefuse, refuseNote }: {
  busy: boolean;
  onPublish: () => void;
  onRefuse: () => void;
  /** What the no does beyond settling the question, where it changes what readers see. */
  refuseNote?: string;
}) {
  return (
    <Stack spacing={0.5}>
      <Button size="small" variant="outlined" disabled={busy} onClick={onPublish}>publish this</Button>
      {/* "not this" as on the held rows: nobody has seen it, and a no keeps it
          that way and stops the asking — it comes back from the turned-down
          list at the foot of the page. */}
      <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={onRefuse}>not this</Button>
      {refuseNote && <Typography variant="caption" color="text.secondary">{refuseNote}</Typography>}
    </Stack>
  );
}

function Thumb({ work }: { work: PendingWork }) {
  const [failed, setFailed] = useState(false);
  const src = work.imageUrl ? toThumbnailUrl(extractImageUrl(work.imageUrl) ?? '', 120) : '';
  if (!src || failed) return <Box sx={{ width: 44, height: 56, flexShrink: 0 }} />;
  return (
    <Box sx={{ width: 64, flexShrink: 0 }}>
      <Box component="img" src={src} alt="" loading="lazy" onError={() => setFailed(true)}
        sx={{ width: 64, height: 56, objectFit: 'cover', borderRadius: 0.5, display: 'block' }} />
      {/* Under the picture that is on screen: a dense row, so only where the
          photographer is not the maker the row already names. */}
      <ImageCreditLine credit={work.imageCredit} redundantWith={work.artists} />
    </Box>
  );
}

/**
 * What "turn all N down" sends, or null where it cannot say only those N.
 *
 * A body naming nothing refuses every unread row under the object, and that
 * includes a point the source moved, whose refusal takes the stored pin off the
 * map (`releaseDeferredWithdrawals`, ADR-0053) — a row this table neither lists
 * nor counts. So the bare body goes only where no point moved; where one did,
 * the rows are named, which needs the whole list on the card, and a capped list
 * gets no such link: its rows are still answered one by one.
 */
function turnAllDownBody(
  contents: ReviewQueueItem | undefined,
  workRows: readonly PendingWork[],
  pointRows: readonly PendingPoint[],
  complete: boolean,
): RefuseContentsBody | null {
  if (Number(contents?.pending_moved_locations ?? 0) === 0) return {};
  if (!complete) return null;
  return {
    ...(workRows.length > 0 ? { treasureIds: workRows.map(work => work.id) } : {}),
    ...(pointRows.length > 0 ? { locationIds: pointRows.map(point => point.id) } : {}),
  };
}

export function ArrivedTable({ group, item, contents, works, points, busy, onPublish, onRefuse, onDone }: {
  /** The object the rows belong to: whose caches a correction clears, and whose name leads the outcome. */
  group: { id: number; name: string };
  item: { name: string };
  contents?: ReviewQueueItem;
  /** The whole counts of unread works and of new points (moves left out), which the lists are capped below. */
  works: number;
  points: number;
  busy: boolean;
  onPublish: (body: PublishRequest) => void;
  onRefuse: (body: RefuseContentsBody) => void;
  /** The page's refresh, and where a correction's outcome line goes. */
  onDone: (message?: string) => void;
}) {
  const [openPoint, setOpenPoint] = useState<PendingPoint | null>(null);
  const [openWork, setOpenWork] = useState<WorkToCorrect | null>(null);

  const workRows = contents?.pending_works ?? [];
  // A point that replaces a stored pin is a change, asked in the other table.
  const pointRows = (contents?.pending_points ?? []).filter(point => !point.replaces);
  const shown = workRows.length + pointRows.length;
  const total = works + points;
  if (total === 0) return null;
  const turnAllDown = total >= TURN_ALL_DOWN_FROM ? turnAllDownBody(contents, workRows, pointRows, shown === total) : null;

  const head = (text: string) => (
    <TableCell sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
      {text}
    </TableCell>
  );

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ py: 1 }}>
        <Typography variant="body2" color="text.secondary">Arrived, not shown to readers yet</Typography>
        <Typography variant="body2">{arrivedHeading(works, points)}</Typography>
        {shown < total && (
          <Typography variant="caption" color="text.secondary">{`the first ${shown} are listed`}</Typography>
        )}
        {turnAllDown && (
          <Link component="button" type="button" variant="body2" color="warning.main" disabled={busy}
            onClick={() => onRefuse(turnAllDown)} underline="hover">
            turn all {total} down
          </Link>
        )}
      </Stack>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ '& td, & th': { px: 1.5 }, minWidth: 640, maxWidth: 1180 }}>
          <TableHead>
            <TableRow>{head('What')}{head('The run brought')}{head('Your answer')}</TableRow>
          </TableHead>
          <TableBody>
            {workRows.map(work => {
              const elsewhere = shownElsewhere(work, group.id);
              const article = wikipediaArticleUrl(work.externalId);
              const name = work.name ?? 'Untitled';
              return (
                <TableRow key={`w${work.id}`} sx={{ verticalAlign: 'top' }}>
                  <TableCell sx={{ borderLeft: '3px solid', borderLeftColor: STRIPE[elsewhere ? 'elsewhere' : 'new'], width: 190 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{elsewhere ? 'work' : 'new work'}</Typography>
                    <Mark tone={elsewhere ? 'elsewhere' : 'new'}>{elsewhere ? 'already on show elsewhere' : 'new to the catalogue'}</Mark>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1.25} alignItems="flex-start">
                      <Thumb work={work} />
                      <Box sx={{ minWidth: 0 }}>
                        {/* The one door to a work on this card: its name opens the dialog. */}
                        <Link component="button" type="button" variant="body2" color="inherit" underline="hover"
                          sx={{ fontWeight: 600, textAlign: 'left' }}
                          onClick={() => setOpenWork({
                            treasureId: work.id, experienceId: group.id, museumName: item.name, name,
                            artists: work.artists, artistsCurated: work.artistsCurated, year: work.year,
                            imageUrl: work.imageUrl, imageCredit: work.imageCredit, venueCount: work.venueCount,
                            venues: work.venues, treasureType: work.treasureType, externalId: work.externalId,
                          })}>
                          {name}
                        </Link>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {[creatorsBrief(work.artists, work.artistsCurated), yearLabel(work.year), work.treasureType,
                            workClaimLabel(work.curatedFields)].filter(Boolean).join(' · ')}
                        </Typography>
                        {elsewhere && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {`readers see it in ${elsewhere.name}`}
                            {elsewhere.kind && ` (${elsewhere.kind})`}
                          </Typography>
                        )}
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                          {article && (
                            <Link href={article} target="_blank" rel="noopener noreferrer" variant="caption"
                              aria-label={`Wikipedia article for ${name}`}>
                              Wikipedia
                            </Link>
                          )}
                          {work.externalId && <SourceId id={work.externalId} kind="work" />}
                          {typeof work.sitelinks === 'number' && (
                            <Typography variant="caption" color="text.secondary">
                              {plural(work.sitelinks, 'Wikipedia edition')}
                            </Typography>
                          )}
                        </Stack>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ width: 150 }}>
                    <RowAnswer busy={busy} onPublish={() => onPublish({ treasureIds: [work.id] })}
                      onRefuse={() => onRefuse({ treasureIds: [work.id] })} />
                  </TableCell>
                </TableRow>
              );
            })}
            {pointRows.map(point => {
              const name = point.name ?? point.externalRef ?? 'Unnamed point';
              const located = point.latitude != null && point.longitude != null;
              return (
                <TableRow key={`p${point.id}`} sx={{ verticalAlign: 'top' }}>
                  <TableCell sx={{ borderLeft: '3px solid', borderLeftColor: STRIPE.new, width: 190 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>new point</Typography>
                    <Mark tone="new">new to this object</Mark>
                  </TableCell>
                  <TableCell>
                    {located
                      ? (
                        <Link component="button" type="button" variant="body2" color="inherit" underline="hover"
                          sx={{ fontWeight: 600 }} onClick={() => setOpenPoint(point)}>
                          {name}
                        </Link>
                      )
                      : <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>}
                    <Typography variant="caption" color="text.secondary" display="block">
                      {[located ? `${point.latitude!.toFixed(4)}, ${point.longitude!.toFixed(4)}` : null,
                        claimLabel(point.curatedFields)].filter(Boolean).join(' · ')}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ width: 150 }}>
                    <RowAnswer busy={busy} onPublish={() => onPublish({ locationIds: [point.id] })}
                      onRefuse={() => onRefuse({ locationIds: [point.id] })} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* The point a curator opened: the same dialog a held part opens, and the
          correction is offered because this is a place a curator is looking at.
          An unread point is `pending`: readers see nothing of it until it is
          published, which the form says. */}
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
              unseen: 'unread',
            },
            onDone,
          }}
        />
      )}
      <WorkPreviewDialog work={openWork} onClose={() => setOpenWork(null)} onDone={onDone} />
    </Box>
  );
}
