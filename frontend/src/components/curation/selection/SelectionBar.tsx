/**
 * The bar that stands at the foot of the page while anything is ticked (#852).
 *
 * The shape every design system documents for a bulk action: it names the
 * selection by kind and keeps the count in view, offers the two answers a
 * proposal has — and the third, *Lost*, only where every row is one of the
 * two kinds that have it — and says, under each, what that answer does for
 * the kinds in the selection, in the words their own cards use. Page-fixed
 * rather than inside either column, because the list and the bench scroll on
 * their own and a bar inside one would leave with it.
 */

import { useState } from 'react';
import {
  Box, Button, Collapse, LinearProgress, Paper, Stack, Typography,
} from '@mui/material';
import type { ReviewAnswer } from '../../../api/experiences';
import type { QueueRow } from '../queueRows';
import {
  ANSWER_WORDS, countLine, KIND_NOUN, type AnswerableKind,
} from './answerWords';
import type { AnswerProgress } from './answerRows';

export function SelectionBar({
  rows, allMatching, reach, lost, total, progress, onAnswer, onClear,
}: {
  /** The ticked rows, as loaded. */
  rows: QueueRow[];
  /** Every row the filters match, past the loaded pages. */
  allMatching: boolean;
  /**
   * What the answer will reach, by kind — the page decides (`useAnswerSelection`),
   * since under all matching that is every kind the filters match and not the
   * ticks; the expander and the confirmation then say the same thing.
   */
  reach: Array<{ kind: AnswerableKind; count: number }>;
  /** Whether *Lost* is on offer — the page decides, since it sees the filters too (`lostOfferedFor`). */
  lost: boolean;
  /** The filtered total, which is what an all-matching selection is. */
  total: number;
  /** The batch in flight, or null. */
  progress: AnswerProgress | null;
  onAnswer: (answer: ReviewAnswer) => void;
  onClear: () => void;
}) {
  const [showing, setShowing] = useState<ReviewAnswer | null>(null);
  if (rows.length === 0 && !allMatching) return null;
  const busy = progress !== null;
  const kinds = reach;

  const heading = allMatching
    ? `All ${total.toLocaleString('en')} matching these filters`
    : countLine(rows);
  const refusedSoFar = progress && progress.refused > 0
    ? `, ${progress.refused.toLocaleString('en')} refused` : '';
  const leftAlone = progress && progress.outOfScope > 0
    ? `, ${progress.outOfScope.toLocaleString('en')} outside your scope` : '';
  const line = progress
    ? `Answered ${progress.answered.toLocaleString('en')} of ${progress.of.toLocaleString('en')}${refusedSoFar}${leftAlone}…`
    : heading;

  return (
    <Paper
      elevation={8}
      role="region"
      aria-label="Selected questions"
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: theme => theme.zIndex.appBar,
        px: 3, py: 1.5, borderTop: 1, borderColor: 'divider',
      }}
    >
      {busy && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />}
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}>
          {line}
          {/* An all-matching selection is drawn from the page's ticks and is
              wider than them: the line under it says what the ticks are. */}
          {allMatching && !busy && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              ({countLine(rows)} on screen)
            </Typography>
          )}
        </Typography>
        <Button size="small" onClick={onClear} disabled={busy}>Clear</Button>
        <AnswerButton
          answer="accept" label="Accept the proposed changes" color="primary"
          busy={busy} showing={showing} setShowing={setShowing} onAnswer={onAnswer}
        />
        <AnswerButton
          answer="reject" label="Reject the proposed changes" color="warning"
          busy={busy} showing={showing} setShowing={setShowing} onAnswer={onAnswer}
        />
        {lost && (
          <AnswerButton
            answer="lost" label="Lost" color="error"
            busy={busy} showing={showing} setShowing={setShowing} onAnswer={onAnswer}
          />
        )}
      </Stack>
      {/* What the chosen answer does, one line per kind in the selection, in
          the words the kind's own card uses — so a batch and a card read alike.
          The one region every toggle's `aria-controls` names. */}
      <Collapse in={showing !== null}>
        <Box component="ul" id={EXPLANATION_ID} sx={{ m: 0, mt: 1, pl: 2.5 }}>
          {showing !== null && kinds.map(({ kind, count }) => {
            const words = ANSWER_WORDS[kind][showing];
            if (!words) return null;
            return (
              <Typography component="li" variant="caption" key={kind}>
                {count.toLocaleString('en')} {KIND_NOUN[kind][count === 1 ? 0 : 1]}
                {' — proposes to '}{ANSWER_WORDS[kind].proposes}{': '}
                <strong>{words}</strong>
              </Typography>
            );
          })}
        </Box>
      </Collapse>
    </Paper>
  );
}

/** The explanation list's id, for every toggle's `aria-controls`. */
const EXPLANATION_ID = 'selection-bar-explanation';

/**
 * One answer, and the toggle that says what it does. The toggle names the
 * explanation as what it controls; the answer button answers on its click,
 * and it is the page — not this bar — that asks first where the batch reaches
 * past one page or past the loaded rows (`useAnswerSelection`).
 */
function AnswerButton({
  answer, label, color, busy, showing, setShowing, onAnswer,
}: {
  answer: ReviewAnswer;
  label: string;
  color: 'primary' | 'warning' | 'error';
  busy: boolean;
  showing: ReviewAnswer | null;
  setShowing: (a: ReviewAnswer | null) => void;
  onAnswer: (a: ReviewAnswer) => void;
}) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Button
        size="small"
        variant="contained"
        color={color}
        disabled={busy}
        onClick={() => onAnswer(answer)}
      >
        {label}
      </Button>
      <Button
        size="small"
        variant="text"
        aria-expanded={showing === answer}
        aria-controls={EXPLANATION_ID}
        onClick={() => setShowing(showing === answer ? null : answer)}
      >
        {showing === answer ? 'Hide' : 'What it does'}
      </Button>
    </Stack>
  );
}
