/**
 * The parts of an object the source stopped offering, one verdict each — and, below the
 * card that asks, the list of the verdicts already given.
 *
 * A withdrawn point has been recorded since ADR-0022 and asked about nowhere: the row
 * carries `missing_since`, every reader-facing read hides it, and no screen said so. The
 * catalogue's first one was marked on 2026-08-10 and had no screen to be answered on
 * until this card — which is the gap, rather than the count.
 *
 * The count was zero on the database this was written against, and the reason is worth
 * knowing before reading a card here: that first withdrawal was a false positive, a
 * coordinate rewritten 1.2 cm more precisely (#543), and ADR-0027 absorbs the class from
 * now on. What it does not do is guarantee that every card here is a real departure —
 * `db/migrations/026` collapses the pairs already written, but deliberately leaves
 * standing any whose old row carries a visit or a region assignment, since re-pointing a
 * traveller's record by migration would be a second guess about where they stood. Those
 * reach this card with a distance anywhere up to ten metres — the band the writer now
 * forgives — which is what `withdrawalStory`'s "same place written more precisely"
 * sentence is for, and why it splits at ten rather than at one. A pair three metres apart
 * that a visit kept standing is a rewrite, not a move, and a card calling it a move would
 * be wrong about the only thing it is for. Nor is such a card only about pairs written in
 * the past: answering one "false alarm" clears `missing_since` and leaves two visible rows
 * a centimetre apart under one reference, so the next run pairs one and withdraws the
 * other, and the card returns. Honest each time and unsettleable here — settling it means
 * deciding which of two rows a traveller's record belongs to, and no card in this file
 * asks that. **Not** what `AnsweredWithdrawalCard` below does either, which is worth
 * saying because this note used to point forward at #544 as the place it would be
 * settled: that list takes a verdict back, on the row it was given about, and the loop
 * comes round again after it exactly as before.
 *
 * Those two are not the whole list, and the list is not the thing to memorise: the backend
 * comment above the subquery filling `replacedMetres` enumerates every route a short
 * distance takes to get here, and it has grown twice as the writer changed. What holds
 * regardless is the rule this card is built on — inside ten metres the source is describing
 * the same place, so the card says so, whatever brought the pair about.
 *
 * Grouped by object because the queue is a list of objects and a serial site can lose
 * two parts in one run; answered per point because that is what the verdict is about.
 *
 * The card's job is to make the answer decidable without leaving the page, which for a
 * point means three facts: where it was, whether the source now lists the same part
 * somewhere else — a moved point is a withdrawal plus an arrival, so this is the
 * difference between "gone" and "moved" — and whether anyone had been there.
 */

import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Divider, Stack, TextField, Typography,
} from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import { useMutation } from '@tanstack/react-query';
import { setLocationState, type ReviewQueueItem } from '../../api/experiences';
import { formatDateTime } from '../../utils/dateFormat';
import { worldViewList } from '../../utils/worldViewList';
import { ItemHeader, messageFor } from './queueCard';
import { PointPreviewDialog } from './PointPreviewDialog';
import { HelpHint } from './HelpHint';

type WithdrawnPoint = NonNullable<ReviewQueueItem['withdrawn_points']>[number];

/**
 * What to call a part that has no name.
 *
 * Most UNESCO components carry a reference and no name of their own, and Bilbao's
 * withdrawn point carries only `Q127064` — so a card headed by the name alone would
 * head most of them with nothing at all.
 */
export function pointTitle(point: { name: string | null; externalRef: string | null }): string {
  if (point.name) return point.name;
  if (point.externalRef) return `The part the source calls ${point.externalRef}`;
  return 'An unnamed part';
}

/**
 * A distance a person reads, not a float: 1 cm and 40 km are both "how far".
 *
 * Whole units, so what it prints is not what was measured — Bilbao's 1.2 cm arrives as
 * `0.01` through the query's `round(…, 2)` and reads out as "1 cm". Deliberate: the
 * decision this serves is a corrected coordinate against a real move, and no arm of that
 * turns on a millimetre.
 */
