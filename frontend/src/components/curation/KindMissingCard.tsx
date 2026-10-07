/**
 * A place one kind's source stopped listing while another source still lists
 * it, and the one question that leaves: is it still of that kind? (#1264)
 *
 * The Capitoline Museums after a merge: the art-museum source goes on listing
 * them, the Archaeology run stopped finding them after a Wikidata
 * reclassification. The place has not gone anywhere — readers still see it —
 * so "no longer exists" is not offered here; that question is the place's own
 * card, once every source has stopped listing it. One card per place, with a
 * section per kind that lost it.
 */

import { useState } from 'react';
import {
  Typography, Card, CardContent, Button, Stack, TextField,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { setExperienceState } from '../../api/curation';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import type { SourceMembership } from '@tyr/shared/lifecycle';
import { formatDateTime } from '../../utils/dateFormat';
import { ItemHeader, messageFor } from './queueCard';

type OnDone = (message?: string, experienceId?: number) => void;

export function KindMissingCard({ items, onDone }: { items: ReviewQueueItem[]; onDone: OnDone }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={items[0]} kinds={items.length > 1 ? items.map(item => item.kind_name) : undefined} />
        <Stack spacing={2}>
          {items.map(item => (
            <KindSection key={`${item.id}:${item.membership_id ?? ''}`} item={item} onDone={onDone} />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function KindSection({ item, onDone }: { item: ReviewQueueItem; onDone: OnDone }) {
  const [note, setNote] = useState('');
  const kind = item.kind_name;
  const seen = item.seen_in ?? [];
  const decide = useMutation({
    mutationFn: (membership: SourceMembership) => setExperienceState(item.id, {
      membership,
      note: note || undefined,
      membershipId: item.membership_id ?? undefined,
      // The kind as this card shows it, its flag included: a run that finds
      // the place again clears the flag, and taking it out of the kind then
      // would take out a place its source lists again.
      expected: { membership: item.source_membership, existence: item.existence, flagged: item.missing_since != null },
    }),
    onSettled: (_data, error) => onDone(error ? messageFor(item, error) : undefined, item.id),
  });

  return (
    <Stack sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        {kind}’s source no longer lists this place
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Last listed before {item.missing_since ? formatDateTime(item.missing_since) : 'an earlier run'}.
        {seen.length > 0 && ` Readers still see it under ${seen.join(', ')}.`}
      </Typography>
      <TextField
        size="small"
        fullWidth
        label="Note (optional)"
        helperText="Kept with your answer in this place’s curation history, and beside it in the kept-out list."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button variant="outlined" disabled={decide.isPending} onClick={() => decide.mutate('former')}>
          {item.kept_as_former
            ? `Delisted — keep it under ${kind}, marked former`
            : `No longer ${kind} — take it out of that list`}
        </Button>
        <Button variant="text" disabled={decide.isPending} onClick={() => decide.mutate('present')}>
          False alarm — it stays under {kind}
        </Button>
      </Stack>
    </Stack>
  );
}
