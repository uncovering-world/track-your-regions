/**
 * The way from a review card into the crowded-city window (#2282), read off
 * the card's own `crowding`: the button names the type and the count, and a
 * card the rule does not reach draws nothing. Nothing is asked of the server
 * until the window opens.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('./LazyCrowdingWindow', () => ({
  LazyCrowdingWindow: ({ memberships }: { memberships: number[] }) => <div data-testid="window">{memberships.join(',')}</div>,
}));

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

const crowding = (over: Partial<NonNullable<Card['crowding']>>) => ({ ...schlossplatz.crowding!, ...over });

describe('the way into a crowded city', () => {
  it('offers the squares around an arriving square, with the count', () => {
    renderWayIn(schlossplatz);

    expect(screen.getByRole('button', { name: 'Squares around (22)' })).toBeInTheDocument();
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
