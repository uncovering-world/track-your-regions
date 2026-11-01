/**
 * What a sync run could not decide for itself.
 *
 * Two kinds of question, kept apart because they are answered differently. A
 * site the source stopped listing needs a verdict on what that means —
 * delisted, destroyed, or never gone. A field the source wants to change but a
 * curator has claimed needs a choice between two versions. Neither has changed
 * anything for users yet; that is the point of asking. A kind's rule refusing
 * a place is the third, answered in `RefusedCards.tsx`.
 */

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Stack,
  TextField,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import {
  setExperienceState,
  acceptSourceValue,
  declineSourceValue,
  type AcceptSourceResult,
} from '../../api/curation';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { formatDateTime } from '../../utils/dateFormat';
import { worldViewList } from '../../utils/worldViewList';
import { ItemHeader, messageFor } from './queueCard';
import { FactTable, ProposalSummary } from './FactTable';
import { rowlessProposalWords, rowsFor } from './factRows';
import { fieldLabel } from './fieldMeaning';
import { CHANGE_ANSWERS, CHANGE_COLUMNS, changeAnswersLine } from './selection/answerWords';
import type { Existence, SourceMembership } from '@tyr/shared/lifecycle';


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
    mutationFn: (decision: { membership?: SourceMembership; existence?: Existence }) =>
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
 * Two versions of a field a curator claimed, and a decision for each one.
 *
 * Per field rather than per object, because a run improves and damages in the
 * same breath: one answer for the object takes a better description together
 * with a mangled name.
 *
 * Both answers are buttons. Standing by your own value writes a refusal, or the
 * card comes back after every run — Aksum's three times in two days, the source
 * proposing the identical text each time.
 * Refusing writes nothing to the object: the stored value has already won every
 * one of those runs. What it settles is the asking, and only for the value being
 * refused, so a source that changes its mind is heard.
 */
export function ConflictCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
  const proposed = item.proposed ?? [];
  const context = {
    proposed, inDanger: item.in_danger, dangerSince: item.danger_since, imageCredit: item.image_credit ?? null,
    experienceId: item.id,
  };
  const rows = rowsFor(proposed, context);
  // Whose edit the source is proposing over, by name. The queue selects the claimant
  // precisely so this card stops calling another curator's work "mine"; a card that
  // said "of yours" over Dana's claim would undo that in the summary line.
  const claimants = [...new Set(proposed.map(f => f.claim?.by).filter((by): by is string => !!by))];
  const overWhose = claimants.length > 0
    ? `over an edit claimed by ${claimants.join(', ')}`
    : 'over a curator’s edit';
  const accept = useMutation({
    mutationFn: (fields: string[]) => acceptSourceValue(item.id, fields, item.sync_log_id ?? 0),
    // Report what landed, and the run the values came from, which is the whole
    // mitigation for a later run proposing something else. The refetch takes
    // the card away, so this is the only place either can be said.
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

        {/* The claimed half of the shape WaitingToPublish has a branch for: a changeset
            an earlier run filed can carry a tags conflict (curatedConflict on a field
            no run reports now), and the conflict query surfaces it while the claim on
            tags stands; a fact with no value on either side makes no row either
            (#1774). No rows to table, and "proposes nothing" over the two live
            buttons would be false — either answer settles it, and neither changes what
            readers see. */}
        {rows.length === 0 && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            The source proposes {rowlessProposalWords(proposed)}, which nothing readers see
            {claimants.length > 0 ? `, over an edit claimed by ${claimants.join(', ')}` : ''}.
            Either answer settles it and changes nothing readers see.
          </Typography>
        )}
        {rows.length > 0 && (
        <ProposalSummary
          lead={item.run_completed_at
            ? `The run that finished ${formatDateTime(item.run_completed_at)} proposes`
            : 'The source proposes'}
          rows={rows}
          trailing={overWhose}
        />
        )}
        {rows.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <FactTable
            groups={[{ subject: { kind: 'object', label: item.name }, rows }]}
            // "Current", not "yours": the value that stands was claimed by a curator,
            // and the trail under it says which one. The same two headings as the
            // held card's, and each answer names its column (#2222).
            labels={CHANGE_COLUMNS}
            // One field at a time, because a run improves and damages in the same
            // breath: one button for a better description arriving with a mangled
            // name takes both or neither. The endpoint accepts a list, so the screen
            // has to be able to say "this one". The answer
            // sits in its own column, once per fact: a key inside the source data has
            // been a fact of its own since #488 claimed one per key, and every key a
            // run reports since ADR-0039. It spans only where facts still share
            // one answer, which is that same defect somewhere else: a stored entry
            // filed before ADR-0039 whose keys share one field, and a language
            // map, whose names share one cell for the same reason (#728). Every
            // field is refusable: refusing writes nothing, so there is no field this
            // answer cannot reach.
            answer={(field) => (
              <Stack spacing={0.5}>
                {/* "current", not "mine": the standing value may be another curator's,
                    and the trail under it says whose. */}
                <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={() => decline.mutate([field])}>
                  {CHANGE_ANSWERS.keep}
                </Button>
                <Button size="small" variant="outlined" disabled={busy} onClick={() => accept.mutate([field])}>
                  {CHANGE_ANSWERS.use}
                </Button>
              </Stack>
            )}
          />
        </Box>
        )}

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
            {CHANGE_ANSWERS.keepAll}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={busy || proposed.length === 0}
            onClick={() => accept.mutate(proposed.map(f => f.field))}
          >
            {CHANGE_ANSWERS.useAll}
          </Button>
          {/* What the two buttons differ in, and the difference is not symmetric.
              Using the proposed value hands the field back and writes the source's
              value at once, the place's point and regions with a coordinate. Keeping
              the current one writes nothing at all, so readers stay on the curator's
              version; what it changes is the asking, and only for the value being
              refused — the sentence that stops a curator wondering whether "Keep
              current" hides a source that later changes its mind. Said in the
              words of this card's fields: a point moves, a text changes (#2222). */}
          <Typography variant="caption" color="text.secondary">
            {changeAnswersLine(proposed.map(f => f.field))}
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
  return `${item.name}: ${data.declined.map(fieldLabel).join(', ')} — kept as curated, `
    + `and run ${data.fromSyncLogId}’s version will not be asked about again.`;
}

/** What landed, and from which run — neither survives the refetch otherwise. */
export function outcomeFor(
  item: { name: string },
  data?: AcceptSourceResult,
): string | undefined {
  if (!data) return undefined;
  const parts: string[] = [];
  // Through `fieldLabel` for the reason the headings are: the card the curator just read
  // said "picture", and an answer that says `imageUrl` reads as a
  // different subject — our word for the column, in the one line confirming their click.
  if (data.applied.length > 0) parts.push(`${data.applied.map(fieldLabel).join(', ')} applied now`);
  // A kind's own fact, the one entry an answer releases without a write.
  if (data.released.length > 0) {
    parts.push(`${data.released.map(fieldLabel).join(', ')} at the kind’s next run`);
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
  // The same argument as the pin, one field over: accepting the picture also
  // deletes the credit the curator's own edit wrote, and the card said nothing
  // about a photographer. Without this line the name under the picture simply
  // stops being there.
  if (data.releasedCredit) parts.push('its picture credit dropped with it');
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
