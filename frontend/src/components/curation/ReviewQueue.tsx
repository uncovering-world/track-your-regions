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
  Box, Typography, Card, CardContent, Button, Stack, Alert,
  TextField, Divider,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchReviewQueue,
  setExperienceState,
  setExperienceAdmission,
  acceptSourceValue,
  type ReviewQueueItem,
  type PublishResult,
} from '../../api/experiences';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { formatDateTime } from '../../utils/dateFormat';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { ItemHeader, describe, messageFor } from './queueCard';
import { WaitingToPublish, groupGated, publishOutcomeFor } from './WaitingToPublish';

export function ReviewQueue() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  // The API pages both lists. Without an offset the page could only ever show
  // the first one, and items behind it would stay unreachable until the ones
  // in front were answered — which is the queue-that-cannot-be-emptied shape
  // this page exists to avoid.
  const [offset, setOffset] = useState(0);
  // Collapsed by default. These are answered, and a curator opening this page
  // is here to work through what is not — but they must still be one click
  // from reach, because no other surface shows them.
  const [showKeptOut, setShowKeptOut] = useState(false);
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
  //
  // `experienceId` is not optional decoration: every verdict on this page
  // changes what some *other* surface shows about the same object — a state
  // verdict moves its chips, an override makes it visible and publishes what
  // arrived under it — and the object's own cache is shared with Discover and
  // `CurationDialog` under `['experience', id]`. Without invalidating it, a
  // curator who follows a card through to the object and then answers the card
  // sees the pre-verdict snapshot for as long as the global 60s `staleTime`
  // lasts. `WaitingToPublish` does the same for a publish; `docs/tech/experiences.md`
  // describes it as what every card here does, and it was true of one of them.
  const refresh = (message?: string, experienceId?: number) => {
    setNotice(message ?? null);
    if (experienceId !== undefined) invalidateExperiences(queryClient, { experienceId });
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
  const refused = data?.refused ?? [];
  const keptOut = data?.keptOut ?? [];
  const conflicts = data?.conflicts ?? [];
  const arrivals = data?.arrivals ?? [];
  const held = data?.held ?? [];
  const contents = data?.contents ?? [];
  // One card per experience, however many of the three gated kinds name it.
  const gated = groupGated(arrivals, held, contents);
  // The API pages; a full page means there are more behind it, and printing
  // its length as a total would understate the backlog.
  const pageSize = data?.limit ?? 0;
  // Every kind, because each is its own query with its own LIMIT: a kind left
  // out of this disjunction pages silently — its page 2 exists on the server
  // and no control on this page can ask for it.
  const fullPage = missing.length === pageSize
    || refused.length === pageSize
    || keptOut.length === pageSize
    || conflicts.length === pageSize
    || arrivals.length === pageSize
    || held.length === pageSize
    || contents.length === pageSize;
  const countLabel = (n: number) => (n === pageSize && offset === 0 ? `first ${n}` : `${n}`);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>Review</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Decisions a sync run cannot make on its own. Nothing here has changed what visitors see and
        it waits for you
        {refused.length > 0
          ? ' — except what this category refused, which is hidden already and says why below.'
          : '.'}
      </Typography>

      {notice && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* `keptOut` stays out of this on purpose — those are answered work. The
          three gated kinds are not answered, so claiming "nothing waiting"
          while a gated museum sits below would be false. */}
      {missing.length === 0 && refused.length === 0 && conflicts.length === 0
        && gated.length === 0 && (
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

      {refused.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
            This category turned these down ({countLabel(refused.length)})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A rule named each of these and refused it, so they are hidden from visitors already —
            a candidate that fails the same rule is never added in the first place, and a row that
            predates the rule has to end up in the same place. Your answer is durable either way:
            no later run will reverse it.
          </Typography>
          <Stack spacing={2}>
            {refused.map(item => (
              <RefusedCard key={item.id} item={item} onDone={refresh} />
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
      {/* One section for the three kinds a gated source raises, and one card per
          experience inside it — see `WaitingToPublish`. */}
      <WaitingToPublish groups={gated} countLabel={countLabel} onDone={refresh} />

      {keptOut.length > 0 && (
        <>
          <Divider sx={{ mt: 4 }} />
          <Button size="small" sx={{ mt: 2 }} onClick={() => setShowKeptOut(v => !v)}>
            {showKeptOut ? 'Hide' : 'Show'} what you have kept out ({countLabel(keptOut.length)})
          </Button>
          {showKeptOut && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                Answered, so not waiting on you — listed because this page is the only place they
                appear at all. A kept-out row is hidden from every list and gives nothing back at
                its own address, so if one of these was a mis-click, this is where it comes back.
              </Typography>
              <Stack spacing={2}>
                {keptOut.map(item => (
                  <KeptOutCard key={item.id} item={item} onDone={refresh} />
                ))}
              </Stack>
            </>
          )}
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

function MissingCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
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

/**
 * A row this category refused, with the rule's own words on it.
 *
 * The reason is the whole point of the card. "Refused" alone leaves a curator
 * guessing; "not a museum class — named by Column of Phocas (36 sitelinks)"
 * lets them confirm a rule or spot a bad one, and a bad rule shows up here as a
 * run of near-identical reasons rather than as a mystery.
 */
function RefusedCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
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
        <Typography variant="body2" sx={{ mb: 2 }}>
          {item.admission_reason || 'No reason was recorded.'}
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
function KeptOutCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
  const putBack = useMutation({
    mutationFn: () => setExperienceAdmission(item.id, { decision: 'override' }),
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : admissionOutcomeFor(item, data), item.id),
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {item.admission_reason || 'No reason was recorded.'}
        </Typography>
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

function ConflictCard({ item, onDone }: { item: ReviewQueueItem; onDone: (message?: string, experienceId?: number) => void }) {
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
    onSettled: (data, error) => onDone(
      error ? messageFor(item, error) : outcomeFor(item, data), item.id),
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
