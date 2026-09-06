/**
 * Tests for a held card about one of the object's parts (ADR-0037).
 *
 * A run holds a work's attribution under a gated museum, and the queue hands
 * the card the held field under the work's name. What is worth pinning is what
 * the curator reads: the part heads its own group, the change is one row of
 * that group, the summary counts it, and "open" shows the work — its picture
 * and its maker — without leaving the queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/experiences';
import { declineHeld, publishExperience } from '../../api/experiences';
import { GatedCard } from './WaitingToPublish';

vi.mock('../../api/experiences', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/experiences')>(),
  declineHeld: vi.fn(),
  publishExperience: vi.fn(),
}));

// The form has its own test; what this file pins is that a held place opens on it —
// and as which place of which object.
vi.mock('../shared/PointCorrection', () => ({
  PointCorrection: ({ place }: { place: { locationId: number; objectName: string } }) => (
    <div data-testid="correction">{`correcting ${place.locationId} of ${place.objectName}`}</div>
  ),
}));

const mockedDeclineHeld = declineHeld as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishExperience as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedDeclineHeld.mockReset().mockResolvedValue({
    experienceId: 6194, declinedFields: [],
    declinedParts: [{ kind: 'treasures', name: 'The Wine Glass', fields: ['artists'] }],
    fromSyncLogId: 64, heldLeftOpen: 0,
  });
  mockedPublish.mockReset().mockResolvedValue({
    experienceId: 6194, curationState: 'verified', appliedFields: [], claimedFieldsSkipped: [],
    appliedParts: [], fromSyncLogId: 64, heldLeftOpen: 0, locationsPublished: 0,
    treasureLinksPublished: 0, treasuresPublished: 0, withdrawalsReleased: 0,
  });
});

/** Gemäldegalerie's held card, carrying The Wine Glass's re-attribution. */
function held(): ReviewQueueItem {
  return {
    id: 6194, external_id: 'Q165631', name: 'Gemäldegalerie Berlin',
    category_id: 2, category_name: 'Art Museums',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'held', sync_log_id: 64, proposed: null,
    counted_works_total: 27,
    proposed_parts: [{
      kind: 'treasures',
      item: { name: 'The Wine Glass', ref: 'Q782639' },
      fields: [{
        field: 'artists', old: ['Johannes Vermeer'], new: ['Jan Vermeer van Haarlem the Elder'], held: true,
      }],
      treasureId: 3102, artists: ['Jan Vermeer van Haarlem the Elder'], year: 1659,
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

  it('heads and seeds a part with the name the row holds now, not the name the run saw', () => {
    // The record names the part as it was when the run wrote it and is never
    // rewritten. A work retitled since — from this very dialog — would otherwise
    // be headed with the old name and the reopened dialog seeded with it again,
    // beside a chip saying the title was corrected (#731).
    const retitled = held();
    retitled.proposed_parts![0].storedName = 'The Glass of Wine';
    retitled.proposed_parts![0].workCuratedFields = ['name'];
    renderCard(retitled);

    expect(screen.getByText('The Glass of Wine')).toBeInTheDocument();
    expect(screen.getByText('title corrected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByLabelText('Title')).toHaveValue('The Glass of Wine');
  });

  it('says on the row that a picture and its credit are one answer', async () => {
    const withPicture = held();
    withPicture.proposed_parts![0].fields.push(
      { field: 'image_url', old: 'http://old', new: 'http://new', held: true },
      { field: 'metadata.imageCredit', old: null, new: { author: 'Someone' }, held: true },
    );
    renderCard(withPicture);

    // The server answers the two together, but they are two changeset fields and
    // the table draws a cell per field — so the card would otherwise show four
    // buttons under a caption promising each answers only its own row.
    expect(screen.getByText('Answered with its credit.')).toBeInTheDocument();
    expect(screen.getByText('Answered with its picture.')).toBeInTheDocument();
    // Not on the attribution, which really is answered on its own.
    expect(screen.getAllByText(/Answered with its/)).toHaveLength(2);
  });

  it('says on the object\u2019s own rows that a picture and its credit are one answer', () => {
    // The pairing reaches the object since ADR-0039, and a refusal has no undo:
    // four buttons that each answer both rows, with nothing saying so, is the
    // screen misleading a curator about the one act it cannot take back. The
    // object spells the picture `imageUrl`, not the column name a part uses,
    // which is why the note mirrors `partnerOf` rather than keying on one name.
    const withObjectPicture = held();
    withObjectPicture.proposed = [
      { field: 'imageUrl', old: 'https://old', new: 'https://new', held: true },
      {
        field: 'metadata.imageCredit', old: null,
        new: { author: 'JUNG Mi-gyeong' }, held: true,
      },
    ];
    renderCard(withObjectPicture);

    expect(screen.getByText('Answered with its credit.')).toBeInTheDocument();
    expect(screen.getByText('Answered with its picture.')).toBeInTheDocument();
  });

  it('does not promise a credit answer where the run held no credit', () => {
    // The ordinary shape on a work, not a corner: `creditToWrite` returns nothing
    // for a changed picture whose new file the Commons batch did not come back
    // for, and the writer drops an entry whose two sides are equal — so a run can
    // hold `image_url` alone. The server widens the answer only onto a row that
    // is open, so with no credit row there is nothing to widen onto, and a note
    // saying otherwise would overstate what the button does.
    const pictureOnly = held();
    pictureOnly.proposed_parts![0].fields.push(
      { field: 'image_url', old: 'https://old', new: 'https://new', held: true },
    );
    renderCard(pictureOnly);

    expect(screen.getByText('a work in this object')).toBeInTheDocument();
    expect(screen.queryByText(/Answered with its/)).not.toBeInTheDocument();
  });

  it('answers the work\'s row by naming the part the way the record names it', async () => {
    renderCard(held());

    fireEvent.click(screen.getByRole('button', { name: /not this/i }));

    // The record names a part and never identifies it (ADR-0026 decision 4), so
    // the answer echoes back the pair the server matches on: neither the
    // reference nor the name is an identity alone — a reference is shared by the
    // components of a serial site listed once per country, and two works in one
    // museum can carry one name.
    await waitFor(() => expect(mockedDeclineHeld).toHaveBeenCalledWith(6194, {
      fields: undefined,
      parts: [{ kind: 'treasures', ref: 'Q782639', name: 'The Wine Glass', fields: ['artists'] }],
    }, 64));
  });

  it('publishes the work\'s row alone, without touching the object\'s own fields', async () => {
    renderCard(held());

    fireEvent.click(screen.getByRole('button', { name: /publish this/i }));

    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(6194, {
      heldFields: undefined,
      heldParts: [{ kind: 'treasures', ref: 'Q782639', name: 'The Wine Glass', fields: ['artists'] }],
      expectedSyncLogId: 64,
    }));
  });

  it('locks the object-level buttons too while a refusal is in flight', async () => {
    // Both endpoints take OBJECT_LOCK, and an object publish naming no selection
    // writes every row still open. So a "Publish the change" that wins the lock
    // mid-refusal publishes the very value being refused and clears the pointer;
    // the refusal then finds no proposal, answers 409, and the value is on the
    // site with no card left to answer it. The per-row buttons were guarded from
    // the start — these two publish the most and were not.
    mockedDeclineHeld.mockReset().mockReturnValue(new Promise(() => {}));
    renderCard(held());

    const publishAll = screen.getByRole('button', { name: 'Publish the change' });
    expect(publishAll).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /not this/i }));

    await waitFor(() => expect(publishAll).toBeDisabled());
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});

/** A held card about a place: the source moved one component of a serial site. */
function heldPlace(locationId: number | null, curatedFields: string[] = []): ReviewQueueItem {
  return {
    ...held(),
    id: 1084, external_id: '1234', name: 'Cathar Castles', category_id: 1,
    category_name: 'UNESCO World Heritage Sites',
    proposed_parts: [{
      kind: 'locations',
      item: { name: 'Château de Montségur', ref: '1234-001' },
      fields: [{
        field: 'location', old: { lon: 1.8322, lat: 42.8756 }, new: { lon: 1.841, lat: 42.88 }, held: true,
      }],
      locationId, latitude: 42.8756, longitude: 1.8322, ordinal: 1, curatedFields,
    }],
  };
}

describe('a held card about a place', () => {
  it('opens the place on the map and offers to correct it', () => {
    // The third answer to a held coordinate: "take the source's" and "keep what is
    // here" are the two the card has, and a curator who can see both are wrong has
    // had nowhere to say so.
    renderCard(heldPlace(777));

    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    // Opens on the form, as *this* place of *this* object — one mode, no button to
    // press before the pin is in hand.
    expect(screen.getByRole('dialog')).toHaveTextContent('Château de Montségur');
    expect(screen.getByTestId('correction')).toHaveTextContent('correcting 777 of Cathar Castles');
  });

  it('says on the part\'s heading when a curator already holds its pin', () => {
    // The run is proposing a coordinate over a pin a curator put there, which is a
    // different decision from one over the source's own — said where the part is
    // named, before the row that asks it.
    renderCard(heldPlace(777, ['location']));

    expect(screen.getByText('pin corrected')).toBeInTheDocument();
  });

  it('offers no correction where no stored row answers to the record', () => {
    // A place the source has since withdrawn: the proposal is still what the run
    // recorded, but there is no row to correct.
    renderCard(heldPlace(null));

    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Château de Montségur');
    expect(screen.queryByTestId('correction')).toBeNull();
  });
});
