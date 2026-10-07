/**
 * The admin's pass over places that are one place (#1247) reports what it did
 * by name: the National Museum of Archaeology in Madrid (Q1352282, three rows
 * on the development catalogue) merged, and a pair it left apart with the reason.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/admin/placeMerges', () => ({ mergePlacesSharingAnItem: vi.fn() }));

import { mergePlacesSharingAnItem } from '../../api/admin/placeMerges';
import { EqualItemMergeCard } from './EqualItemMergeCard';

const mockedMerge = mergePlacesSharingAnItem as unknown as ReturnType<typeof vi.fn>;

describe('the merge of places that share a Wikidata item', () => {
  it('reports the places merged and the pairs left apart, by name', async () => {
    mockedMerge.mockResolvedValue({
      merged: [{ qid: 'Q1352282', survivorId: 1482, foldedId: 6234, mergeId: 1, name: 'National Museum of Archaeology' }],
      refused: [{
        qid: 'Q99309', placeIds: [9700, 9701], name: 'Pantheon',
        error: 'Both places belong to the same kind, which one place cannot hold twice',
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EqualItemMergeCard />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Merge places that share a Wikidata item/ }));

    expect(await screen.findByText('1 place merged into another; 1 pair left apart.')).toBeTruthy();
    expect(screen.getByText(/places 9700 and 9701/).textContent).toMatch(/^Pantheon \(Q99309, places 9700 and 9701\): Both places/);
    fireEvent.click(screen.getByRole('button', { name: /Show the merged places/ }));
    expect(screen.getByText(/National Museum of Archaeology/).textContent).toContain('place 6234 into 1482');
  });
});
