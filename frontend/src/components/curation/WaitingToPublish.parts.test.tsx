/**
 * Tests for a held card about one of the object's parts (ADR-0037).
 *
 * A run holds a work's attribution under a gated museum, and the queue hands
 * the card the held field under the work's name. What is worth pinning is what
 * the curator reads: the part heads its own group, the change is one row of
 * that group, the summary counts it, and "open" shows the work — its picture
 * and its maker — without leaving the queue.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/experiences';
import { GatedCard } from './WaitingToPublish';

/** Gemäldegalerie's held card, carrying The Wine Glass's re-attribution. */
function held(): ReviewQueueItem {
  return {
    id: 6194, external_id: 'Q165631', name: 'Gemäldegalerie Berlin',
    category_id: 2, category_name: 'Top Art Museums',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'held', sync_log_id: 64, proposed: null,
    counted_works_total: 27,
    proposed_parts: [{
      kind: 'treasures',
      item: { name: 'The Wine Glass', ref: 'Q782639' },
      fields: [{
        field: 'artist', old: 'Johannes Vermeer', new: 'Jan Vermeer van Haarlem the Elder', held: true,
      }],
      treasureId: 3102, artist: 'Jan Vermeer van Haarlem the Elder', year: 1659,
      imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Wine.jpg',
      imageCredit: null, treasureType: 'painting',
    }],
  };
}

function renderCard(item: ReviewQueueItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GatedCard group={{ id: item.id, name: item.name, held: item }} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

describe('a held card about a part', () => {
  it('shows the change under the part\'s name, and counts it', () => {
    renderCard(held());

    expect(screen.getByText('a work in this object')).toBeInTheDocument();
    expect(screen.getByText('The Wine Glass')).toBeInTheDocument();
    expect(screen.getByText('by Jan Vermeer van Haarlem the Elder, 1659')).toBeInTheDocument();
    // Both values in their own columns, and the summary above them.
    expect(screen.getByText('Johannes Vermeer')).toBeInTheDocument();
    expect(screen.getByText('1 changed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish the change' })).toBeInTheDocument();
  });

  it('opens the work where it can be looked at', () => {
    renderCard(held());

    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    // The work as the works preview draws it: named, with its maker, linked to
    // where it came from.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('The Wine Glass');
    expect(dialog).toHaveTextContent('painting');
    expect(screen.getByRole('link', { name: 'The Wine Glass' }))
      .toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q782639');
  });
});
