/**
 * Who decided what about this field, and when.
 *
 * The screen used to say "Keep my edit (current)" about a claim another curator made,
 * and named the run only *after* someone acted, in the outcome alert. So a curator was
 * asked to choose between two texts without being told whose the standing one was, when
 * the source last proposed otherwise, or that the same field had already been answered
 * twice.
 *
 * No new storage: the claim's author is the most recent `edited` entry in
 * `experience_curation_log`, earlier answers are its `accepted_source` **and**
 * `declined_source` entries, and the run's date is on the log row the item already names.
 * Both kinds, because a field can have been answered either way and a trail showing one of
 * them reports it as its opposite. The queue reads them; this renders them, each with the
 * verb its own action earned.
 */

import { Stack, Typography } from '@mui/material';
import { formatDateTime } from '../../utils/dateFormat';

export interface FieldProvenance {
  claim?: { by: string; at: string } | null;
  decidedBefore?: Array<{
    by: string;
    at: string;
    /** Which answer it was. Absent on rows written before refusing was possible. */
    action?: 'accepted_source' | 'declined_source';
    /** What that answer was about: the value taken, or the one refused. */
    applied: unknown;
  }>;
}

/**
 * A past answer's value, short enough for a line in the trail and marked where it is cut.
 *
 * Cut rather than dropped, and the difference from `FieldDiff` is the difference between
 * the two: there, both values are what the decision rests on and a hidden character can
 * change the answer, so nothing is cut. Here it is a line of history, and the question is
 * "what did they take" — the opening of it answers that, silence does not. Silence is also
 * ambiguous in the worst way: it reads identically to an acceptance that applied nothing.
 *
 * The length matters because of which field this is for. `shortDescription` acceptances run
 * to 1339 characters and average 841 (`wordDiff.ts`), so any test a long value fails hides
 * the trail on the only field it was built for — `name`, at 37 characters, is the field a
 * curator can already compare at a glance.
 */
function taken(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 120).trimEnd()}…`;
}

/** What the source's proposal is worth reading against: whose text, and how old. */
export function ProvenanceTrail({ field, runCompletedAt }: {
  field: FieldProvenance;
  runCompletedAt?: string | null;
}) {
  const earlier = field.decidedBefore ?? [];
  if (!field.claim && !runCompletedAt && earlier.length === 0) return null;

  return (
    <Stack spacing={0.25} sx={{ mt: 0.5 }}>
      {field.claim && (
        <Typography variant="caption" color="text.secondary">
          Claimed by {field.claim.by} on {formatDateTime(field.claim.at)}
        </Typography>
      )}
      {runCompletedAt && (
        <Typography variant="caption" color="text.secondary">
          Proposed by the run that finished {formatDateTime(runCompletedAt)}
        </Typography>
      )}
      {/* Every earlier answer, not a count of them: "answered twice before" tells a
          curator they are in a loop and nothing about what to do; the values and the
          names tell them whether the source has changed its mind or they have. */}
      {earlier.map(decision => (
        <Typography key={`${decision.at}`} variant="caption" color="text.secondary">
          {/* Which answer it was, in the verb: a trail that reported both as "took the
              source's value" would tell a curator the field went the other way every
              time. Rows written before refusing existed carry no action and are
              acceptances by construction — nothing else could have been recorded. */}
          {decision.by}
          {decision.action === 'declined_source'
            ? ' refused the source’s value on '
            : ' took the source’s value on '}
          {formatDateTime(decision.at)}
          {typeof decision.applied === 'string' && decision.applied.length > 0
            ? `: “${taken(decision.applied)}”`
            : ''}
        </Typography>
      ))}
    </Stack>
  );
}
