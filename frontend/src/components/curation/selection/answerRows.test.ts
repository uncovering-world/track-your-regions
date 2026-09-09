/**
 * Tests for sending a selection a page at a time (#852).
 *
 * Two claims: the rows on screen go in chunks of the page maximum, with the
 * merged report growing between them; and an all-matching selection is walked
 * through the filtered read — the first page after every answer, and past a
 * page holding nothing untried by the queue's own cursor — so refused rows are
 * neither asked again nor allowed to end the walk with matching rows behind them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../api/experiences', () => ({
  answerReviewRows: vi.fn(),
  fetchReviewQueue: vi.fn(),
  REVIEW_ANSWER_ROWS_MAX: 2,
}));

import { answerReviewRows, fetchReviewQueue, type ReviewAnswerResult } from '../../../api/experiences';
import { answerAllMatching, answerRows, AnswerStopped, toAnswerRow } from './answerRows';
import type { QueueRow } from '../queueRows';

const mockedAnswer = answerReviewRows as unknown as ReturnType<typeof vi.fn>;
const mockedFetch = fetchReviewQueue as unknown as ReturnType<typeof vi.fn>;

function row(key: string, over: Partial<QueueRow> = {}): QueueRow {
  const [kind, id] = key.split(':');
  return {
    key, kind: kind as QueueRow['kind'], id: Number(id), name: key, category: 'Places of worship',
    question: '', askedAt: null, runId: 105, specific: '', subs: [], ...over,
  };
}

function report(names: string[], over: Partial<ReviewAnswerResult> = {}): ReviewAnswerResult {
  return {
    answer: 'accept',
    answered: names.map((name, i) => ({ kind: 'waiting', id: i, name, answer: 'accept', did: {} })),
    refused: [], outOfScope: 0, placementFailed: [], ...over,
  };
}

const ADDRESS = {
  q: '', sourceIds: [4], kinds: [], regionId: null, runId: null, showAside: false,
  sort: 'date' as const, row: 'waiting:1',
};

beforeEach(() => {
  mockedAnswer.mockReset();
  mockedFetch.mockReset();
});

describe('toAnswerRow', () => {
  it('sends the server’s kind word, and the run the row was asked by', () => {
    expect(toAnswerRow(row('conflicts:7', { runId: 98 }))).toEqual({ kind: 'conflict', id: 7, runId: 98 });
    expect(toAnswerRow(row('waiting:9'))).toEqual({ kind: 'waiting', id: 9, runId: 105 });
  });
});

describe('answerRows', () => {
  it('sends the rows a page at a time and merges the reports, reporting progress between pages', async () => {
    mockedAnswer
      .mockResolvedValueOnce(report(['a', 'b']))
      .mockResolvedValueOnce(report(['c'], { refused: [{ kind: 'waiting', id: 3, name: 'd', error: 'no' }] }));
    const progress = vi.fn();

    const merged = await answerRows(
      [row('waiting:1'), row('waiting:2'), row('waiting:3'), row('waiting:4')], 'accept', progress);

    expect(mockedAnswer).toHaveBeenCalledTimes(2);
    expect(mockedAnswer.mock.calls[0][0]).toHaveLength(2);
    expect(merged.answered.map(r => r.name)).toEqual(['a', 'b', 'c']);
    expect(merged.refused).toHaveLength(1);
    expect(progress).toHaveBeenNthCalledWith(1, { answered: 2, refused: 0, outOfScope: 0, of: 4 });
    expect(progress).toHaveBeenNthCalledWith(2, { answered: 3, refused: 1, outOfScope: 0, of: 4 });
  });

  it('rethrows a transport failure with what had landed and what was in flight', async () => {
    mockedAnswer
      .mockResolvedValueOnce(report(['a', 'b']))
      .mockRejectedValueOnce(new Error('Failed to fetch'));

    const failure = await answerRows(
      [row('waiting:1'), row('waiting:2'), row('waiting:3')], 'accept', vi.fn()).catch(e => e);

    expect(failure).toBeInstanceOf(AnswerStopped);
    expect((failure as AnswerStopped).partial.answered).toHaveLength(2);
    expect((failure as AnswerStopped).inFlight).toBe(1);
    expect((failure as AnswerStopped).message).toBe('Failed to fetch');
  });
});

describe('answerAllMatching', () => {
  /** A queue page holding these arrivals, in the endpoint's shape, with the cursor to the next. */
  function page(ids: number[], nextCursor: string | null = null) {
    return {
      order: ids.map(id => ({ kind: 'waiting', id, askedAt: null, runId: 105, subs: ['arrival'] })),
      arrivals: ids.map(id => ({ id, name: `#${id}`, category_name: 'Places of worship' })),
      held: [], contents: [], conflicts: [], missing: [], refused: [], withdrawn: [],
      keptOut: [], answeredWithdrawals: [], total: ids.length, limit: 2,
      paging: { cursor: null, nextCursor },
    };
  }

  it('reads past a page of stubborn rows by the queue’s cursor rather than stopping', async () => {
    // Rows 1 and 2 refuse and stay; the next read's first page is still them,
    // with a cursor — row 3 is behind it and must be reached.
    mockedFetch
      .mockResolvedValueOnce(page([1, 2], 'c1'))
      .mockResolvedValueOnce(page([1, 2], 'c1'))
      .mockResolvedValueOnce(page([3]))
      .mockResolvedValueOnce(page([1, 2], 'c1'))
      .mockResolvedValueOnce(page([]));
    mockedAnswer
      .mockResolvedValueOnce(report([], { refused: [1, 2].map(id => ({ kind: 'waiting', id, name: `#${id}`, error: 'no' })) }))
      .mockResolvedValueOnce(report(['#3']));

    const merged = await answerAllMatching(ADDRESS, 3, 'accept', vi.fn());

    expect(mockedFetch.mock.calls.map(c => (c[0] as { cursor?: string }).cursor))
      .toEqual([undefined, undefined, 'c1', undefined, 'c1']);
    expect(merged.answered.map(r => r.name)).toEqual(['#3']);
    expect(merged.refused).toHaveLength(2);
  });

  it('re-reads the first page under the filters until a page holds nothing it has not tried', async () => {
    mockedFetch
      .mockResolvedValueOnce(page([1, 2]))
      .mockResolvedValueOnce(page([3]))
      // Row 3 refused and is still there: the walk must not ask about it again.
      .mockResolvedValueOnce(page([3]));
    mockedAnswer
      .mockResolvedValueOnce(report(['#1', '#2']))
      .mockResolvedValueOnce(report([], { refused: [{ kind: 'waiting', id: 3, name: '#3', error: 'no' }] }));
    const progress = vi.fn();

    const merged = await answerAllMatching(ADDRESS, 3, 'accept', progress);

    expect(mockedFetch).toHaveBeenCalledTimes(3);
    // The page maximum as the limit, the open row left out, the filters kept.
    expect(mockedFetch.mock.calls[0][0]).toMatchObject({ limit: 2, row: null, sourceIds: [4] });
    expect(mockedAnswer).toHaveBeenCalledTimes(2);
    expect(merged.answered).toHaveLength(2);
    expect(merged.refused).toHaveLength(1);
    expect(progress).toHaveBeenLastCalledWith({ answered: 2, refused: 1, outOfScope: 0, of: 3 });
  });

  it('keeps the report when a queue re-read fails mid-walk, with nothing in flight', async () => {
    mockedFetch
      .mockResolvedValueOnce(page([1, 2]))
      .mockRejectedValueOnce(new Error('Failed to fetch'));
    mockedAnswer.mockResolvedValueOnce(report(['#1', '#2']));

    const failure = await answerAllMatching(ADDRESS, 3, 'accept', vi.fn()).catch(e => e);

    expect(failure).toBeInstanceOf(AnswerStopped);
    expect((failure as AnswerStopped).partial.answered).toHaveLength(2);
    expect((failure as AnswerStopped).inFlight).toBe(0);
  });

  it('answers nothing and stops when the filters match nothing', async () => {
    mockedFetch.mockResolvedValueOnce(page([]));
    const merged = await answerAllMatching(ADDRESS, 0, 'reject', vi.fn());
    expect(mockedAnswer).not.toHaveBeenCalled();
    expect(merged.answered).toHaveLength(0);
  });
});
