/**
 * Tests for a waiting card about a place two kinds ask about (#1264).
 *
 * The Capitoline Museums as Epic #755 leaves them: an Archaeology run has just
 * brought them, and a work has arrived under the Art Museums membership readers
 * already see. One place, so one header; two questions, each answered under its
 * own kind's membership and no other's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', async (original) => ({
  ...await original<typeof import('../../api/curation')>(),
  publishExperience: vi.fn(),
}));

import { publishExperience } from '../../api/curation';
import { GatedCard } from './WaitingToPublish';
import type { GatedGroup } from './gatedGroup';

const mockedPublish = vi.mocked(publishExperience);

beforeEach(() => {
  mockedPublish.mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof publishExperience>>);
});

const PLACE = { id: 6214, external_id: 'Q207694', name: 'Capitoline Museums' };

function item(over: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    ...PLACE, kind_id: 5, kind_name: 'Archaeology',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'arrival', proposed: null,
    pending_locations: 0, pending_treasures: 0, pending_points: [], pending_works: [],
    ...over,
  };
}

const SECTIONS: GatedGroup[] = [
  { ...PLACE, membershipId: 21, arrival: item({ membership_id: 21, sync_log_id: 140, seen_in: ['Art Museums'] }) },
  {
    ...PLACE,
    membershipId: 20,
    contents: item({
      kind: 'contents', kind_id: 2, kind_name: 'Art Museums', membership_id: 20, pending_treasures: 1,
      pending_works: [{
        id: 3120, name: 'Boy with Thorn', artists: [], artistsCurated: false,
        year: null, imageUrl: null, iconic: false, externalId: 'Q1138826',
      }],
    }),
  },
];

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GatedCard sections={SECTIONS} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

/** The section a heading opens. */
function sectionOf(heading: string): HTMLElement {
  return screen.getByText(heading).parentElement!;
}

describe('a place two kinds ask about', () => {
  it('is drawn once, with a section per kind and one way to look at it', () => {
    renderCard();

    expect(screen.getAllByText('Capitoline Museums')).toHaveLength(1);
    expect(screen.getByText('Archaeology asks')).toBeInTheDocument();
    expect(screen.getByText('Art Museums asks')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Look at the object' })).toHaveLength(1);
  });

  it('says readers see the place under its other kind, not that nobody can see it', () => {
    renderCard();

    const archaeology = within(sectionOf('Archaeology asks'));
    expect(archaeology.getByText(/Readers already see this place under Art Museums\. Nobody has passed it under Archaeology yet/))
      .toBeInTheDocument();
    expect(archaeology.getByText('Until you publish it, readers see it only under Art Museums.')).toBeInTheDocument();
    expect(screen.queryByText(/readers see nothing at its address/)).toBeNull();
  });

  it('answers each section under its own kind\'s membership', async () => {
    renderCard();

    fireEvent.click(within(sectionOf('Archaeology asks')).getByRole('button', { name: 'Publish — list it under Archaeology' }));
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(6214, { membershipId: 21 }));

    fireEvent.click(within(sectionOf('Art Museums asks')).getByRole('button', { name: 'Publish everything Art Museums asks' }));
    await waitFor(() => expect(mockedPublish).toHaveBeenLastCalledWith(6214, { contentsOnly: true, membershipId: 20 }));
  });
});
