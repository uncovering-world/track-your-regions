/**
 * Tests for the card that asks about a place an object lost.
 *
 * The two things worth pinning are what the card *says*, because that is the whole of
 * whether the answer is decidable: a part the source now offers somewhere else moved and
 * did not go, and a part somebody had visited is a different weight of decision from one
 * nobody had. Both are facts on the row, and both were invisible before this card existed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/experiences', () => ({
  setLocationState: vi.fn(),
}));

import { WithdrawnCard, pointTitle, withdrawalStory, placementNotice } from './WithdrawnPoints';
import { setLocationState } from '../../api/experiences';
import type { ReviewQueueItem } from '../../api/experiences';

const mockedState = setLocationState as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedState.mockReset();
  mockedState.mockResolvedValue({ locationId: 13211, offeredToReaders: false });
});

type Point = NonNullable<ReviewQueueItem['withdrawn_points']>[number];

/** Bilbao's own withdrawn point, which is the only one the catalogue has. */
function point(over: Partial<Point> = {}): Point {
  return {
    id: 13211,
    name: null,
    externalRef: 'Q127064',
    missingSince: '2026-08-10T20:03:01.941Z',
    latitude: 43.265974,
    longitude: -2.93785,
    visited: false,
    replacedMetres: null,
    ...over,
  };
}

/** The queue row that carries it: one venue, one place still offered. */
function item(over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 1592,
    external_id: 'Q127064',
    name: 'Bilbao Fine Arts Museum',
    category_id: 3,
    category_name: 'Public Art & Monuments',
    missing_since: null,
    source_membership: 'present',
    existence: 'extant',
    kind: 'withdrawn',
    proposed: null,
    offered_locations: 1,
    withdrawn_points: [point()],
    ...over,
  } as ReviewQueueItem;
}

/** The card under a query client, since every answer on it is a mutation. */
function renderCard(
  over: Partial<ReviewQueueItem> = {},
  onDone: (message?: string, experienceId?: number) => void = () => {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WithdrawnCard item={item(over)} onDone={onDone} />
    </QueryClientProvider>,
  );
}

describe('pointTitle', () => {
  it('falls back to the source reference, because most parts have no name', () => {
    // Bilbao's withdrawn point carries only `Q127064`, and 787 of the 788 single-point
    // UNESCO sites carry a component reference. A card headed by the name alone would be
    // headed by nothing at all.
    expect(pointTitle(point())).toContain('Q127064');
    expect(pointTitle(point({ name: 'Waldsiedlung Zehlendorf' }))).toBe('Waldsiedlung Zehlendorf');
  });

  it('says something rather than nothing when neither is there', () => {
    expect(pointTitle(point({ name: null, externalRef: null }))).toBe('An unnamed part');
  });
});

