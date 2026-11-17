/**
 * An arrival turned away says why (#863). The Dormition Cathedral in Kharkiv
 * arrived as a tower: "Not a tower" is itself the reason, and "Turn away"
 * opens the other reasons a refusal offers, one click on a line turning the
 * place away with that reason.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/articleLeads', () => ({ fetchArticleLead: vi.fn().mockResolvedValue(null) }));
vi.mock('../../api/kindNeighbours', () => ({ fetchKindNeighbours: vi.fn().mockResolvedValue({ kept: null, refused: null }) }));
vi.mock('../../api/kindRule', () => ({
  fetchKindRule: vi.fn().mockResolvedValue({ keptOut: null, world: null, surroundings: null }),
}));
vi.mock('../../api/curation', async (original) => ({
  ...await original<typeof import('../../api/curation')>(),
  refuseArrival: vi.fn(),
  // Jev's readings under the card, which this spec does not read.
  suggestVisit: vi.fn(() => new Promise(() => {})),
  suggestKind: vi.fn(() => new Promise(() => {})),
}));

import { refuseArrival } from '../../api/curation';
import { GatedCard } from './WaitingToPublish';
import type { GatedGroup } from './gatedGroup';

const mockedRefuse = vi.mocked(refuseArrival);

const DORMITION = { id: 47120, external_id: 'Q4129512', name: 'Dormition Cathedral, Kharkiv' };

function arrival(): ReviewQueueItem {
  return {
    ...DORMITION, kind_id: 7, kind_name: 'Towers', kind_type: 'bell-tower', membership_id: 88,
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'arrival', proposed: null, wikipedia_url: null,
    pending_locations: 0, pending_treasures: 0, pending_points: [], pending_works: [],
  };
}

function renderCard() {
  const item = arrival();
  const sections: GatedGroup[] = [{ ...DORMITION, membershipId: item.membership_id ?? null, arrival: item }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GatedCard sections={sections} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedRefuse.mockReset().mockResolvedValue({ experienceId: DORMITION.id, admission: 'refused', reason: 'kept out by a curator' });
});

describe('an arrival turned away (#863)', () => {
  it('"Not a tower" turns it away as not of the kind', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Not a tower' }));
    await waitFor(() => expect(mockedRefuse)
      .toHaveBeenCalledWith(DORMITION.id, { membershipId: 88, reasonCode: 'not-this-kind' }));
  });

  it('"Turn away" offers every other reason a refusal has, in order, with Other last', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    const lines = within(screen.getByRole('menu')).getAllByRole('menuitem').map(line => line.textContent);
    expect(lines).toEqual(['Nothing to see', 'Not one place', 'Gone or not built', 'Same as another', 'Wrong place', 'Other…']);
  });

  it('one click on a line turns it away with that reason', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Not one place' }));
    await waitFor(() => expect(mockedRefuse)
      .toHaveBeenCalledWith(DORMITION.id, { membershipId: 88, reasonCode: 'not-one-place' }));
  });

  it('Other sends the words typed with it', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('A few words'), { target: { value: 'a crossing into occupied Crimea' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn away' }));
    await waitFor(() => expect(mockedRefuse).toHaveBeenCalledWith(DORMITION.id, {
      membershipId: 88, reasonCode: 'other', note: 'a crossing into occupied Crimea',
    }));
  });
});
