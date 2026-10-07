/**
 * A kind's rule refusing a place, and the answers to it: the open question on
 * the bench, and the confirmed refusal in the kept-out list at the page's foot.
 *
 * A refusal is a kind's: its rule refused that kind's membership (#1264). A
 * place in two kinds can be refused by one and offered by the other — the
 * Capitoline Museums kept out of Archaeology are still an art museum on every
 * map — so each card says where readers still see the place, and a place two
 * rules refused is one card with a section per kind.
 */

import { useState } from 'react';
import {
  Typography, Card, CardContent, Button, Stack, TextField,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { setExperienceAdmission, type AdmissionResult } from '../../api/curation';
import { namedMembership } from '../../utils/namedMembership';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { publishOutcomeFor } from './publishOutcome';
import { formatDateTime } from '../../utils/dateFormat';
import { ItemHeader, messageFor } from './queueCard';
import { RefusalLine } from './RefusalLine';

type OnDone = (message?: string, experienceId?: number) => void;

/** Where readers still see a place a kind's rule refused, said beside the refusal. */
function SeenElsewhere({ item }: { item: ReviewQueueItem }) {
  const seen = item.seen_in ?? [];
  if (seen.length === 0) return null;
  const kinds = seen.length > 1 ? `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}` : seen[0];
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      Readers still see this place under {kinds}; this keeps it out of {item.kind_name} alone.
    </Typography>
  );
}

/**
 * A place one or more kinds' rules refused, with each objection on it.
 *
 * The reason is the whole point of the card. "Refused" alone leaves a curator
 * guessing, and the rule's own note — `not a museum class — named by Column of
 * Phocas (36 sitelinks)` — names internal tests and states no threshold, so
 * `RefusalLine` says what was found in ordinary words and keeps the recorded
 * wording behind the question mark beside it. Either way a bad rule shows up
 * here as a run of near-identical cards rather than as a mystery.
 */
export function RefusedCard({ items, onDone }: { items: ReviewQueueItem[]; onDone: OnDone }) {
  const several = items.length > 1;
  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={items[0]} kinds={several ? items.map(item => item.kind_name) : undefined} />
        <Stack spacing={2}>
          {items.map(item => (
            <RefusalSection
              key={`${item.id}:${item.membership_id ?? ''}`}
              item={item}
              heading={several ? `${item.kind_name}’s rule turned it down` : undefined}
              onDone={onDone}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * One kind's refusal and its two answers, written under that kind's membership.
 * Keyed by its caller on the place and the membership, so a note typed here is
 * never carried onto the next refusal.
 */
function RefusalSection({ item, heading, onDone }: { item: ReviewQueueItem; heading?: string; onDone: OnDone }) {
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'confirm' | 'override') =>
      setExperienceAdmission(item.id, {
        decision, note: note || undefined, ...namedMembership(item.membership_id),
      }),
    // "Put it back" on a row nobody had passed publishes it as well, and a
    // curator watching an object stay invisible after un-refusing it would go
    // looking for a second button that does not exist.
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : admissionOutcomeFor(item, data), item.id),
  });

  return (
    <Stack sx={heading ? { border: 1, borderColor: 'divider', borderRadius: 1, p: 2 } : undefined}>
      {heading && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{heading}</Typography>
      )}
      <RefusalLine
        reason={item.admission_reason}
        works={item.counted_works}
        held={item.counted_works_total}
        name={item.name}
      />
      <SeenElsewhere item={item} />

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
    </Stack>
  );
}

/**
 * A refusal a curator confirmed, and the one way back from it.
 *
 * Deliberately not the two-button card above: the question has been answered,
 * and re-asking it would invite a second answer to a settled thing. What this
 * offers is a correction — one button, in the direction that reveals. One card
 * per kept-out membership, so its chip names the kind it was kept out of.
 */
export function KeptOutCard({ item, onDone }: { item: ReviewQueueItem; onDone: OnDone }) {
  const putBack = useMutation({
    mutationFn: () => setExperienceAdmission(item.id, {
      decision: 'override', ...namedMembership(item.membership_id),
    }),
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
        <SeenElsewhere item={item} />
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
  item: { name: string }, data?: AdmissionResult,
): string | undefined {
  if (!data?.published) return undefined;
  return publishOutcomeFor(item, data);
}
