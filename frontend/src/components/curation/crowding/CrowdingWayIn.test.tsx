/**
 * The way from a review card into the crowded-city window (#2282), read off
 * the card's own `crowding`: the button names the type and the count, a
 * shadowed place's card says in which kind and how many outrank it (#2228),
 * and a card the rule does not reach draws nothing. Nothing is asked of the
 * server until the window opens.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('./LazyCrowdingWindow', () => ({
  LazyCrowdingWindow: ({ memberships }: { memberships: number[] }) => <div data-testid="window">{memberships.join(',')}</div>,
}));

import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { CrowdingWayIn } from './CrowdingWayIn';

type Card = Parameters<typeof CrowdingWayIn>[0]['item'];

/** Schloßplatz as Berlin's squares put it on 2026-11-02: an arrival thirteen better-known squares shadow. */
const schlossplatz: Card = {
  id: 1014, membership_id: 14, kind_id: 9, kind_name: 'Squares & streets', kind_type: 'square', curation_state: 'pending',
  crowding: { limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13 },
};

function renderWayIn(item: Card) {
  return render(<CrowdingWayIn item={item} onDone={vi.fn()} />);
}

const crowding = (over: Partial<NonNullable<ReviewQueueItem['crowding']>>) => ({ ...schlossplatz.crowding!, ...over });

describe('the way into a crowded city', () => {
  it('offers the squares around an arriving square, with the count, and says the rule would shadow it once published', () => {
    renderWayIn(schlossplatz);

    expect(screen.getByRole('button', { name: 'Squares around (22)' })).toBeInTheDocument();
    expect(screen.getByText('Once published, shadowed in Squares & streets: 13 better-known squares within 10 km outrank it.'))
      .toBeInTheDocument();
  });

  it('says a published place is shadowed, and says nothing of one the display shows', () => {
    const leipziger = { ...schlossplatz, curation_state: 'verified', crowding: crowding({ outrankedBy: 11 }) };
    const { unmount } = renderWayIn(leipziger);
    expect(screen.getByText('Shadowed in Squares & streets: 11 better-known squares within 10 km outrank it.')).toBeInTheDocument();
    unmount();

    renderWayIn({ ...schlossplatz, crowding: crowding({ shadowed: false, outrankedBy: null }) });
    expect(screen.queryByText(/shadow/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Squares around (22)' })).toBeInTheDocument();
  });

  it('says a curator kept a place in the shadow, under the kind’s ten', () => {
    renderWayIn({ ...schlossplatz, curation_state: 'verified', crowding: crowding({ outrankedBy: 8 }) });
    expect(screen.getByText('Kept in the shadow of Squares & streets by a curator; 8 better-known squares within 10 km count above it.'))
      .toBeInTheDocument();
  });

  it('names a type by its plural: churches', () => {
    renderWayIn({
      ...schlossplatz, kind_id: 4, kind_name: 'Places of worship', kind_type: 'church',
      crowding: crowding({ around: 114, shadowed: false, outrankedBy: null }),
    });
    expect(screen.getByRole('button', { name: 'Churches around (114)' })).toBeInTheDocument();
  });

  it('opens the window on the card’s membership', () => {
    renderWayIn(schlossplatz);
    fireEvent.click(screen.getByRole('button', { name: 'Squares around (22)' }));
    expect(screen.getByTestId('window')).toHaveTextContent('14');
  });

  it('draws nothing for a card the rule does not reach, or about no membership', () => {
    const { container, unmount } = renderWayIn({ ...schlossplatz, crowding: null });
    expect(container).toBeEmptyDOMElement();
    unmount();
    expect(renderWayIn({ ...schlossplatz, membership_id: null }).container).toBeEmptyDOMElement();
  });
});
