/**
 * The page's side of answering a selection (#852): when to ask first, what
 * to send, what to say afterwards, and what to re-read.
 *
 * A hook beside the selection rather than more of `ReviewPage.tsx`: the
 * page's job is the columns, the notice line and which question is open,
 * and this is a workflow of its own with three states — idle, confirming,
 * in flight — that the page only has to draw.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BatchReason, ReviewAnswer } from '../../../api/reviewQueue';
import { CURATION_REASON_WORDS } from '@tyr/shared/curationLog';
import type { ReviewAddress } from '../../../utils/appUrl';
import { invalidateAfterBatchPublication } from '../../../utils/queryInvalidation';
import type { QueueRow } from '../queueRows';
import { answerNoticeFor, stoppedNoticeFor } from './answerNotice';
import {
  answerAllMatching, answerRows, answerRowsFor, AnswerStopped, type AnswerProgress,
} from './answerRows';
import {
  ANSWER_WORDS, countByKind, gatedKindsAlsoReached, KIND_NOUN, matchingKindCounts, type AnswerableKind,
} from './answerWords';
import type { RowSelection } from './useRowSelection';

/** What a gated kind filter's rows may hold beside what it names, as the note says it. */
const ALSO_HELD: Partial<Record<AnswerableKind, string>> = {
  contents: 'the unread points and works',
  held: 'the held change',
};

export interface AnswerSelection {
  /** The batch in flight, or null. */
  progress: AnswerProgress | null;
  /** The answer waiting on a confirmation, or null. */
  confirming: ReviewAnswer | null;
  /** What the confirmation says the answer will do, one line per kind, in the cards' words. */
  confirmLines: string[];
  /** What the answer reaches beyond the lines, where a kind filter lists rows by one of their sub-kinds. */
  confirmNote: string | null;
  /** What the answer will reach, by kind — the ticks, or every kind the filters match under all matching. */
  reach: Array<{ kind: AnswerableKind; count: number }>;
  /**
   * Answer now, or ask first where the batch reaches past one page; a
   * rejection that turns arrivals away with the reason picked for all of them.
   */
  answer: (answer: ReviewAnswer, reason?: BatchReason) => void;
  confirm: () => void;
  cancel: () => void;
}

function couldNotStart(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `The batch could not start: ${reason}`;
}

/**
 * One line per kind in the selection: the count, and what this answer does to
 * it; the arrivals' line names the reason they are turned away for.
 */
function confirmLinesFor(
  counts: Array<{ kind: AnswerableKind; count: number }>, answer: ReviewAnswer, reason?: BatchReason,
): string[] {
  const lines: string[] = [];
  for (const { kind, count } of counts) {
    const words = ANSWER_WORDS[kind][answer];
    if (!words) continue;
    const noun = KIND_NOUN[kind][count === 1 ? 0 : 1];
    const why = kind === 'arrival' && reason ? ` (${CURATION_REASON_WORDS[reason.reasonCode]})` : '';
    lines.push(`${count.toLocaleString('en')} ${noun}: ${words}${why}`);
  }
  return lines;
}

export function useAnswerSelection({
  address, rows, selection, total, pageSize, facets, setNotice,
}: {
  address: ReviewAddress;
  /** The ticked rows, as loaded. */
  rows: QueueRow[];
  selection: RowSelection;
  total: number;
  pageSize: number;
  /** The queue's facet counts under the current filters — what an all-matching selection holds. */
  facets: { kind: Array<{ kind: string; count: number }> } | undefined;
  setNotice: (notice: string | null) => void;
}): AnswerSelection {
  // What the answer will reach, by kind: the ticks, or — for an all-matching
  // selection, which reaches rows the ticks do not show — every kind the
  // filters match, from the queue's own counts.
  const reach = selection.allMatching ? matchingKindCounts(facets, address.kinds) : countByKind(rows);
  // Under a gated kind filter the walk also reaches the other gated sub-kind
  // of every row it meets — named in the confirmation, since it cannot be
  // counted.
  const alsoReached = selection.allMatching ? gatedKindsAlsoReached(address.kinds) : [];
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<AnswerProgress | null>(null);
  const [confirming, setConfirming] = useState<ReviewAnswer | null>(null);
  // The reason picked with the answer waiting on its confirmation, sent with it.
  const [confirmingReason, setConfirmingReason] = useState<BatchReason | undefined>(undefined);

  /**
   * One answer to every ticked row — the rows on screen a page at a time, or
   * every row the filters match, walked through the filtered read. The
   * selection is cleared and the batch invalidation run whatever happened:
   * each object was its own transaction, so a stopped batch changed things too.
   */
  const run = async (answer: ReviewAnswer, reason?: BatchReason) => {
    setConfirming(null);
    setConfirmingReason(undefined);
    setNotice(null);
    setProgress({
      answered: 0, refused: 0, outOfScope: 0, of: selection.allMatching ? total : answerRowsFor(rows).length,
    });
    try {
      const report = selection.allMatching
        ? await answerAllMatching(address, total, answer, setProgress, reason)
        : await answerRows(rows, answer, setProgress, reason);
      setNotice(answerNoticeFor(report));
    } catch (error) {
      setNotice(error instanceof AnswerStopped ? stoppedNoticeFor(error) : couldNotStart(error));
    } finally {
      setProgress(null);
      selection.clear();
      // The batch form of the invalidation, for the reason the admin's release
      // uses it: a hundred objects changed, and the region batch that draws
      // their pins is what a single object's invalidation cannot reach. The
      // queue's own key is in it.
      invalidateAfterBatchPublication(queryClient);
    }
  };

  // Without a confirmation for a batch within one page, since the count is on
  // the bar and every answer has a take-back at the foot of the page; asked once
  // past that, and for an all-matching selection, whose size the ticks do not
  // show. Turning down unread contents follows the same confirmation rule as
  // the other answers: it has the list and the take-back its neighbours have
  // (#859).
  const answer = (which: ReviewAnswer, reason?: BatchReason) => {
    if (selection.allMatching || rows.length > pageSize) {
      setConfirming(which);
      setConfirmingReason(reason);
    } else void run(which, reason);
  };

  const confirmLines = confirming === null ? [] : confirmLinesFor(reach, confirming, confirmingReason);
  const confirmNote = confirming === null || alsoReached.length === 0 ? null
    : `A row this filter lists is answered whole, so ${alsoReached.map(kind => ALSO_HELD[kind]).join(' and ')} `
      + `a row may also hold are answered too: ${alsoReached
        .map(kind => ANSWER_WORDS[kind][confirming] ?? '')
        .filter(Boolean)
        .join('; ')}.`;

  return {
    progress,
    confirming,
    confirmLines,
    confirmNote,
    reach,
    answer,
    confirm: () => { if (confirming) void run(confirming, confirmingReason); },
    cancel: () => { setConfirming(null); setConfirmingReason(undefined); },
  };
}
