/**
 * Tests for the contents card's rows: the unread works under a museum readers
 * already see.
 *
 * A curator deciding about twelve paintings that arrived since anyone looked
 * decides by looking at twelve paintings, and the row is where that starts: the
 * name opens the work's item, and beside it the article Wikidata resolves for it
 * (#806). What is worth pinning is that both are built from the work's own id —
 * and that a row an older server sends without one reads as it did before.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/experiences';
import { GatedCard } from './WaitingToPublish';

/** The Gemäldegalerie with unread paintings under it. */
function contents(...works: NonNullable<ReviewQueueItem['pending_works']>): ReviewQueueItem {
  return {
    id: 6194, external_id: 'Q165631', name: 'Gemäldegalerie Berlin',
    category_id: 2, category_name: 'Art Museums',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'contents', proposed: null,
    pending_locations: 0, pending_treasures: works.length,
    pending_points: [], pending_works: works,
  };
}

function renderCard(item: ReviewQueueItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GatedCard group={{ id: item.id, name: item.name, contents: item }} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

describe('the works a contents card lists', () => {
  it('opens each work at its item and at its article, each link named for its work', () => {
    // Two works, because the card lists up to 25 and the article links all read
    // "Wikipedia": a screen reader's link list has to say which work each opens.
    renderCard(contents(
      {
        id: 3102, name: 'The Wine Glass', artists: ['Johannes Vermeer'], artistsCurated: false,
        year: 1659, imageUrl: null, iconic: false, externalId: 'Q782639',
      },
      {
        id: 3103, name: 'Portrait of Hieronymus Holzschuher', artists: ['Albrecht Dürer'],
        artistsCurated: false, year: 1526, imageUrl: null, iconic: false, externalId: 'Q3399389',
      },
    ));

    const item = screen.getByRole('link', { name: 'The Wine Glass' });
    expect(item).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q782639');
    const article = screen.getByRole('link', { name: 'Wikipedia article for The Wine Glass' });
    expect(article).toHaveTextContent('Wikipedia');
    expect(article).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q782639');
    expect(screen.getByRole('link', { name: 'Wikipedia article for Portrait of Hieronymus Holzschuher' }))
      .toHaveAttribute('href', 'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q3399389');
    for (const link of [item, article]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    // The maker and the year stay on the row, after the name.
    expect(screen.getByText('— Johannes Vermeer, 1659')).toBeInTheDocument();
  });

  it('reads as before when an older server sends the row without its id', () => {
    renderCard(contents({
      id: 3102, name: 'The Wine Glass', artists: ['Johannes Vermeer'], artistsCurated: false,
      year: 1659, imageUrl: null, iconic: false,
    }));

    expect(screen.getByText('The Wine Glass')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'The Wine Glass' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Wikipedia/ })).toBeNull();
  });
});
