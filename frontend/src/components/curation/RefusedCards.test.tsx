/**
 * Tests for a refusal of a place in two kinds (#1264).
 *
 * The Capitoline Museums as Epic #755 leaves them: an art museum on every map,
 * which the Archaeology rule and the Places of worship rule have both refused.
 * One place, so one header; two refusals, each answered under its own kind's
 * membership, and each saying where readers still see the place.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', async (original) => ({
  ...await original<typeof import('../../api/curation')>(),
  setExperienceAdmission: vi.fn(),
}));

import { setExperienceAdmission } from '../../api/curation';
import { RefusedCard } from './RefusedCards';

const mockedAdmission = vi.mocked(setExperienceAdmission);

beforeEach(() => {
  mockedAdmission.mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof setExperienceAdmission>>);
});

function refusal(over: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    id: 6214, external_id: 'Q207694', name: 'Capitoline Museums', kind_id: 5, kind_name: 'Archaeology',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'refused', proposed: null, seen_in: ['Art Museums'],
    ...over,
  };
}

const ITEMS = [
  refusal({ membership_id: 21, admission_reason: 'not an archaeological site' }),
  refusal({ membership_id: 22, kind_id: 4, kind_name: 'Places of worship', admission_reason: 'not a place of worship' }),
];

function renderCard(items: ReviewQueueItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RefusedCard items={items} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

function sectionOf(heading: string): HTMLElement {
  return screen.getByText(heading).parentElement!;
}

describe('a place two kinds\' rules refused', () => {
  it('is drawn once, with a section per kind saying where readers still see it', () => {
    renderCard(ITEMS);

    expect(screen.getAllByText('Capitoline Museums')).toHaveLength(1);
    const archaeology = within(sectionOf('Archaeology’s rule turned it down'));
    expect(archaeology.getByText('Readers still see this place under Art Museums; this keeps it out of Archaeology alone.'))
      .toBeInTheDocument();
    expect(within(sectionOf('Places of worship’s rule turned it down'))
      .getByText(/this keeps it out of Places of worship alone/)).toBeInTheDocument();
  });

  it('answers each refusal under its own kind\'s membership', async () => {
    renderCard(ITEMS);

    fireEvent.click(within(sectionOf('Places of worship’s rule turned it down'))
      .getByRole('button', { name: 'The rule was right — keep it out' }));

    await waitFor(() => expect(mockedAdmission).toHaveBeenCalledWith(6214, { decision: 'confirm', membershipId: 22 }));
  });

  it('draws a refusal of the whole place as before, with no heading and no other kind', () => {
    renderCard([refusal({ membership_id: 21, admission_reason: 'not an archaeological site', seen_in: [] })]);

    expect(screen.queryByText(/rule turned it down/)).toBeNull();
    expect(screen.queryByText(/Readers still see this place/)).toBeNull();
  });
});