function distanceLabel(metres: number): string {
  if (metres < 1) return `${Math.round(metres * 100)} cm`;
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${Math.round(metres / 1000)} km`;
}

/**
 * The distance inside which a rewrite is the same place, not a move (ADR-0027 decision 2).
 *
 * The backend's `LOCATION_UNCHANGED_METERS`, repeated rather than imported because the
 * frontend cannot reach `backend/src`. It has to track that number: this card's whole job
 * is to tell a corrected coordinate from a real move, and a card splitting at a different
 * distance from the writer would call a rewrite the writer forgave a move.
 *
 * Inclusive, matching the `ST_DWithin` the writer and migration 026 both use.
 */
const SAME_POINT_METRES = 10;

/**
 * What happened, in the words a curator can act on.
 *
 * Three cases, and the first two are the reason this is a distance rather than a flag.
 * Bilbao's replacement sits **1.2 cm** from the point it replaced, which this card reads
 * out as "1 cm": the stored latitude had been rounded to six decimals and a later run
 * wrote the source's own value, so nothing moved and a card saying "it moved" would have
 * been wrong about the one thing it was for. A part that really did move reads the same sentence with a number that means it.
 * Where nothing replaced it, the source's list is genuinely one part shorter.
 */
export function withdrawalStory(point: WithdrawnPoint, offeredLocations: number): string {
  const metres = point.replacedMetres;
  if (metres !== null && metres <= SAME_POINT_METRES) {
    return `The source still lists this part, ${distanceLabel(metres)} from here — that is the `
      + 'same place written more precisely, not a move. Readers never lost it.';
  }
  if (metres !== null) {
    return `The source lists this same part ${distanceLabel(metres)} away now, so it moved `
      + 'rather than went. Readers already see the new spot.';
  }
  if (offeredLocations === 0) {
    return 'Nothing replaced it, and the object has no other place left — so it is now on no '
      + 'map at all.';
  }
  return 'Nothing replaced it: the source’s list is one part shorter than it was.';
}

const HELP = 'A run offered the object without this part, so it was marked rather than deleted — '
  + 'deleting it would have taken anyone’s record of having been there with it. Readers stopped '
  + 'seeing it the moment it was marked, and that does not change when you answer: "dropped" and '
  + '"no longer exists" both leave it hidden, and differ in what we are recording — one is about '
  + 'the source’s list, the other about the world. Only "false alarm" puts it back on the map.';

/**
 * What to tell a curator when the verdict landed and the regions did not.
 *
 * Through `worldViewList`, like every other placement report: an admin fixes this per
 * world view, so the sentence has to name them — and it has to carry their ids, because
 * a curator reporting "Base layer" and an admin searching for a world view id are the
 * two halves of one handover. A list derived here instead would drop them.
 */
export function placementNotice(
  item: { name: string },
  data?: { placementFailed?: true; placementFailedWorldViews?: Array<{ id: number | null; name: string | null }> },
): string | undefined {
  if (!data?.placementFailed) return undefined;
  return `${item.name}: the answer was recorded, but the point could not be re-placed in `
    + `${worldViewList(data.placementFailedWorldViews)}. Its regions are out of date until an `
    + 'admin re-runs placement.';
}

/**
 * One point, one answer.
 *
 * Its own component rather than a loop body, because each point carries state a
 * curator types into — a note, and a map they may have opened — and holding those in
 * the card would make answering one part reset the note on another. The verdict goes
 * to the point's own endpoint; the card around it exists only to group them by object.
 */
function PointVerdict({ item, point, onDone }: {
  item: ReviewQueueItem;
  point: WithdrawnPoint;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const [note, setNote] = useState('');
  const [showMap, setShowMap] = useState(false);
  const hasPoint = typeof point.latitude === 'number' && typeof point.longitude === 'number';

  const decide = useMutation({
    mutationFn: (decision: { membership?: 'present' | 'former'; existence?: 'extant' | 'lost' }) =>
      setLocationState(point.id, {
        ...decision,
        note: note || undefined,
        // The point as this card is showing it. Compared under the write lock, which is
        // the only thing that tells a card drawn before someone else answered from a
        // correction made with the current state in view — and the second has to stay
        // possible, or one mis-click removes a part from the product for good.
        expected: { membership: 'present', existence: 'extant', flagged: true },
      }),
    // The reply is read, not discarded: a verdict can commit while re-placing the
    // point fails, and then it is on the map (or off it) with the regions disagreeing
    // — a state a curator can report to an admin and nobody can guess from a card
    // that simply closed. `publishOutcomeFor` does the same for a publication.
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : placementNotice(item, data), item.id),
  });

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">{pointTitle(point)}</Typography>
      <Typography variant="body2" color="text.secondary">
        Last listed before {formatDateTime(point.missingSince)}.
        {' '}{withdrawalStory(point, item.offered_locations ?? 0)}
      </Typography>

      {point.visited && (
        <Alert severity="info" sx={{ mt: 1, py: 0 }}>
          Someone has been here. Their record is kept whatever you answer — it is the spot that
          stops being shown, not the visit.
        </Alert>
      )}

      {hasPoint && (
        // Named rather than printed as a coordinate, unlike every other place in this
        // queue. The object's own coordinate is already above, and on a single-place
        // object the two are the same place — Bilbao showed "43.2660, -2.9379" twice,
        // one line apart, which reads as a bug. The number is in the dialog's title
        // for anyone who wants to copy it.
        <Button
          size="small"
          startIcon={<PlaceIcon fontSize="small" />}
          onClick={() => setShowMap(true)}
          sx={{ p: 0, minWidth: 0, textTransform: 'none', mt: 0.5 }}
        >
          See where it was
        </Button>
      )}

      <TextField
        size="small"
        fullWidth
        label="Note (optional)"
        helperText="Kept with your answer in this object’s curation history."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        sx={{ mt: 1, mb: 1 }}
      />

      {hasPoint && (
        // Opened here rather than navigated to, for the reason `ObjectContext` gives: the
        // app takes no positioning parameters, so a link would drop the curator out of the
        // queue and land nowhere near the place. "Where was it" is most of this decision,
        // and the band the button serves starts above the tolerance: a part the source now
        // lists 40 m away has moved across a square, one 400 km away has moved to another
        // region entirely, and only a map tells those apart. Below ten metres the sentence
        // has already answered it and there is nothing to look at.
        <PointPreviewDialog
          open={showMap}
          onClose={() => setShowMap(false)}
          name={pointTitle(point)}
          latitude={point.latitude as number}
          longitude={point.longitude as number}
        />
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <Button
          variant="outlined"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ membership: 'former' })}
        >
          The source dropped it
        </Button>
        <Button
          variant="outlined"
          color="warning"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ existence: 'lost' })}
        >
          It no longer exists
        </Button>
        {/* Last and quietest of the three, because it is the one answer that changes what
            a visitor sees — and the honest label has to say that the source may disagree
            again on its next run. */}
        <Button
          variant="text"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ membership: 'present' })}
        >
          False alarm — put it back
        </Button>
        <HelpHint text={HELP} label="what marking a point gone does" />
      </Stack>
    </Box>
  );
}

/**
 * Every place one object lost, grouped, with the object above them.
 *
 * Grouped because the queue is a list of objects and a run can drop two components of
 * a serial site at once; answered per point because that is what the verdict is about.
 * The header is the shared `ItemHeader`, so this card says what the object is made of
 * through the same line every other kind uses.
 */
export function WithdrawnCard({ item, onDone }: {
  item: ReviewQueueItem;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const points = item.withdrawn_points ?? [];

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        {points.length > 1 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {points.length} of its parts are waiting on an answer, each on its own.
          </Typography>
        )}
        {points.map((point, index) => (
          <Box key={point.id}>
            {index > 0 && <Divider sx={{ mb: 2 }} />}
            <PointVerdict item={item} point={point} onDone={onDone} />
          </Box>
        ))}
        {points.length === 0 && (
          // A row in this kind exists because a point was flagged, so an empty list means
          // the response and this card disagree — worth saying rather than rendering a
          // card with nothing to answer.
          <Alert severity="warning">
            This object is listed as having lost places it is made of, and none of them are in
            the response. Reload the page.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

type AnsweredPoint = NonNullable<ReviewQueueItem['answered_points']>[number];

/**
 * Whether one take-back would put the point back in front of readers.
 *
 * The endpoint's own two rules read forward: a reader sees a point where the withdrawal
 * flag is clear and nothing has declared it gone (`offeredLocationSql`), and the flag is
 * cleared by exactly one thing — an answer that leaves both axes clean. Repeated here
 * rather than imported for the reason `SAME_POINT_METRES` is: the frontend cannot reach
 * `backend/src`.
 *
 * It has to be computed rather than assumed, because the two verdicts do not behave alike
 * and neither does one taken back. Taking `lost` off a point whose `former` still stands
 * leaves it hidden — the flag holds it — while taking it off a point the source has since
 * offered again reveals it, the flag being clear already. A card promising one where the
 * other happens is wrong about the only thing a curator is deciding.
 */
export function wouldReveal(point: AnsweredPoint, axis: 'membership' | 'existence'): boolean {
  const membership = axis === 'membership' ? 'present' : point.sourceMembership;
  const existence = axis === 'existence' ? 'extant' : point.existence;
  const flagClear = (membership === 'present' && existence === 'extant')
    || point.missingSince === null;
  return flagClear && existence !== 'lost';
}

/**
 * The two verdicts a point can be carrying, and the way back from each.
 *
 * One at a time, because they are independent claims and a curator may want only one of
 * them undone: `former` is about the source's list, `lost` about the world. The labels
 * are the ones the product uses for the same act on an object — "It is still listed",
 * "It does still exist" — so the same correction reads the same wherever it is made.
 */
const TAKE_BACK = [
  {
    axis: 'membership' as const,
    holds: (p: AnsweredPoint) => p.sourceMembership === 'former',
    recorded: 'Recorded as dropped by the source',
    label: 'It is still listed',
    decision: { membership: 'present' as const },
  },
  {
    axis: 'existence' as const,
    holds: (p: AnsweredPoint) => p.existence === 'lost',
    recorded: 'Recorded as no longer existing',
    label: 'It does still exist',
    decision: { existence: 'extant' as const },
  },
];

/**
 * What a curator is told about the standing answer before they undo it.
 *
 * The date and the name where they exist, and no filler where they do not: a verdict from
 * a region this reader does not cover comes back with no name at all (the log is scoped,
 * `reviewQueueContents.ts` says why), and "a curator" is the honest form of that —
 * somebody decided, and who is not this reader's to see.
 *
 * The note is the opposite: it comes off `state_note`, which carries no region, so this
 * reader sees wording whose *act* they cannot open. That is why the help text does not
 * promise the history keeps it unconditionally — the log row holding it is dropped by
 * `getCurationLog` for exactly the reader whose card says "a curator", and a promise is
 * worse than none where the person it is made to is the one it fails for.
 */
export function answeredLine(point: AnsweredPoint): string {
  const when = point.decidedAt ? ` on ${formatDateTime(point.decidedAt)}` : '';
  const who = ` by ${point.decidedBy ?? 'a curator'}`;
  const note = point.note ? ` — “${point.note}”` : '';
  return `Answered${when}${who}${note}.`;
}

const TAKE_BACK_HELP = 'These are answered, so they are not waiting on you. They are here '
  + 'because a point with a verdict on it is on no other screen: readers do not see it, and '
  + 'it gives nothing back at its own address — so if one of these was a mis-click, this is '
  + 'where it comes back. Each answer is taken back on its own, and the point returns to the '
  + 'map only once nothing is left holding it. If the source still does not list it, the next '
  + 'run will mark it again and it will come back as a question. Taking one back makes you the '
  + 'author of where the point now stands, so the note above it goes with the answer it '
  + 'explained — the wording stays in this object’s history wherever the act that wrote it is '
  + 'one your scope can see, which is the same reach that decides whether a name appears above.';

/**
 * One answered point, and the way back from each verdict standing on it.
 *
 * Its own component rather than a loop body, for the reason `PointVerdict` is: each point
 * carries a map a curator may have opened, and holding that in the card would make
 * opening one point's place close another's.
 */
function AnsweredVerdict({ item, point, onDone }: {
  item: ReviewQueueItem;
  point: AnsweredPoint;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const [showMap, setShowMap] = useState(false);
  const hasPoint = typeof point.latitude === 'number' && typeof point.longitude === 'number';

  const takeBack = useMutation({
    mutationFn: (decision: { membership?: 'present' | 'former'; existence?: 'extant' | 'lost' }) =>
      setLocationState(point.id, {
        ...decision,
        // The row as this card is showing it, both axes and the flag. Compared under
        // the write lock, and it is the whole of what stops a card drawn before a run
        // re-listed the point from undoing a verdict its author never saw.
        expected: {
          membership: point.sourceMembership,
          existence: point.existence,
          flagged: point.missingSince !== null,
        },
      }),
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : placementNotice(item, data), item.id),
  });

  const standing = TAKE_BACK.filter(v => v.holds(point));

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">{pointTitle(point)}</Typography>
      <Typography variant="body2" color="text.secondary">
        {answeredLine(point)}
      </Typography>

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
            See where it was
          </Button>
          <PointPreviewDialog
            open={showMap}
            onClose={() => setShowMap(false)}
            name={pointTitle(point)}
            latitude={point.latitude as number}
            longitude={point.longitude as number}
          />
        </>
      )}

      {standing.map(verdict => (
        <Stack
          key={verdict.axis}
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          alignItems="center"
          sx={{ mt: 1 }}
        >
          <Typography variant="body2">{verdict.recorded}.</Typography>
          <Button
            variant="outlined"
            size="small"
            disabled={takeBack.isPending}
            onClick={() => takeBack.mutate(verdict.decision)}
          >
            {verdict.label}
          </Button>
          {/* What the click does to what a visitor sees, said before it is clicked. The
              two verdicts differ here and so does one taken back: undoing a `lost` while
              a `former` still stands leaves the point hidden, and a card that promised
              the map would get it back would be wrong about the whole decision. */}
          <Typography variant="caption" color="text.secondary">
            {wouldReveal(point, verdict.axis)
              ? 'Puts it back on the map.'
              : 'It stays hidden: the other answer is still holding it.'}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/**
 * Every answered point of one object, grouped, with the object above them.
 *
 * Grouped like the open card and for the same reason — the queue is a list of objects and
 * a serial site can lose two parts in one run — and through the same `ItemHeader`, so a
 * curator looking for something they answered a moment ago recognises it by the same line
 * they answered it under.
 */
export function AnsweredWithdrawalCard({ item, onDone }: {
  item: ReviewQueueItem;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const points = item.answered_points ?? [];
  const total = item.answered_points_total ?? points.length;

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        {/* The cap said rather than implied. This list only grows — a point enters when
            it is answered and leaves only if the verdict is taken back — so an object
            worked through over months can hold more answered places than a card should
            show, and a list quietly standing for the rest is the failure the counted
            `contents` card exists to avoid. */}
        {total > points.length && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            The {points.length} most recently answered of {total}.
          </Typography>
        )}
        {points.map((point, index) => (
          <Box key={point.id}>
            {index > 0 && <Divider sx={{ mb: 2 }} />}
            <AnsweredVerdict item={item} point={point} onDone={onDone} />
          </Box>
        ))}
        <HelpHint text={TAKE_BACK_HELP} label="why answered points are listed here" />
      </CardContent>
    </Card>
  );
}
