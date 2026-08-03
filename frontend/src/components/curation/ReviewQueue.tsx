/**
 * What a sync run could not decide for itself.
 *
 * Two kinds of question, and the page keeps them apart because they are
 * answered differently. A site the source stopped listing needs a verdict on
 * what that means — delisted, destroyed, or never gone. A field the source
 * wants to change but a curator has claimed needs a choice between two
 * versions. Neither has changed anything for users yet; that is the point of
 * asking.
 */

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Stack, Chip, Alert,
  TextField, Divider,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchReviewQueue,
  setExperienceState,
  acceptSourceValue,
  type ReviewQueueItem,
} from '../../api/experiences';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { formatDateTime } from '../../utils/dateFormat';

export function ReviewQueue() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  // The API pages both lists. Without an offset the page could only ever show
  // the first one, and items behind it would stay unreachable until the ones
  // in front were answered — which is the queue-that-cannot-be-emptied shape
  // this page exists to avoid.
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['curation', 'reviewQueue', offset],
    queryFn: () => fetchReviewQueue({ offset }),
  });

  // Refetch whether the call succeeded or not. A failure is often the server
  // saying the item is already answered, which means this page is the stale
  // one — leaving the card up would let every further click repeat the same
  // refusal, and `staleTime` plus no refetch-on-focus means nothing else
  // would recover it short of a reload. The message is held here rather than
  // on the card, since the refetch is what takes the card away.
  const refresh = (message?: string) => {
    setNotice(message ?? null);
    return queryClient.invalidateQueries({ queryKey: ['curation', 'reviewQueue'] });
  };

  // Answering shortens the list, so paging back has to stay possible; an
  // offset past the end would otherwise strand the curator on an empty page.
  const goBack = () => setOffset(o => Math.max(0, o - (data?.limit ?? 25)));
  const goForward = () => setOffset(o => o + (data?.limit ?? 25));

  if (isLoading) return <LoadingSpinner padding={4} />;

  if (isError) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        Could not load the review queue
        {error instanceof Error ? `: ${error.message}` : '.'}
      </Alert>
    );
  }

  const missing = data?.missing ?? [];
  const conflicts = data?.conflicts ?? [];
  // The API pages; a full page means there are more behind it, and printing
  // its length as a total would understate the backlog.
  const pageSize = data?.limit ?? 0;
  const fullPage = missing.length === pageSize || conflicts.length === pageSize;
  const countLabel = (n: number) => (n === pageSize && offset === 0 ? `first ${n}` : `${n}`);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>Review</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Decisions a sync run cannot make on its own. Nothing here has changed what visitors see —
        it waits for you.
      </Typography>

      {notice && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {missing.length === 0 && conflicts.length === 0 && (
        <Alert severity="success">
          {offset === 0
            ? 'Nothing waiting. Every flagged object has been answered.'
            : 'Nothing further on this page.'}
        </Alert>
      )}

      {missing.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
            Gone from the source ({countLabel(missing.length)})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A clean run stopped finding these. That can mean the source delisted them, that they no
            longer exist, or that the source was simply wrong — and only the first two change
            anything.
          </Typography>
          <Stack spacing={2}>
            {missing.map(item => (
              <MissingCard key={item.id} item={item} onDone={refresh} />
            ))}
          </Stack>
        </>
      )}

      {conflicts.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
            The source disagrees with an edit ({countLabel(conflicts.length)})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your version is the one on the site. The source has been proposing something else, and
            will keep proposing it until you decide.
          </Typography>
          <Stack spacing={2}>
            {conflicts.map(item => (
              <ConflictCard key={item.id} item={item} onDone={refresh} />
            ))}
          </Stack>
        </>
      )}
      {(offset > 0 || fullPage) && (
        <Stack direction="row" spacing={1} sx={{ mt: 4 }} alignItems="center">
          <Button size="small" disabled={offset === 0} onClick={goBack}>Previous</Button>
          <Button size="small" disabled={!fullPage} onClick={goForward}>Show more</Button>
          <Typography variant="caption" color="text.secondary">
            {offset > 0 ? `from ${offset + 1}` : 'from the start'}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}

function ItemHeader({ item }: { item: ReviewQueueItem }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{item.name}</Typography>
      <Typography variant="caption" color="text.secondary">({item.external_id})</Typography>
      <Chip label={item.category_name} size="small" variant="outlined" />
    </Stack>
  );
}

function MissingCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string) => void }) {
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
    onSettled: (_data, error) => onDone(error ? messageFor(item, error) : undefined),
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Last listed before {item.missing_since ? formatDateTime(item.missing_since) : 'an earlier run'}.
        </Typography>

        <TextField
          size="small"
          fullWidth
          label="Note (optional)"
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

function ConflictCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string) => void }) {
  const proposed = item.proposed ?? [];
  // A moved coordinate or a metadata key cannot be written here, but accepting
  // still releases the claim, and the next run applies it. Editing would not:
  // every other path that touches `curated_fields` only ever adds to it.
  const deferred = proposed.some(f => !f.acceptable);
  const accept = useMutation({
    mutationFn: (fields: string[]) => acceptSourceValue(item.id, fields, item.sync_log_id ?? 0),
    // Report what landed. The button promises a split — some now, some at the
    // next sync — and the response names the run the values came from, which
    // is the whole mitigation for a later run proposing something else. The
    // refetch takes the card away, so this is the only place either can be said.
    onSettled: (data, error) => onDone(error ? messageFor(item, error) : outcomeFor(item, data)),
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />

        <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mb: 2 }}>
          {proposed.map((field) => (
            <Box key={field.field}>
              <Typography variant="caption" color="text.secondary">{field.field}</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                yours: {describe(field.old)}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                source: {describe(field.new)}
              </Typography>
              {!field.acceptable && (
                <Typography variant="caption" color="text.secondary">
                  This one lands at the next sync — accepting lifts your protection on it.
                </Typography>
              )}
            </Box>
          ))}
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            disabled={accept.isPending || proposed.length === 0}
            onClick={() => accept.mutate(proposed.map(f => f.field))}
          >
            {deferred ? 'Accept the source (some at next sync)' : 'Accept the source'}
          </Button>
          {/* Keeping the edit needs no call: refusing is the current state, and
              the run will go on proposing until someone accepts. */}
          <Button variant="text" disabled>Keep my edit (current)</Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** What landed, and from which run — neither survives the refetch otherwise. */
export function outcomeFor(
  item: { name: string },
  data?: { applied: string[]; released: string[]; fromSyncLogId: number },
): string | undefined {
  if (!data) return undefined;
  const parts: string[] = [];
  if (data.applied.length > 0) parts.push(`${data.applied.join(', ')} applied now`);
  if (data.released.length > 0) parts.push(`${data.released.join(', ')} at the next sync`);
  if (parts.length === 0) return undefined;
  return `${item.name}: ${parts.join('; ')} — from run ${data.fromSyncLogId}.`;
}

/** What to tell the curator when their answer was refused. */
export function messageFor(item: { name: string }, error: unknown): string {
  return `${item.name}: ${error instanceof Error ? error.message : 'could not be saved'}`;
}

/** Long values are described rather than reproduced, as in the run card. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}… (${text.length} chars)` : text;
}
