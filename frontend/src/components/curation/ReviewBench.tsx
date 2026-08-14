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
import type { QueueRow } from './queueRows';
import { MissingCard, RefusedCard, ConflictCard } from './ReviewQueue';
import { GatedCard } from './WaitingToPublish';

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
