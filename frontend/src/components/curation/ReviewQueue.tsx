/**
 * What a sync run could not decide for itself, and the one thing it could.
 *
 * Three kinds of question, kept apart because they are answered differently. A
 * site the source stopped listing needs a verdict on what that means —
 * delisted, destroyed, or never gone. A field the source wants to change but a
 * curator has claimed needs a choice between two versions. Neither has changed
 * anything for users yet; that is the point of asking.
 *
 * A row this category refused is the exception, and the page says so rather
 * than hiding it. The run did not fail to see it — it named it and applied our
 * own rule, so the row is already hidden (ADR-0024). None of the three verdicts
 * above is true of it, which is exactly why it needs a section and two answers
 * of its own: the rule was right, or the rule was wrong.
 *
 * The confirmed ones come back at the foot of the page, collapsed. They are not
 * work — they are answered — but a row kept out is hidden from every list and
 * unreachable by its own address, so this page is the only place a mis-click
 * can be undone. Leaving them off it would make one button permanent.
 */

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Stack,
  TextField, Divider,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import {
  setExperienceState,
  setExperienceAdmission,
  acceptSourceValue,
  declineSourceValue,
  type ReviewQueueItem,
  type PublishResult,
} from '../../api/experiences';
import { publishOutcomeFor } from './WaitingToPublish';
import { formatDateTime } from '../../utils/dateFormat';
import { worldViewList } from '../../utils/worldViewList';
import { ItemHeader, messageFor } from './queueCard';
import { FieldDiff } from './FieldDiff';
import { fieldLabel } from './fieldLabel';
import { RefusalLine } from './RefusalLine';
import { ProvenanceTrail } from './ProvenanceTrail';


/**
 * An object a clean run stopped finding, and the three things that can mean.
 *
 * Delisted, destroyed, or the source hiccupped — and the first two are different
 * facts that can both be true, which is why they are two buttons and not one
 * status. Nothing here has changed what visitors see; the card is the asking.
 */