describe('withdrawalStory', () => {
  it('says a part the source offers far away moved rather than went', () => {
    // The difference between a rewritten coordinate and a departure, which is the whole
    // decision — and which a curator would otherwise settle by comparing references.
    expect(withdrawalStory(point({ replacedMetres: 1200 }), 1)).toMatch(/1 km away now/);
    expect(withdrawalStory(point({ replacedMetres: 1200 }), 1)).toMatch(/moved rather than/);
  });

  it('says a centimetre is the same place written more precisely, not a move', () => {
    // Bilbao, and 0.01 is what a client actually receives rather than what was measured:
    // the geography distance is 0.01244 m — 1.2 cm, the figure the queue's own comment
    // and `docs/tech/experiences.md` carry — and `replacedMetres` arrives through
    // `round(…, 2)`, so 0.012 would be a value this API cannot send. The cause was a
    // stored latitude rounded to six decimals where a later run wrote 43.265973888. A
    // card calling that a move would be wrong about the only thing it is for.
    const story = withdrawalStory(point({ replacedMetres: 0.01 }), 1);
    expect(story).toMatch(/1 cm from here/);
    expect(story).toMatch(/not a move/);
    expect(story).not.toMatch(/moved rather than/);
  });

  it('gives a move of tens of metres in metres, beside the kilometre case', () => {
    // The arm the map button exists for: 40 m is a move a curator has to answer, 400 km
    // is another, and both come through here. Asserted beside the 1200 and 0.01 cases
    // because those two satisfy the other arms — without this one, deleting the metres
    // line rounds 40 to "0 km" and the card says a part that moved 40 m went nowhere.
    const story = withdrawalStory(point({ replacedMetres: 40 }), 1);
    expect(story).toMatch(/40 m away now/);
    expect(story).toMatch(/moved rather than/);
    expect(story).not.toMatch(/0 km/);
  });

  it('reads metres inside the tolerance as a rewrite, not a move', () => {
    // The band this card actually receives. `026` collapses the pairs the old comparison
    // wrote, but leaves standing any whose old row carries a visit — anywhere up to ten
    // metres, not only Bilbao's centimetre. A source that nudged a pin three metres
    // before the fix produced exactly this, and splitting at one metre told the curator
    // "it moved rather than went" about a rewrite the writer itself now forgives.
    const story = withdrawalStory(point({ replacedMetres: 3 }), 1);
    expect(story).toMatch(/3 m from here/);
    expect(story).toMatch(/not a move/);
    expect(story).not.toMatch(/moved rather than/);
  });

  it('reads the tolerance boundary itself as a rewrite, because ST_DWithin includes it', () => {
    // Ten exactly, which the three-metre case above cannot pin: it survives `<=` turning
    // into `<`, and this does not. The number has to be inclusive on both sides of the
    // product — the writer and migration 026 both ask `ST_DWithin(…, 10)`, which is
    // inclusive — or a pair at exactly ten metres is absorbed by one and called a move
    // by the other.
    const story = withdrawalStory(point({ replacedMetres: 10 }), 1);
    expect(story).toMatch(/10 m from here/);
    expect(story).toMatch(/not a move/);
    expect(story).not.toMatch(/moved rather than/);
  });

  it('says the list is shorter when nothing replaced it', () => {
    expect(withdrawalStory(point({ replacedMetres: null }), 6)).toMatch(/one part shorter/);
  });

  it('says an object with nothing left is on no map at all', () => {
    // Not the same sentence as "one part shorter": an object whose last place went is
    // still listed and now unplaceable, which is worth saying out loud.
    expect(withdrawalStory(point({ replacedMetres: null }), 0)).toMatch(/no map at all/);
  });
});

describe('placementNotice', () => {
  it('says nothing when placement did not fail', () => {
    // The common answer. A notice on every verdict would train a curator to dismiss
    // the one that matters.
    expect(placementNotice({ name: 'Bilbao' }, { offeredToReaders: true } as never)).toBeUndefined();
  });

  it('names the world views, and says the regions are stale until an admin acts', () => {
    const notice = placementNotice({ name: 'Bilbao' }, {
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Base layer' }, { id: 1, name: 'GADM' }],
    });

    // With the ids, because the curator reads this out to an admin who searches by
    // number: `worldViewList`'s form, not a list derived here, which is how the id
    // gets dropped from the one sentence written to be handed on.
    expect(notice).toContain('Base layer (world view 4), GADM (world view 1)');
    expect(notice).toContain('recorded');
    expect(notice).toMatch(/out of date/);
  });

  it('says something when the world views themselves could not be listed', () => {
    // `placeAfterRelease` answers with one nameless entry when even listing them
    // failed, so there is no number to give — and a template that tried would print
    // "world view null" here.
    const notice = placementNotice({ name: 'Bilbao' }, {
      placementFailed: true,
      placementFailedWorldViews: [{ id: null, name: null }],
    });

    expect(notice).toContain('every world view — they could not even be listed');
    expect(notice).not.toMatch(/null/);
  });
});

