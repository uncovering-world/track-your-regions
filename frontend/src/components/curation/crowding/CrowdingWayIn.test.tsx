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
  LazyCrowdingWindow: ({ membershipId }: { membershipId: number }) => <div data-testid="window">{membershipId}</div>,
}));

import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { CrowdingWayIn } from './CrowdingWayIn';

type Card = Parameters<typeof CrowdingWayIn>[0]['item'];

/** Schloßplatz as Berlin's squares put it on 2026-11-02: an arrival thirteen better-known squares shadow. */
const schlossplatz: Card = {
  id: 1014, membership_id: 14, kind_id: 9, kind_name: 'Squares & streets', kind_type: 'square', curation_state: 'pending',
  crowding: { limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13, measured: true, betterKnown: 15, measuringRun: null, measurable: true },
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

  it('says the rule found nothing better known around a place it shows (#2420)', () => {
    renderWayIn({ ...schlossplatz, curation_state: 'verified', crowding: crowding({ shadowed: false, outrankedBy: null, betterKnown: 0 }) });
    expect(screen.getByText('No better-known square stands within 10 km of it.')).toBeInTheDocument();
  });

  it('says a place not measured yet is compared with nothing, and when it will be (#2420)', () => {
    // The Russian Church in Florence, arrived while the run that measures it was still going.
    const unmeasured = crowding({ shadowed: false, outrankedBy: null, measured: false, betterKnown: null });
    const { unmount } = renderWayIn({ ...schlossplatz, crowding: { ...unmeasured, measuringRun: 'Places of worship' } });
    expect(screen.getByText('Not measured yet: nothing is compared with it until the run of Places of worship in progress ends.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/No better-known/)).toBeNull();
    unmount();

    renderWayIn({ ...schlossplatz, crowding: unmeasured });
    expect(screen.getByText('Not measured yet: nothing is compared with it until the next sync run ends.')).toBeInTheDocument();
  });

  it('says a place no run can measure is never measured, and names no run (#2420)', () => {
    // A church a curator made by hand: its membership's key is no Wikidata item.
    renderWayIn({ ...schlossplatz, crowding: crowding({ shadowed: false, outrankedBy: null, measured: false, betterKnown: null, measurable: false }) });
    expect(screen.getByText('Never measured: it has no Wikidata item, so nothing is compared with it.')).toBeInTheDocument();
  });

  it('keeps a curator\'s shadow on the card of a place not measured yet (#2420)', () => {
    renderWayIn({ ...schlossplatz, curation_state: 'verified', crowding: crowding({ outrankedBy: 2, measured: false, betterKnown: 2 }) });
    expect(screen.getByText(
      'Kept in the shadow of Squares & streets by a curator; 2 better-known squares within 10 km count above it. '
      + 'Not measured yet: only the 2 a curator keeps on the list count above it until the next sync run ends.',
    )).toBeInTheDocument();
  });

  it('counts the places a curator keeps on the list above a place not measured yet and not shadowed (#2420)', () => {
    renderWayIn({ ...schlossplatz, crowding: crowding({ shadowed: false, outrankedBy: null, measured: false, betterKnown: 3 }) });
    expect(screen.getByText('Not measured yet: only the 3 a curator keeps on the list count above it until the next sync run ends.'))
      .toBeInTheDocument();
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
