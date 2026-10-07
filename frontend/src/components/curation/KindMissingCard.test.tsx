/**
 * Tests for a place one kind's source stopped listing while another still
 * lists it (#1264): the Capitoline Museums, dropped by the Archaeology run and
 * by a World Heritage run, still listed as an art museum.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', async (original) => ({
  ...await original<typeof import('../../api/curation')>(),
  setExperienceState: vi.fn(),
}));

import { setExperienceState } from '../../api/curation';
import { KindMissingCard } from './KindMissingCard';
import { asksOfKinds } from './kindQuestions';

const mockedState = vi.mocked(setExperienceState);

beforeEach(() => {
  mockedState.mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof setExperienceState>>);
});

function kind(over: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    id: 6214, external_id: 'Q207694', name: 'Capitoline Museums', kind_id: 5, kind_name: 'Archaeology',
    missing_since: '2026-10-01T10:00:00Z', source_membership: 'present', existence: 'extant',
    kind: 'missing', proposed: null, membership_id: 21, seen_in: ['Art Museums'], kept_as_former: false,
    ...over,
  };
}

const ITEMS = [
  kind({}),
  kind({ membership_id: 23, kind_id: 1, kind_name: 'World Heritage Sites', kept_as_former: true }),
];

function renderCard(items: ReviewQueueItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KindMissingCard items={items} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

function sectionOf(kindName: string): HTMLElement {
  return screen.getByText(`${kindName}’s source no longer lists this place`).parentElement!;
}

describe('a kind whose source stopped listing a place', () => {
  it('asks whether the place is still of that kind, saying where readers still see it', () => {
    renderCard(ITEMS);

    const archaeology = within(sectionOf('Archaeology'));
    expect(archaeology.getByText(/Readers still see it under Art Museums\./))
      .toBeInTheDocument();
    expect(archaeology.getByRole('button', { name: 'No longer Archaeology — take it out of that list' }))
      .toBeInTheDocument();
    // A delisted World Heritage Site stays, marked former.
    expect(within(sectionOf('World Heritage Sites'))
      .getByRole('button', { name: 'Delisted — keep it under World Heritage Sites, marked former' })).toBeInTheDocument();
    // Whether the place still stands is the place's card, not a kind's.
    expect(screen.queryByRole('button', { name: /no longer exists/i })).toBeNull();
  });

  it('answers under its own membership, with the kind as the card showed it', async () => {
    renderCard(ITEMS);

    fireEvent.click(within(sectionOf('Archaeology')).getByRole('button', { name: /^No longer Archaeology/ }));

    await waitFor(() => expect(mockedState).toHaveBeenCalledWith(6214, {
      membership: 'former',
      note: undefined,
      membershipId: 21,
      expected: { membership: 'present', existence: 'extant', flagged: true },
    }));
  });

  it('tells a kind\'s row from the place\'s own', () => {
    expect(asksOfKinds(ITEMS)).toBe(true);
    expect(asksOfKinds([kind({ membership_id: undefined })])).toBe(false);
  });
});
