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

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/experiences';

// The dialog is the shared surface a place is looked at and corrected in, with its
// own test; what this file pins is the wiring — which row opens, as which place, and
// where the outcome line goes.
vi.mock('../shared/PointPreviewDialog', () => ({
  PointPreviewDialog: ({ name, correction }: {
    name: string;
    correction?: {
      place: { locationId: number; objectName: string; name: string | null; unseen?: string };
      onDone: (m: string) => void;
    };
  }) => (
    <div role="dialog">
      <span>{`opened ${name}`}</span>
      {correction && <span>{`unseen=${String(correction.place.unseen)}`}</span>}
      {correction && (
        <button onClick={() => correction.onDone(`fixed ${correction.place.locationId} of ${correction.place.objectName}`)}>
          fix
        </button>
      )}
    </div>
  ),
}));

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

function renderCard(item: ReviewQueueItem, onDone: (message?: string) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GatedCard group={{ id: item.id, name: item.name, contents: item }} onDone={onDone} />
    </QueryClientProvider>,
  );
}

/** Champagne Hillsides with unread components under it — nine on the live database. */
function points(...rows: NonNullable<ReviewQueueItem['pending_points']>): ReviewQueueItem {
  return {
    id: 1345, external_id: '1465', name: 'Champagne Hillsides, Houses and Cellars',
    category_id: 1, category_name: 'UNESCO World Heritage Sites',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'contents', proposed: null,
    pending_locations: rows.length, pending_treasures: 0,
    pending_points: rows, pending_works: [],
  };
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

describe('the points a contents card lists', () => {
  it('opens a point where it can be looked at and corrected, and reports the outcome', () => {
    const onDone = vi.fn();
    renderCard(points(
      { id: 6001, name: 'Coteaux de la Marne', externalRef: '1465-003', latitude: 49.0442, longitude: 3.955 },
    ), onDone);

    // The name is a button, because it is the only way to the place — a curator
    // reading "49.0442, 3.9550" cannot tell a pin on the wrong hill from the numbers.
    fireEvent.click(screen.getByRole('button', { name: 'Coteaux de la Marne' }));
    expect(screen.getByText('opened Coteaux de la Marne')).toBeInTheDocument();
    // An unread point is one readers do not see yet, and publishing — not the
    // withdrawn card's "false alarm" — is what would show it.
    expect(screen.getByText('unseen=unread')).toBeInTheDocument();

    // The correction is offered as *this* place of *this* object, and its outcome
    // line goes where the card reports its other answers.
    fireEvent.click(screen.getByRole('button', { name: 'fix' }));
    expect(onDone).toHaveBeenCalledWith('fixed 6001 of Champagne Hillsides, Houses and Cellars');
  });

  it('says on the row when a curator has already corrected the point', () => {
    renderCard(points(
      {
        id: 6001, name: 'Coteaux de la Marne', externalRef: '1465-003',
        latitude: 49.0442, longitude: 3.955, curatedFields: ['location'],
      },
    ));

    // Without the word, a pin a curator moved reads as the source's — on the very
    // screen where the next curator decides about it.
    expect(screen.getByText('— 49.0442, 3.9550 · pin corrected')).toBeInTheDocument();
  });

  it('lists a point without a coordinate as text, since there is nothing to open', () => {
    renderCard(points(
      { id: 6002, name: 'Unplaced component', externalRef: '1465-009', latitude: null, longitude: null },
    ));

    expect(screen.getByText('Unplaced component')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unplaced component' })).toBeNull();
  });
});
