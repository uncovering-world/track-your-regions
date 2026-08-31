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

const mockedDeclineHeld = declineHeld as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishExperience as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedDeclineHeld.mockReset().mockResolvedValue({
    experienceId: 6194, declinedFields: [],
    declinedParts: [{ kind: 'treasures', name: 'The Wine Glass', fields: ['artist'] }],
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
      parts: [{ kind: 'treasures', ref: 'Q782639', name: 'The Wine Glass', fields: ['artist'] }],
    }, 64));
  });

  it('publishes the work\'s row alone, without touching the object\'s own fields', async () => {
    renderCard(held());

    fireEvent.click(screen.getByRole('button', { name: /publish this/i }));

    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(6194, {
      heldFields: undefined,
      heldParts: [{ kind: 'treasures', ref: 'Q782639', name: 'The Wine Glass', fields: ['artist'] }],
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
