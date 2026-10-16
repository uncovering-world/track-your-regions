/**
 * A run asks again about a pinned answer (#1367, #1370). Villa Farnesina was put
 * back into Art Museums on 2026-08-08 over "probe: site class villa"; the run of
 * 2026-10-07 refuses it as "site, not a venue: villa — named by Galatea (25
 * sitelinks)". The card names both, and its two answers send what it showed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ answerPinQuestion: vi.fn() }));

import { answerPinQuestion } from '../../api/curation';
import { PinQuestionCard } from './PinQuestionCard';

const mockedAnswer = answerPinQuestion as unknown as ReturnType<typeof vi.fn>;

const FARNESINA = {
  id: 6287, external_id: 'Q1145530', name: 'Villa Farnesina', kind_name: 'Art Museums', kind: 'pin-question',
  membership_id: 6260, proposed: null,
  pin_question: {
    answer: 'admitted', answeredVerdict: 'refused', answeredReason: 'probe: site class villa — put back by the kept-out card',
    askedVerdict: 'refused', askedReason: 'site, not a venue: villa — named by Galatea (25 sitelinks)',
    askedAt: '2026-10-07T09:12:00Z', restated: false, answeredAt: '2026-08-08T14:00:00Z', note: 'Raphael’s frescoes are the point',
  },
} as unknown as ReviewQueueItem;

function show(items: ReviewQueueItem[], onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PinQuestionCard items={items} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('a pin a run no longer agrees with', () => {
  beforeEach(() => mockedAnswer.mockReset());

  it("says what the curator answered and the note, and what the run says now", () => {
    show([FARNESINA]);
    expect(screen.getByText(/You put it back on .* — “Raphael’s frescoes are the point”/)).toBeTruthy();
    expect(screen.getByText(/A run on .* says something else:/)).toBeTruthy();
  });

  it('keeps the answer, sending the question it showed', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 6287, membershipId: 6260, admission: 'admitted', pinned: true });
    const onDone = show([FARNESINA]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my answer' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(6287, {
      decision: 'keep', membershipId: 6260,
      asked: { verdict: 'refused', reason: 'site, not a venue: villa — named by Galatea (25 sitelinks)' },
      note: undefined,
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Villa Farnesina: your answer stands in Art Museums', 6287));
  });

  it('lets the rule decide, and says where the place now stands', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 6287, membershipId: 6260, admission: 'refused', pinned: false });
    const onDone = show([FARNESINA]);
    fireEvent.click(screen.getByRole('button', { name: 'Let the rule decide — keep it out' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Villa Farnesina: out of Art Museums, as the rule now decides', 6287));
  });

  it('offers to admit where the rule would now take in what a curator kept out', () => {
    show([{
      ...FARNESINA, name: 'British Museum',
      pin_question: { ...FARNESINA.pin_question!, answer: 'refused', askedVerdict: 'admitted', askedReason: null },
    } as ReviewQueueItem]);
    expect(screen.getByText(/You kept it out/)).toBeTruthy();
    expect(screen.getByText('The rule would now admit it to Art Museums.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Let the rule decide — admit it' })).toBeTruthy();
  });

  it('says a question asked again on request is the answered words, not a change (#1370)', () => {
    // The Gardner: put back over "its famous works cannot be seen", and an admin's run to ask
    // again about the pins says the same.
    const reason = 'its famous works cannot be seen — The Storm on the Sea of Galilee (whereabouts unknown)';
    show([{
      ...FARNESINA, name: 'Isabella Stewart Gardner Museum',
      pin_question: { ...FARNESINA.pin_question!, answeredReason: reason, askedReason: reason, restated: true },
    } as ReviewQueueItem]);
    expect(screen.getByText(/was asked to look again at the answers pinned against the rule, and still says what you answered over/)).toBeTruthy();
    expect(screen.queryByText(/says something else/)).toBeNull();
    // The reason is shown once, as what the curator answered over.
    expect(screen.getAllByText(/The Storm on the Sea of Galilee/)).toHaveLength(1);
  });

  it("still says the rule would admit what the curator kept out, when that is asked again (#1370)", () => {
    show([{
      ...FARNESINA, name: 'British Museum',
      pin_question: {
        ...FARNESINA.pin_question!, answer: 'refused', answeredVerdict: 'admitted', answeredReason: null,
        askedVerdict: 'admitted', askedReason: null, restated: true,
      },
    } as ReviewQueueItem]);
    expect(screen.getByText(/still says what you answered over/)).toBeTruthy();
    expect(screen.getByText('The rule would now admit it to Art Museums.')).toBeTruthy();
  });
});
