/**
 * The card for a serial site's candidate component items (#1272), on a
 * stretch of the Dacian frontier: the point named Bologa has the fort of
 * Bologa 20 m off under the same name and a tower 410 m off with a name half
 * alike; the point named Buciumi has its fort 35 m off.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ answerComponentItems: vi.fn() }));

import { answerComponentItems } from '../../api/curation';
import { ComponentItemsCard } from './ComponentItemsCard';

const mockedAnswer = answerComponentItems as unknown as ReturnType<typeof vi.fn>;

const BOLOGA = { locationId: 501, pointName: 'Bologa', pointRef: '1591-005', latitude: 46.8853, longitude: 22.8752, basis: 'near', proposedAt: '2026-10-09T10:00:00.000Z' };
const BUCIUMI = { locationId: 502, pointName: 'Buciumi', pointRef: '1591-006', latitude: 47.0383, longitude: 23.0581, basis: 'near', proposedAt: '2026-10-09T10:00:00.000Z' };

const DACIA = {
  id: 9850, external_id: '1591', name: 'Frontiers of the Roman Empire – Dacia', kind_id: 1, kind_name: 'World Heritage Sites',
  missing_since: null, source_membership: 'present', existence: 'extant', kind: 'component-items', proposed: null,
  component_items: [
    { ...BOLOGA, proposalId: 31, item: 'Q98501', label: 'Castrul Bologa', distanceM: 20, similarity: 1, exact: true, itemLatitude: 46.8855, itemLongitude: 22.8753 },
    { ...BOLOGA, proposalId: 32, item: 'Q98502', label: 'Turnul Bologa', distanceM: 410, similarity: 0.52, exact: false, itemLatitude: null, itemLongitude: null },
    { ...BUCIUMI, proposalId: 33, item: 'Q98503', label: 'Castrul Buciumi', distanceM: 35, similarity: 0.61, exact: false, itemLatitude: 47.0385, itemLongitude: 23.0583 },
    // The fort of Bologa proposed for Buciumi too, from an earlier pass.
    { ...BUCIUMI, proposalId: 34, item: 'Q98501', label: 'Castrul Bologa', distanceM: 900, similarity: 0.3, exact: false, itemLatitude: null, itemLongitude: null },
  ],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ComponentItemsCard item={DACIA} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe("a site's candidate component items", () => {
  beforeEach(() => { mockedAnswer.mockReset(); });

  it('lists the candidates under their points with why each was found, and saves nothing until something is answered', () => {
    renderCard();

    expect(screen.getByText('2 components of this site have no Wikidata item recording their reference. For each candidate found beside one, say whether it is the same place.')).toBeTruthy();
    expect(screen.getByText('near the point, of the site’s kind · 20 m away · the same name')).toBeTruthy();
    expect(screen.getByText('near the point, of the site’s kind · 410 m away · names 52 % alike')).toBeTruthy();
    expect(screen.getByText('same name, same spot')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Castrul Bologa' })[0]).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q98501');
    // A map beside the point only where the item states a coordinate.
    expect(screen.getAllByRole('button', { name: 'see both on the map' })).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Save answers' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms every exact match at once and says what landed', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9850, accepted: 1, refused: 0, pictured: 1 });
    const onDone = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm the exact match' }));
    const [fortForBologa, fortForBuciumi] = screen.getAllByRole('button', { name: 'Same place: Castrul Bologa' });
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('true');
    expect(fortForBuciumi.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(9850, [{ proposalId: 31, answer: 'accepted' }]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Frontiers of the Roman Empire – Dacia: 1 item confirmed (1 with a picture)', 9850,
    ));
  });

  it('keeps one confirmation per point and one per item, and sends a turn-down beside it', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9850, accepted: 1, refused: 1, pictured: 0 });
    const onDone = renderCard();

    const [fortForBologa, fortForBuciumi] = screen.getAllByRole('button', { name: 'Same place: Castrul Bologa' });
    fireEvent.click(fortForBologa);
    // The same fort confirmed for Buciumi takes the confirmation off Bologa's: an item is one component.
    fireEvent.click(fortForBuciumi);
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('false');
    expect(fortForBuciumi.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(fortForBologa);
    // The tower confirmed takes the confirmation off the fort: a component is one item.
    fireEvent.click(screen.getByRole('button', { name: 'Same place: Turnul Bologa' }));
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Not it: Castrul Buciumi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 answers' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(9850, [
      { proposalId: 32, answer: 'accepted' }, { proposalId: 33, answer: 'refused' },
    ]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Frontiers of the Roman Empire – Dacia: 1 item confirmed, 1 candidate turned down', 9850,
    ));
  });
});
