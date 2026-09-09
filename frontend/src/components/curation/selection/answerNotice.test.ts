/**
 * Tests for the line after a batch answer (#852): each clause is a claim about
 * what happened, and each is pinned on its own.
 */

import { describe, it, expect } from 'vitest';
import type { ReviewAnswerResult } from '../../../api/experiences';
import { answerNoticeFor, stoppedNoticeFor } from './answerNotice';
import { AnswerStopped } from './answerRows';

type Answered = ReviewAnswerResult['answered'][number];

function answered(over: Partial<Answered>): Answered {
  return { kind: 'waiting', id: 1, name: 'Chartres Cathedral', answer: 'accept', did: {}, ...over };
}

function result(over: Partial<ReviewAnswerResult>): ReviewAnswerResult {
  return { answer: 'accept', answered: [], refused: [], outOfScope: 0, placementFailed: [], ...over };
}

describe('answerNoticeFor', () => {
  it('tells published arrivals, applied held changes and released contents apart, and says what became visible', () => {
    const line = answerNoticeFor(result({
      answered: [
        answered({ did: { published: 1, locations: 2, treasureLinks: 0, treasures: 0 } }),
        answered({ id: 2, name: 'Reims', did: { published: 1, locations: 1 } }),
        answered({ id: 3, name: 'Louvre', did: { published: 0, fields: 2, treasureLinks: 3, treasures: 1 } }),
        answered({ id: 4, name: 'Prado', did: { published: 0, locations: 0, treasureLinks: 12, treasures: 12 } }),
      ],
    }));
    // The Louvre row held a change and released works: it counts under both.
    expect(line).toBe('2 objects published, 1 held change applied, unread contents of 2 objects released. '
      + '3 points and 15 works now visible.');
  });

  it('names kept-out arrivals, refused held changes and turned-down contents on a reject, and nothing as visible', () => {
    const line = answerNoticeFor(result({
      answer: 'reject',
      answered: [
        answered({ answer: 'reject', did: { published: 0 } }),
        answered({ id: 2, answer: 'reject', did: { fields: 4, locations: 4 } }),
        answered({ id: 3, answer: 'reject', did: { locations: 4, treasureLinks: 0 } }),
      ],
    }));
    // The second row held a change *and* unread points: both halves are said,
    // because both happened — the ticks show one kind and the answer reaches two.
    expect(line).toBe('1 arrival kept out, 1 held change refused, unread contents of 2 objects turned down.');
  });

  it('phrases each other kind in the words its card uses', () => {
    expect(answerNoticeFor(result({
      answered: [answered({ kind: 'conflict' }), answered({ kind: 'refused', id: 2 })],
    }))).toBe('The source’s value taken on 1 object; 1 refusal put back.');
    expect(answerNoticeFor(result({
      answer: 'lost',
      answered: [
        answered({ kind: 'missing', answer: 'lost' }),
        answered({ kind: 'withdrawn', answer: 'lost', did: { points: 3, pointsRefused: 1 } }),
      ],
    }))).toBe('1 object recorded as no longer existing; 3 places recorded as no longer existing, '
      + '1 place left as it stands (someone else answered first).');
  });

  it('groups refusals by reason, counts what was out of scope and names stale placements', () => {
    const line = answerNoticeFor(result({
      answered: [answered({ did: { published: 1, withdrawalsReleased: 1 } })],
      refused: [
        { kind: 'waiting', id: 5, name: 'A', error: 'Someone else answered this first' },
        { kind: 'waiting', id: 6, name: 'B', error: 'Someone else answered this first' },
      ],
      outOfScope: 2,
      placementFailed: [{ id: 1, name: 'Chartres Cathedral', worldViews: [{ id: 5, name: 'Administrative' }] }],
    }));
    expect(line).toBe('1 object published. 1 replaced point no longer shown. '
      + '2 objects refused — A, B. Each: “Someone else answered this first”. '
      + '2 objects outside your scope, left alone. '
      + '1 object answered but could not be re-placed into its regions — Chartres Cathedral in '
      + 'Administrative (world view 5). Tell an admin.');
  });

  it('says nothing was answered only when nothing at all came back', () => {
    expect(answerNoticeFor(result({}))).toBe('Nothing was answered.');
    expect(answerNoticeFor(result({ outOfScope: 1 }))).toBe('Nothing was changed. 1 object outside your scope, left alone.');
  });
});

describe('stoppedNoticeFor', () => {
  it('reports what landed and that the rows in flight may already be answered', () => {
    const stopped = new AnswerStopped('Failed to fetch', result({
      answered: [answered({ did: { published: 1 } })],
    }), 100);
    expect(stoppedNoticeFor(stopped)).toBe('1 object published. Then the batch stopped: Failed to fetch. '
      + 'The 100 rows it was sending may already be answered — reload to see what is still waiting.');
  });

  it('says so when it stopped before reporting anything', () => {
    const stopped = new AnswerStopped('timeout', result({}), 3);
    expect(stoppedNoticeFor(stopped)).toContain('The batch stopped before anything was reported: timeout.');
  });

  it('keeps the refusals of a page nobody answered when a later request failed', () => {
    const stopped = new AnswerStopped('timeout', result({
      refused: [{ kind: 'waiting', id: 5, name: 'A', error: 'Someone else answered this first' }],
    }), 3);
    expect(stoppedNoticeFor(stopped)).toContain('A refused — Someone else answered this first. Then the batch stopped: timeout.');
  });

  it('puts nothing in doubt when it stopped between requests', () => {
    const stopped = new AnswerStopped('Failed to fetch', result({
      answered: [answered({ did: { published: 1 } })],
    }), 0);
    expect(stoppedNoticeFor(stopped)).toBe('1 object published. Then the batch stopped: Failed to fetch. '
      + 'Nothing was in flight; reload to see what is still waiting.');
  });
});
