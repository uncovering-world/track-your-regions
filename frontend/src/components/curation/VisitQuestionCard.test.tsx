/**
 * A run asks about an offered place with nothing to see (#1770). Eboracum,
 * Roman York, is offered by Archaeology with no witness vouching for it, and
 * Jev reads it at 90 % as not one place. The card says what vouched and what
 * did not, and its two answers send the membership it asks about.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ answerVisitQuestion: vi.fn() }));

import { answerVisitQuestion } from '../../api/curation';
import { VisitQuestionCard, witnessLines } from './VisitQuestionCard';

const mockedAnswer = answerVisitQuestion as unknown as ReturnType<typeof vi.fn>;

const EBORACUM = {
  id: 9771, external_id: 'Q958954', name: 'Eboracum', kind_name: 'Archaeology', kind: 'visit-question',
  membership_id: 9790, proposed: null,
  visit_question: { witnesses: [], reading: 'not-a-place', confidence: 0.9, askedAt: '2026-10-21T03:37:58Z' },
} as unknown as ReviewQueueItem;

function show(items: ReviewQueueItem[], onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VisitQuestionCard items={items} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('an offered place with nothing to see', () => {
  beforeEach(() => mockedAnswer.mockReset());

  it("says no witness vouched, what each lacked, Jev's reading and the suggested refusal", () => {
    show([EBORACUM]);
    expect(screen.getByText('None of the four witnesses says a visitor goes here.')).toBeTruthy();
    expect(screen.getByText(/^Missing: no travel guide lists it; too few photographs/)).toBeTruthy();
    expect(screen.getByText(/Jev reads it as not one place: a culture, a kingdom or a group of sites · 90 %/)).toBeTruthy();
    expect(screen.getByText('Suggested: refuse it from Archaeology.')).toBeTruthy();
  });

  it('refuses it from the kind, sending the membership', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9771, membershipId: 9790, answer: 'refused', admission: 'refused' });
    const onDone = show([EBORACUM]);
    fireEvent.click(screen.getByRole('button', { name: 'Refuse from Archaeology' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(9771, {
      decision: 'refuse', membershipId: 9790, note: undefined,
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Eboracum: out of Archaeology, in the kept-out list', 9771));
  });

  it('keeps it', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9771, membershipId: 9790, answer: 'kept', admission: 'admitted' });
    const onDone = show([EBORACUM]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Eboracum: kept in Archaeology', 9771));
  });
});

describe('the witness lines', () => {
  it('name the one witness found and the three missing', () => {
    expect(witnessLines(['guide'])).toEqual({
      found: 'a travel guide lists it',
      missing: 'too few photographs were taken there; '
        + 'Wikidata gives no heritage listing, opening hours, visitor count or website; '
        + 'the map marks nothing standing there',
    });
  });
});
