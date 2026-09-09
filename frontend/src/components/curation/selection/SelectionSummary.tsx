/**
 * What the bench shows instead of one card while more than one row is ticked
 * (#852): the selection by kind, by source and by run, and what each answer
 * would do to it. The single-row workflow is untouched — one tick, or none,
 * and the bench is the card it always was.
 */

import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { QueueRow } from '../queueRows';
import {
  ANSWER_WORDS, answerVerb, KIND_NOUN, type AnswerableKind,
} from './answerWords';

function countBy<T extends string | number>(rows: QueueRow[], by: (row: QueueRow) => T | null) {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const key = by(row);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** The queue's facet counts the summary reads under all matching, and the filters they were counted without. */
interface Facets {
  source: Array<{ id: number; name: string; count: number }>;
  /** Counted *before* the set-aside exclusion, so the chip can name a hidden batch; `setAside` says which. */
  run: Array<{ id: number; count: number; setAside: boolean }>;
}

export function SelectionSummary({
  rows, allMatching, reach, facets, sourceIds, runId, showAside, lost, total,
}: {
  rows: QueueRow[];
  allMatching: boolean;
  /**
   * The source and run facets under the current filters, for an all-matching
   * selection: each is counted without its own chip (ADR-0051 decision 3), so
   * the chip's own choice is applied here. Undefined until the first page.
   */
  facets: Facets | undefined;
  /** The source chip's choice, and the run chip's — the filters the facets were counted without. */
  sourceIds: readonly number[];
  runId: number | null;
  /**
   * Whether set-aside batches are on the list. The run facet alone is counted
   * before the set-aside exclusion (so the chip can name a hidden batch), and a
   * batch the walk cannot reach must not be named here as if it could.
   */
  showAside: boolean;
  /**
   * What the answer will reach, by kind — the page decides, since under all
   * matching that is every kind the filters match and not the ticks; the
   * question facet and the "would" lines read it, so the three surfaces
   * agree. Source and run stay the loaded rows', which is what they can see.
   */
  reach: Array<{ kind: AnswerableKind; count: number }>;
  /** Whether *Lost* is on offer — the page decides, against the filters as well as the ticks. */
  lost: boolean;
  total: number;
}) {
  const kinds = reach;
  // The three facets count one population: the ticks, or under all matching
  // every row the filters match — source and run from the queue's own
  // facets, the chip's choice applied since each is counted without it.
  const sources: Array<[string, number]> = allMatching && facets
    ? facets.source
      .filter(s => s.count > 0 && (sourceIds.length === 0 || sourceIds.includes(s.id)))
      .map(s => [s.name, s.count])
    : countBy(rows, row => row.category || null);
  const runs: Array<[number, number]> = allMatching && facets
    ? facets.run
      .filter(r => r.count > 0 && (runId === null || r.id === runId) && (showAside || !r.setAside))
      .map(r => [r.id, r.count])
    : countBy(rows, row => row.runId);
  const answers = (['accept', 'reject', ...(lost ? ['lost' as const] : [])] as const);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {allMatching
          ? `Every question these filters match — ${total.toLocaleString('en')} of them, `
            + `${rows.length.toLocaleString('en')} on screen. One answer goes to all of them, `
            + 'a page at a time.'
          : `${rows.length.toLocaleString('en')} questions ticked. One answer goes to all of them; `
            + 'each object is answered on its own, and the line afterwards says what refused.'}
      </Typography>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Facet label="By question">
              {kinds.map(({ kind, count }) => (
                <li key={kind}>
                  {count.toLocaleString('en')} {KIND_NOUN[kind][count === 1 ? 0 : 1]}
                </li>
              ))}
            </Facet>
            <Facet label="By source">
              {sources.map(([name, count]) => <li key={name}>{count.toLocaleString('en')} from {name}</li>)}
            </Facet>
            {runs.length > 0 && (
              <Facet label="By run">
                {runs.map(([run, count]) => <li key={run}>{count.toLocaleString('en')} asked by run {run}</li>)}
              </Facet>
            )}
            {answers.map(answer => (
              <Facet key={answer} label={`${answerVerb(answer)} would`}>
                {kinds.map(({ kind, count }) => {
                  const words = ANSWER_WORDS[kind][answer];
                  return words ? (
                    <li key={kind}>
                      {count.toLocaleString('en')} {KIND_NOUN[kind][count === 1 ? 0 : 1]}: <strong>{words}</strong>
                    </li>
                  ) : null;
                })}
              </Facet>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

function Facet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2">{label}</Typography>
      {/* The `ul` is the Typography itself: a `div` between a list and its items
          is what stops a screen reader announcing them as a list. */}
      <Typography component="ul" variant="body2" sx={{ m: 0, pl: 2.5 }}>
        {children}
      </Typography>
    </Box>
  );
}