export function MissingCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: { membership?: 'present' | 'former'; existence?: 'extant' | 'lost' }) =>
      setExperienceState(item.id, {
        ...decision,
        note: note || undefined,
        // What this card is showing, flag included. The server compares it
        // with what is stored, which is the only way it can tell a card drawn
        // before the question was answered from a correction made with the
        // current state in view — and the second must stay possible, or a
        // mis-clicked verdict could never be taken back. The flag matters on
        // its own: a run that re-lists the object clears it and leaves both
        // axes alone, so this card would otherwise still match.
        expected: {
          membership: item.source_membership,
          existence: item.existence,
          flagged: item.missing_since != null,
        },
      }),
    onSettled: (_data, error) => onDone(error ? messageFor(item, error) : undefined, item.id),
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Last listed before {item.missing_since ? formatDateTime(item.missing_since) : 'an earlier run'}.
        </Typography>

        {/* Who reads it, said on the field. A box labelled only "Note (optional)" asks a
            curator to write for nobody in particular, which is why they mostly do not. */}
        <TextField
          size="small"
          fullWidth
          label="Note (optional)"
          helperText="Kept with your answer in this object’s curation history."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ membership: 'former' })}
          >
            Former — delisted, still there
          </Button>
          <Button
            variant="outlined"
            color="warning"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ existence: 'lost' })}
          >
            Lost — no longer exists
          </Button>
          <Button
            variant="text"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ membership: 'present' })}
          >
            False alarm
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * A row this category's own rule refused, with that objection on it.
 *
 * The reason is the whole point of the card. "Refused" alone leaves a curator
 * guessing, and the rule's own note — `not a museum class — named by Column of
 * Phocas (36 sitelinks)` — names internal tests and states no threshold, so
 * `RefusalLine` says what was found in ordinary words and keeps the recorded
 * wording behind the question mark beside it. Either way a bad rule shows up
 * here as a run of near-identical cards rather than as a mystery.
 */
export function RefusedCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'confirm' | 'override') =>
      setExperienceAdmission(item.id, { decision, note: note || undefined }),
    // "Put it back" on a row nobody had passed publishes it as well, and a
    // curator watching an object stay invisible after un-refusing it would go
    // looking for a second button that does not exist.
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : admissionOutcomeFor(item, data), item.id),
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <RefusalLine
          reason={item.admission_reason}
          works={item.counted_works}
          held={item.counted_works_total}
          name={item.name}
        />

        {/* This one really is read again, and soon: a kept-out row shows its note in the
            list at the foot of the page, which is where someone decides whether the
            refusal was a mis-click. Saying so is what makes writing one worth the time. */}
        <TextField
          size="small"
          fullWidth
          label="Note (optional)"
          helperText="Shown beside this row in the kept-out list, and in its curation history."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            disabled={decide.isPending}
            onClick={() => decide.mutate('confirm')}
          >
            The rule was right — keep it out
          </Button>
          <Button
            variant="outlined"
            color="warning"
            disabled={decide.isPending}
            onClick={() => decide.mutate('override')}
          >
            The rule was wrong — put it back
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * A refusal a curator confirmed, and the one way back from it.
 *
 * Deliberately not the two-button card above: the question has been answered,
 * and re-asking it would invite a second answer to a settled thing. What this
 * offers is a correction — one button, in the direction that reveals.
 */
export function KeptOutCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
  const putBack = useMutation({
    mutationFn: () => setExperienceAdmission(item.id, { decision: 'override' }),
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : admissionOutcomeFor(item, data), item.id),
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        {/* The same sentence and the same evidence as the open card above. This is the
            list a mis-click is undone from, so it is the last place to make someone
            re-read the rule's own wording to work out what they are putting back. */}
        <RefusalLine
          reason={item.admission_reason}
          works={item.counted_works}
          held={item.counted_works_total}
          name={item.name}
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Kept out{item.state_decided_at ? ` on ${formatDateTime(item.state_decided_at)}` : ''}
          {item.state_note ? ` — “${item.state_note}”` : ''}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          disabled={putBack.isPending}
          onClick={() => putBack.mutate()}
        >
          Put it back
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Two versions of a field a curator claimed, and a decision for each one.
 *
 * Per field rather than per object, because a run improves and damages in the
 * same breath: taking a better description used to mean taking a mangled name
 * with it.
 *
 * Both answers are buttons now. Standing by your own value used to be the
 * absence of an action, which meant the card came back after every run — Aksum's
 * three times in two days, the source proposing the identical text each time.
 * Refusing writes nothing to the object: the stored value has already won every
 * one of those runs. What it settles is the asking, and only for the value being
 * refused, so a source that changes its mind is heard.
 */
export function ConflictCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
  const proposed = item.proposed ?? [];
  // A moved coordinate or a metadata key is not written to the object here, but
  // accepting still releases the claim, and the next run applies it. Editing
  // would not: every other path that touches `curated_fields` only ever adds to
  // it. The coordinate is half an exception — the object's position waits, while
  // the pin that carried the correction moves back to the source's coordinate on
  // the spot, which is what the note under that diff says.
  const deferred = proposed.some(f => !f.acceptable);
  const accept = useMutation({
    mutationFn: (fields: string[]) => acceptSourceValue(item.id, fields, item.sync_log_id ?? 0),
    // Report what landed. The button promises a split — some now, some at the
    // next sync — and the response names the run the values came from, which
    // is the whole mitigation for a later run proposing something else. The
    // refetch takes the card away, so this is the only place either can be said.
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : outcomeFor(item, data), item.id),
  });
  const decline = useMutation({
    mutationFn: (fields: string[]) => declineSourceValue(item.id, fields, item.sync_log_id ?? 0),
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : refusalOutcomeFor(item, data), item.id),
  });
  const busy = accept.isPending || decline.isPending;

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />

        <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mb: 2 }}>
          {proposed.map((field) => (
            <Box key={field.field}>
              <FieldDiff
                field={field}
                // One field at a time, because a run improves and damages in the same
                // breath: a better description arriving with a mangled name used to be
                // one button that took both or neither. The endpoint has always accepted
                // a list — it was the screen that could not say "this one".
                // The label names the direction and the scope, because the button sits
                // between two columns and "take this one" answered neither: take what,
                // and whose? A field the endpoint cannot write says so in the same
                // breath, since the note underneath is easy to read past when a button
                // beside it promises something immediate.
                // Each answer under the value it applies. Every field is refusable,
                // including the ones whose acceptance says "at next sync": refusing
                // writes nothing, so there is no field this answer cannot reach.
                keepAction={(
                  <Button
                    size="small"
                    color="inherit"
                    disabled={busy}
                    onClick={() => decline.mutate([field.field])}
                  >
                    keep this
                  </Button>
                )}
                takeAction={(
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => accept.mutate([field.field])}
                  >
                    {field.acceptable === false ? 'take this (at next sync)' : 'take this'}
                  </Button>
                )}
              />
              <ProvenanceTrail field={field} runCompletedAt={item.run_completed_at} />
            </Box>
          ))}
        </Stack>

        {/* Same order as the columns above and as the per-field buttons: what is stored
            first, what is proposed second. And neither is a primary — one of them being
            the coloured one made the screen recommend an answer, and the only answer this
            screen has a default for is the one that changes nothing. */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            color="inherit"
            disabled={busy || proposed.length === 0}
            onClick={() => decline.mutate(proposed.map(f => f.field))}
          >
            Keep all of mine
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={busy || proposed.length === 0}
            onClick={() => accept.mutate(proposed.map(f => f.field))}
          >
            {deferred ? 'Take all of the source’s (some at next sync)' : 'Take all of the source’s'}
          </Button>
          {/* What the two buttons differ in, and the difference is not symmetric.
              Accepting hands the field back and writes the source's value — now for
              the five fields this endpoint can write, at the next sync for the rest,
              which is what the button labels distinguish. The coordinate sits across
              that line: the object's own position waits for the run, its pin does not. Refusing writes nothing at
              all, so readers stay on the curator's version; what it changes is the
              asking, and only for the text being refused — the sentence that stops a
              curator wondering whether "keep mine" hides a source that later changes
              its mind. Doing nothing is still possible and still keeps what is
              stored; it is no longer the only way to say so. */}
          <Typography variant="caption" color="text.secondary">
            Accepting puts the source’s text on the site. Keeping yours changes nothing
            readers see and settles the question — the source has to propose something
            different to ask again.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * What a refusal settled, since the refetch takes the card away.
 *
 * Named fields rather than a count, and the run they were refused from: the answer is
 * about *those values*, so a curator who sees this line and then meets the field again
 * next month is being told the source changed its mind, not that the click failed.
 */
export function refusalOutcomeFor(
  item: { name: string },
  data?: { declined: string[]; fromSyncLogId: number },
): string | undefined {
  if (!data || data.declined.length === 0) return undefined;
  // "not asked about again", not "not proposed again": the source goes on proposing it
  // every run and each one still records a changeset row an admin can see. What the
  // refusal ends is the question, which is the whole of what this feature does.
  return `${item.name}: ${data.declined.map(fieldLabel).join(', ')} — yours stands, `
    + `and run ${data.fromSyncLogId}’s version will not be asked about again.`;
}

/** What landed, and from which run — neither survives the refetch otherwise. */
export function outcomeFor(
  item: { name: string },
  data?: {
    applied: string[]; released: string[];
    releasedPoints?: number[]; movedPoints?: number[];
    placementFailed?: boolean;
    placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
    fromSyncLogId: number;
  },
): string | undefined {
  if (!data) return undefined;
  const parts: string[] = [];
  // Through `fieldLabel` for the reason the headings are: the card the curator just read
  // said "short description", and an answer that says `shortDescription` reads as a
  // different subject — our word for the column, in the one line confirming their click.
  if (data.applied.length > 0) parts.push(`${data.applied.map(fieldLabel).join(', ')} applied now`);
  if (data.released.length > 0) {
    parts.push(`${data.released.map(fieldLabel).join(', ')} at the next sync`);
  }
  // Accepting the coordinate does something to a row the card never mentioned:
  // it hands back the pin a curator moved, and puts it on the source's
  // coordinate where the run offered one. A side effect on a place is not a
  // side effect to leave a curator to discover on the map.
  const pins = data.movedPoints?.length ?? 0;
  const handed = data.releasedPoints?.length ?? 0;
  // Either array, not only the second: the server derives one from the other
  // today, and a line that goes silent about a pin that moved is the failure this
  // sentence exists to prevent — not something to make conditional on a
  // relationship between two response fields holding.
  if (pins > 0 || handed > 0) {
    const counted = pins > 0 ? pins : handed;
    const subject = counted === 1 ? 'its point' : `${counted} points`;
    parts.push(pins > 0
      ? `${subject} moved back to the source's coordinate`
      : `${subject} handed back to the source`);
  }
  // Through `worldViewList`, like every other placement report, and in the same
  // sentence rather than a second one: a pin that moved and whose region rows
  // did not follow is a place on the map and absent from the country's list, and
  // the curator cannot re-assign anything themselves. Read before the empty check
  // below, because a failure nobody is told about is worse than a line with
  // nothing else in it.
  const stale = data.placementFailed
    ? ` The point moved, but its regions could not be recomputed in ${worldViewList(data.placementFailedWorldViews)}`
      + ' — they are out of date until an admin re-runs placement.'
    : '';
  if (parts.length === 0) return stale === '' ? undefined : `${item.name}:${stale}`;
  return `${item.name}: ${parts.join('; ')} — from run ${data.fromSyncLogId}.${stale}`;
}

/**
 * Whether putting a row back also put it in front of readers, and if so,
 * everything that came with it.
 *
 * An override on a row nobody had passed publishes it in the same transaction
 * (ADR-0025 § 4.5) — otherwise the button says "Put it back" and puts nothing
 * anywhere. It publishes the arrival's contents too, not only the object —
 * "Put it back" does considerably more than it says, and a curator who clicks
 * it deserves to be told what happened, in the same sentence shape the publish
 * card already uses (`publishOutcomeFor`): a curator who clicks "Put it back"
 * and quietly gets twelve paintings published as a side effect deserves the
 * same sentence a curator who clicks "Publish" gets, not a vaguer one because
 * the button had a different label. Never a held field or a run id — an
 * override does not answer a proposal, so `publishOutcomeFor`'s clauses for
 * those two simply have nothing to say and are silent on their own.
 */
export function admissionOutcomeFor(
  item: { name: string }, data?: PublishResult & { admission: string; published: boolean },
): string | undefined {
  if (!data?.published) return undefined;
  return publishOutcomeFor(item, data);
}