describe('WithdrawnCard', () => {
  it('offers the three answers, with the one that changes what visitors see set apart', () => {
    renderCard();

    const dropped = screen.getByRole('button', { name: /the source dropped it/i });
    const gone = screen.getByRole('button', { name: /no longer exists/i });
    const falseAlarm = screen.getByRole('button', { name: /false alarm/i });

    // The distinction, not merely the presence: the two answers that leave the point
    // hidden are outlined alike, and the one that puts it back on the map is plain
    // text. Asserted because the title claims it — three identically styled buttons
    // would pass a check that only counts them, and this screen's own review found
    // that arranging a card as though one answer were the default is a defect no gate
    // can see.
    expect(dropped.className).toMatch(/MuiButton-outlined/);
    expect(gone.className).toMatch(/MuiButton-outlined/);
    expect(falseAlarm.className).toMatch(/MuiButton-text/);
    expect(falseAlarm.className).not.toMatch(/MuiButton-outlined/);
  });

  // What each answer sends, and what it must not send. At the point level the two axes
  // are not interchangeable — `former` leaves the flag standing and hides nothing new,
  // `lost` is the one answer that takes an offered point off every reader-facing read —
  // so a swapped body is a wrong verdict recorded against a real place. It is also the
  // hardest kind to notice, because an answered point appears on no screen (#544). The
  // negative assertions are the half that catches it: two `objectContaining` checks pass
  // for a body carrying both axes.
  it('sends the delisting as a membership verdict, touching neither axis it did not answer', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /the source dropped it/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(13211, expect.objectContaining({ membership: 'former' }));
    });
    expect(mockedState.mock.calls[0][1]).not.toHaveProperty('existence');
  });

  it('sends the demolition as an existence verdict, because the source may still list it', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /no longer exists/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(13211, expect.objectContaining({ existence: 'lost' }));
    });
    expect(mockedState.mock.calls[0][1]).not.toHaveProperty('membership');
  });

  it('sends the false alarm as restored presence, the one answer that clears the flag', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /false alarm/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(13211, expect.objectContaining({ membership: 'present' }));
    });
    expect(mockedState.mock.calls[0][1]).not.toHaveProperty('existence');
  });

  // The wiring, not the wording: `placementNotice` is pinned three ways above, and none of
  // that reaches the page unless the reply is read. This is the line that came apart once
  // — lost against `MissingCard`'s idiom, the one endpoint with nothing after its
  // `client.release()` — and `onDone` is the page's `refresh`, whose first argument *is*
  // the notice, so the two spellings differ by a rendered alert against silence. Paired
  // with the success case, since a notice-always spelling satisfies one of the two.
  it('hands the page the placement failure, so a point in no region is reported', async () => {
    const onDone = vi.fn();
    mockedState.mockResolvedValue({
      locationId: 13211,
      offeredToReaders: true,
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Base layer' }],
    });
    renderCard({}, onDone);

    fireEvent.click(screen.getByRole('button', { name: /false alarm/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0]).toContain('Base layer (world view 4)');
    expect(onDone.mock.calls[0][1]).toBe(1592);
  });

  it('says nothing to the page when the verdict and the placement both landed', async () => {
    const onDone = vi.fn();
    renderCard({}, onDone);

    fireEvent.click(screen.getByRole('button', { name: /the source dropped it/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0]).toBeUndefined();
  });

  it('carries the card the curator was looking at, so a moved question is refused', async () => {
    // The whole stale-card guard is this constant. Drifted, every answer 409s in
    // production while every mocked test here stays green — so the values are pinned
    // rather than the presence of the key.
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /the source dropped it/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(13211, expect.objectContaining({
        expected: { membership: 'present', existence: 'extant', flagged: true },
      }));
    });
  });

  it('says when somebody had been there', () => {
    renderCard({ withdrawn_points: [point({ visited: true })] });

    // The visit survives either answer (ADR-0022) and the card has to say so, or the
    // careful answer is the one that looks destructive.
    expect(screen.getByText(/record is kept whatever you answer/i)).toBeInTheDocument();
  });

  it('says nothing about visits when nobody had been there', () => {
    renderCard();

    expect(screen.queryByText(/record is kept/i)).not.toBeInTheDocument();
  });

  it('counts the parts waiting when more than one went in the same run', () => {
    renderCard({
      offered_locations: 5,
      withdrawn_points: [point(), point({ id: 13212, externalRef: '1239-006' })],
    });

    expect(screen.getByText(/2 of its parts are waiting/i)).toBeInTheDocument();
  });

  it('says the response and the card disagree rather than showing an empty decision', () => {
    // A row reaches this kind because a point was flagged, so an empty list is a bug —
    // and silence would read as "nothing to decide", which is the one answer this screen
    // must never give by accident.
    renderCard({ withdrawn_points: [] });

    expect(screen.getByText(/Reload the page/i)).toBeInTheDocument();
  });
});
