/**
 * The one question a curator is looking at, and everything it rests on.
 *
 * The cards are unchanged from when they were a stack — they were already the right size
 * for this; what changes is that exactly one is on screen. That is the point of the split:
 * the evidence a decision needs (both versions in full, the object, the works a rule
 * counted) is what made a scrollable stack unworkable, and it is exactly what a curator
 * wants when the question is the one in front of them.
 */

import { Alert, Box, Typography } from '@mui/material';
import type { QueueRow, RowKind } from './queueRows';
import { MissingCard, RefusedCard, ConflictCard } from './ReviewQueue';
import { GatedCard } from './WaitingToPublish';

/**
 * What this kind of question means, above the card that answers it.
 *
 * These were section preambles when the page was one column, and they have to survive the
 * split — they are the only place the *class* of question is explained, and a curator
 * meeting their first refusal needs to know that the row is already hidden from readers
 * before they read a word of the rule. On the bench they are better placed than they were:
 * shown once, beside the decision, rather than once above nineteen of them.
 */
const KIND_NOTE: Record<RowKind, string> = {
  conflicts: 'Your version is the one visitors see. The source has been proposing something '
    + 'else, and will keep proposing it until you answer.',
  waiting: 'This came from a source held back until a person looks, so none of it has reached '
    + 'a visitor: an object nobody has passed yet, a change kept off a page readers can '
    + 'already see, or newly-arrived points and works under a row that is visible. '
    + 'Publishing is what lets it out, and nothing else does.',
  refused: 'Every list here has a rule of ours for what belongs in it, and this failed it — so '
    + 'visitors have never seen it. The source may well still list it. The question is not '
    + 'whether the object is interesting, but whether our rule was right about it.',
  missing: 'A run that finished without errors stopped finding this. That can mean the source '
    + 'delisted it, that it no longer exists, or that the source was simply wrong — and only '
    + 'the first two change anything.',
};

export function ReviewBench({ row, onDone }: {
  row: QueueRow | undefined;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  if (!row) {
    return (
      <Box sx={{ p: 4 }}>
        {/* Reachable for the one render between a row being answered away and the page
            choosing the next one — and only that, since the list always has a selection
            otherwise. No mention of keys: nothing in this branch binds one, and the
            keyboard is deliberately deferred to 1.0. */}
        <Typography color="text.secondary">
          Pick a question on the left.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {KIND_NOTE[row.kind]}
      </Typography>
      {row.kind === 'conflicts' && row.item && <ConflictCard item={row.item} onDone={onDone} />}
      {row.kind === 'refused' && row.item && <RefusedCard item={row.item} onDone={onDone} />}
      {row.kind === 'missing' && row.item && <MissingCard item={row.item} onDone={onDone} />}
      {row.kind === 'waiting' && row.group && <GatedCard group={row.group} onDone={onDone} />}
      {/* A row whose payload is missing is a bug in the row builder rather than a state a
          curator can be in — but silence here would read as "nothing to decide", which is
          the one answer this screen must never give by accident. */}
      {!row.item && !row.group && (
        <Alert severity="warning">
          This question could not be opened. Reload the page; if it persists, the queue and
          the screen disagree about what {row.name} is asking.
        </Alert>
      )}
    </Box>
  );
}
