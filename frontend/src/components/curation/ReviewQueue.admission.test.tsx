/**
 * The review page's cards about whether a kind admits an object: a row the kind's rule
 * refused, the refusals a curator has confirmed, and a rule overridden — with what the
 * override put in front of readers.
 *
 * `ReviewQueue.test.tsx` holds the open questions answered on the spot, and says how the
 * queue read and the toolbar are stubbed; that holds here unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
}));

// The queue read and the toolbar are stubbed as `ReviewQueue.test.tsx` says, and why.
const { mockedFetch } = vi.hoisted(() => ({ mockedFetch: vi.fn() }));
vi.mock('./feed/ReviewToolbar', () => ({ ReviewToolbar: () => null }));

vi.mock('../../api/reviewQueue', () => ({
  fetchReviewQueue: async (params: unknown) => shaped(await mockedFetch(params)),
  setRunAside: vi.fn(),
  bringRunBack: vi.fn(),
}));
vi.mock('../../api/curation', () => ({
  setExperienceState: vi.fn(),
  setExperienceAdmission: vi.fn(),
  setLocationState: vi.fn(),
  acceptSourceValue: vi.fn(),
  declineSourceValue: vi.fn(),
  declineHeld: vi.fn(),
  publishExperience: vi.fn(),
  unrefuseContents: vi.fn(),
}));
vi.mock('../../api/experiences', () => ({
  fetchExperience: vi.fn(),
}));

import { shaped, renderQueue, MISSING, REFUSED, KEPT_OUT } from './reviewQueueFixtures';
import { mockedAdmission, mockedInvalidate, resetCardMocks } from './reviewQueueCardMocks';
import type { AdmissionResult } from '../../api/curation';

describe('ReviewQueue', () => {
  beforeEach(() => {
    resetCardMocks(mockedFetch);
  });

  describe('a row this kind refused', () => {
    beforeEach(() => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [REFUSED], conflicts: [], limit: 25,
      });
    });

    it('shows the rule\'s own words, which is the whole point of the card', async () => {
      renderQueue();

      // "Refused" alone leaves a curator guessing; the reason is what lets them
      // confirm a rule or spot a bad one.
      expect(await screen.findByText(/not an art museum/i)).toBeInTheDocument();
    });

    it('offers the two answers a refusal has, and none of the three a disappearance has', async () => {
      renderQueue();

      expect(await screen.findByRole('button', { name: /the rule was right/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /the rule was wrong/i })).toBeInTheDocument();
      // An open museum that was never a legitimate member is none of these.
      expect(screen.queryByRole('button', { name: /former/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /lost/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /false alarm/i })).not.toBeInTheDocument();
    });

    it('sends confirm when the curator agrees with the rule', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /the rule was right/i }));

      await waitFor(() => expect(mockedAdmission).toHaveBeenCalledWith(
        99, expect.objectContaining({ decision: 'confirm' })));
    });

    it('sends override when the curator does not', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /the rule was wrong/i }));

      await waitFor(() => expect(mockedAdmission).toHaveBeenCalledWith(
        99, expect.objectContaining({ decision: 'override' })));
    });

    it('withdraws the page\'s promise for this section only', async () => {
      renderQueue();

      // The standing line — nothing here has changed what visitors see — is
      // false of a refusal, which is hidden already.
      expect(await screen.findByText(/hidden already/i)).toBeInTheDocument();
    });

    it('keeps the promise intact when nothing was refused', async () => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], conflicts: [], limit: 25,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByText(/hidden already/i)).not.toBeInTheDocument();
    });

    it('can reach refusals behind a full page', async () => {
      const page = Array.from({ length: 25 }, (_, i) => ({ ...REFUSED, id: 200 + i }));
      mockedFetch.mockResolvedValue({
        missing: [], refused: page, conflicts: [], limit: 25, total: 118,
        paging: { nextCursor: '2026-09-05T10:00:00Z|3|224' },
      });
      renderQueue();

      await screen.findByRole('button', { name: /show more/i });
      expect(screen.getByRole('button', { name: /show more/i })).toBeEnabled();
    });
  });

  describe('a refusal the curator confirmed', () => {
    beforeEach(() => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [KEPT_OUT], conflicts: [], limit: 25,
      });
    });

    it('stays out of the way until asked for', async () => {
      renderQueue();

      // These are answered. A curator opening the page is here for what is not.
      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /put it back/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /show what you have kept out/i })).toBeInTheDocument();
    });

    it('offers the way back, because no other surface shows the row at all', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));

      expect(await screen.findByRole('button', { name: /put it back/i })).toBeInTheDocument();
      // The rule's objection is still what a curator needs to judge by.
      expect(screen.getByText(/not an art museum/i)).toBeInTheDocument();
    });

    it('does not re-ask the settled question', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));

      await screen.findByRole('button', { name: /put it back/i });
      // Answered means answered: offering "the rule was right" again invites a
      // second answer to a question that has one.
      expect(screen.queryByRole('button', { name: /the rule was right/i })).not.toBeInTheDocument();
    });

    it('sends override when the curator takes it back', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));
      fireEvent.click(await screen.findByRole('button', { name: /put it back/i }));

      await waitFor(() => expect(mockedAdmission).toHaveBeenCalledWith(
        99, expect.objectContaining({ decision: 'override' })));
    });

    it('shows nothing at all when nothing has been kept out', async () => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [], limit: 25,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /kept out/i })).not.toBeInTheDocument();
    });
  });

  it('says whether putting a row back also put it in front of readers, and what came with it', async () => {
    mockedAdmission.mockResolvedValue({
      experienceId: 99, admission: 'admitted', published: true,
      curationState: 'verified', appliedFields: [], claimedFieldsSkipped: [], appliedParts: [],
      fromSyncLogId: null, heldLeftOpen: 0,
      locationsPublished: 1, treasureLinksPublished: 12, treasuresPublished: 12, withdrawalsReleased: 0,
    } satisfies AdmissionResult);
    mockedFetch
      .mockResolvedValueOnce({ missing: [], refused: [REFUSED], conflicts: [], limit: 25 })
      .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /the rule was wrong/i }));

    // Un-refusing a row nobody had passed publishes it in the same transaction,
    // and everything that arrived under it — the same sentence shape the
    // publish card uses, not a vaguer one because the button had a different
    // label.
    expect(await screen.findByText(/1 point and 12 works now visible/)).toBeInTheDocument();

    // And the object's own caches, not only the queue's. An override makes the
    // row visible and publishes what arrived under it, so every other surface
    // reading `['experience', id]` — Discover, `CurationDialog`, the page the
    // curator may have just opened from this card — is now stale for as long as
    // the global 60s `staleTime` lasts. `docs/tech/experiences.md` described
    // this as what every card here does when it was true of one of them.
    expect(mockedInvalidate).toHaveBeenCalledWith(expect.anything(), { experienceId: 99 });
  });
});
