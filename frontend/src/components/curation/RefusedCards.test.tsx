/**
 * Tests for a refusal of a place in two kinds (#1264).
 *
 * The Capitoline Museums with no kind offering them: the Archaeology rule and
 * the Places of worship rule have refused them, and Art Museums has too, so the
 * refusals decide whether the place stays at all (#1838). One place, so one
 * header; two refusals, each answered under its own kind's membership. Kept out
 * of one kind while still an art museum on every map, the kept-out card says
 * where readers still see the place.
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
import { KeptOutCard, RefusedCard } from './RefusedCards';

const mockedAdmission = vi.mocked(setExperienceAdmission);

beforeEach(() => {
  mockedAdmission.mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof setExperienceAdmission>>);
});

function refusal(over: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    id: 6214, external_id: 'Q207694', name: 'Capitoline Museums', kind_id: 5, kind_name: 'Archaeology',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'refused', proposed: null,
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
  it('is drawn once, with a section per kind and no "readers still see it" line', () => {
    // An open refusal is asked only where no other kind offers the place
    // (#1838), so there is nowhere else readers see it; the kept-out list
    // carries that line.
    renderCard(ITEMS);

    expect(screen.getAllByText('Capitoline Museums')).toHaveLength(1);
    expect(sectionOf('Archaeology’s rule turned it down')).toBeInTheDocument();
    expect(sectionOf('Places of worship’s rule turned it down')).toBeInTheDocument();
    expect(screen.queryByText(/Readers still see this place/)).toBeNull();
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

describe('a refusal a curator kept out', () => {
  it('says where readers still see the place', () => {
    // Kept out of Archaeology, still an art museum on every map.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <KeptOutCard item={refusal({ membership_id: 21, admission_reason: 'not an archaeological site', seen_in: ['Art Museums'] })} onDone={() => {}} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Readers still see this place under Art Museums; this keeps it out of Archaeology alone.'))
      .toBeInTheDocument();
  });

  it("says what the system recorded about the answer apart from the curator's words (#2195)", () => {
    // A script released the unread batch answer's pin and recorded how (ADR-0096):
    // the system's sentence, never put in the curator's quotes.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <KeptOutCard
          item={refusal({
            membership_id: 21, admission_reason: 'not an archaeological site', state_decided_at: '2026-10-12T10:00:00Z',
            state_note: null, state_system_note: 'released when the batch answer of 14 September 2026 was read',
          })}
          onDone={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Kept out on .* — recorded by the system: released when the batch answer of 14 September 2026 was read/))
      .toBeInTheDocument();
    expect(screen.queryByText(/“/)).not.toBeInTheDocument();
  });
});
