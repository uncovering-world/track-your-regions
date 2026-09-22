/**
 * The review page's answered parts: a withdrawn point a curator has already answered, and
 * a point or work a curator turned down — each shown only when asked for, and each with its
 * way back, since no other screen shows them at all.
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

import { shaped, renderQueue, MISSING, REFUSED_PARTS } from './reviewQueueFixtures';
import {
  mockedState, mockedLocationState, mockedUnrefuse, resetCardMocks,
} from './reviewQueueCardMocks';

describe('ReviewQueue', () => {
  beforeEach(() => {
    resetCardMocks(mockedFetch);
  });

  describe('a withdrawn point the curator has answered', () => {
    /** Bilbao's point, one verdict later: the source dropped it, the flag still standing. */
    const ANSWERED = {
      ...MISSING,
      id: 1592,
      name: 'Bilbao Fine Arts Museum',
      kind: 'withdrawn-answered' as const,
      missing_since: null,
      answered_points: [{
        id: 13211,
        name: null,
        externalRef: 'Q127064',
        missingSince: '2026-08-10T20:03:01.941Z',
        latitude: 43.265974,
        longitude: -2.93785,
        sourceMembership: 'former' as const,
        existence: 'extant' as const,
        decidedAt: '2026-08-15T09:12:00.000Z',
        note: null,
        decidedBy: 'Nikolay',
        visited: false,
      }],
    };

    beforeEach(() => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        answeredWithdrawals: [ANSWERED], limit: 25,
      });
    });

    it('stays out of the way until asked for, like the block above it', async () => {
      renderQueue();

      // Answered work. A curator opening this page is here for what is not.
      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /it is still listed/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /show the lost places you have answered/i }))
        .toBeInTheDocument();
    });

    it('offers the way back, because no other screen shows the point at all', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the lost places you have answered/i }));

      expect(await screen.findByRole('button', { name: /it is still listed/i })).toBeInTheDocument();
      expect(screen.getByText(/by Nikolay/)).toBeInTheDocument();
    });

    it('sends the verdict back to the point’s own endpoint', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the lost places you have answered/i }));
      fireEvent.click(await screen.findByRole('button', { name: /it is still listed/i }));

      // Per point, not per object: the object-level verdict is a different row and a
      // different endpoint, and sending it there would answer about the whole museum.
      await waitFor(() => expect(mockedLocationState).toHaveBeenCalledWith(
        13211, expect.objectContaining({ membership: 'present' })));
      expect(mockedState).not.toHaveBeenCalled();
    });

    it('counts places on the toggle, because that is what its label names', async () => {
      // One row here is one *object* holding up to a page of answered *places*, unlike the
      // kept-out block where a row is the thing itself. Counting rows would offer "(1)"
      // over a serial nomination holding ninety-three, and the number that corrects it is
      // inside the card — visible only after the click the count exists to inform.
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        answeredWithdrawals: [{ ...ANSWERED, answered_points_total: 93 }],
        limit: 25,
      });
      renderQueue();

      expect(await screen.findByRole(
        'button', { name: /show the lost places you have answered \(93\)/i })).toBeInTheDocument();
    });

    it('falls back to the points it was sent where no total came with them', async () => {
      renderQueue();

      expect(await screen.findByRole(
        'button', { name: /show the lost places you have answered \(1\)/i })).toBeInTheDocument();
    });

    it('shows nothing at all when no point carries a verdict', async () => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        answeredWithdrawals: [], limit: 25,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /lost places you have answered/i }))
        .not.toBeInTheDocument();
    });

    it('leaves a way back when its own page comes back empty', async () => {
      // The block renders whole or not at all, and its pager renders inside it — so a
      // page answered down to nothing would take the only control that could go back
      // with it, stranding the offset until a reload. It is the offset, not the rows,
      // that decides whether the block is drawn.
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        answeredWithdrawals: [], limit: 25,
        paging: { answeredWithdrawals: { offset: 25, hasMore: false } },
      });
      renderQueue();

      fireEvent.click(await screen.findByRole(
        'button', { name: /show the lost places you have answered/i }));

      expect(await screen.findByRole('button', { name: 'Previous' })).toBeEnabled();
    });
  });

  /**
   * The third answered block: the answer that would otherwise have no way back (#859).
   *
   * Turning down an unread point or work is otherwise the one answer on this page
   * with no way back: readers never see the part, and the mark takes it out of every
   * question, so a mis-click would live on in the curation log and nowhere else.
   */
  describe('a point or work the curator turned down', () => {
    beforeEach(() => {
      mockedUnrefuse.mockReset().mockResolvedValue({
        experienceId: 6188,
        locationsRestored: 1,
        treasureLinksRestored: 0,
        locationIds: [4101],
        treasureIds: [],
      });
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        refusedParts: [REFUSED_PARTS], limit: 25,
      });
    });

    it('stays out of the way until asked for, like the blocks above it', async () => {
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /ask about it again/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /show the points and works you have turned down/i }))
        .toBeInTheDocument();
    });

    it('offers the way back, because no other screen shows the part at all', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the points and works you have turned down/i }));

      expect(await screen.findByText('Pavillon Amont')).toBeInTheDocument();
      expect(screen.getByText('The Oreads')).toBeInTheDocument();
      // Who turned it down, and what they wrote — the only record of either.
      expect(screen.getByText(/by Camille — “the annexe, not the museum”/)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /ask about it again/i })).toHaveLength(2);
    });

    it('says "a curator" where the log names nobody this reader may see', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the points and works you have turned down/i }));

      // The work's refusal carries no name: out of this reader's scope, or answered
      // in a batch. Somebody still decided, and an empty line would say less.
      expect(await screen.findByText(/by a curator\.$/)).toBeInTheDocument();
    });

    it('sends the part’s own id to the take-back, per part and per kind', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the points and works you have turned down/i }));
      const buttons = await screen.findAllByRole('button', { name: /ask about it again/i });

      fireEvent.click(buttons[0]);
      await waitFor(() => expect(mockedUnrefuse).toHaveBeenCalledWith(6188, { locationIds: [4101] }));

      fireEvent.click(buttons[1]);
      // The work goes by its treasure id and on the link's axis alone: turning it
      // down said "not this work here", and so does asking again.
      await waitFor(() => expect(mockedUnrefuse).toHaveBeenCalledWith(6188, { treasureIds: [14341] }));
    });

    it('counts parts on the toggle, because that is what its label names', async () => {
      // One row is one object holding turned-down points *and* works. Counting rows
      // would offer "(1)" over a museum that lost a branch and twelve paintings.
      renderQueue();

      expect(await screen.findByRole(
        'button', { name: /show the points and works you have turned down \(5\)/i }))
        .toBeInTheDocument();
    });

    it('says what asking again did, and what it did not', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the points and works you have turned down/i }));
      fireEvent.click((await screen.findAllByRole('button', { name: /ask about it again/i }))[0]);

      // The question is back, not the answer: a curator who has just clicked this
      // needs to know publishing is still what shows it.
      expect(await screen.findByText(
        /1 point under Musée d'Orsay is asked about again\..*publishing it is what shows it/i))
        .toBeInTheDocument();
    });

    it('does not promise what a source-withdrawn part will not do', async () => {
      // Placement carries `missing_since IS NULL`, and the contents card and the
      // publish both compose `offeredLocationSql` — so for a part the source has
      // dropped, "counts toward its regions again" and "publishing shows it" are
      // both false. The fixture's work is in exactly that state.
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the points and works you have turned down/i }));

      expect(await screen.findByText(/The source stopped listing it on/)).toBeInTheDocument();
      const captions = screen.getAllByText(/Puts the question back on record/);
      expect(captions.length).toBeGreaterThan(0);

      fireEvent.click((await screen.findAllByRole('button', { name: /ask about it again/i }))[1]);
      expect(await screen.findByText(
        /The question is back on record\. The source no longer offers it/)).toBeInTheDocument();
    });

    it('does not offer the button at all on an object the source has stopped listing', async () => {
      // The writer refuses outright on such an object, so a button here would 409
      // with nothing the curator could act on from this card. Its own question is
      // the one to answer, and the card says so rather than the list hiding the
      // parts — hidden, they would be back on no screen at all.
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        refusedParts: [{
          ...REFUSED_PARTS, takeable: false, missing_since: '2026-09-09T20:00:00Z',
        }],
        limit: 25,
      });
      renderQueue();
      fireEvent.click(await screen.findByRole(
        'button', { name: /show the points and works you have turned down/i }));

      // One per part, since the block is per object and every part under it is blocked.
      expect(await screen.findAllByText(/Answer that question first/)).toHaveLength(2);
      for (const button of screen.getAllByRole('button', { name: /ask about it again/i })) {
        expect(button).toBeDisabled();
      }
      expect(mockedUnrefuse).not.toHaveBeenCalled();
    });

    it('names the question to answer first, per reason the writer would refuse for', async () => {
      // Three causes, three cards to send the curator to. The verdict is the
      // server's `takeable`; only which sentence to print is decided here.
      for (const [patch, sentence] of [
        [{ object_curation_state: 'pending' }, /Answer its arrival first/],
        [{ object_admission: 'refused' }, /Put it back first/],
      ] as const) {
        mockedFetch.mockResolvedValue({
          missing: [MISSING], refused: [], keptOut: [], conflicts: [],
          refusedParts: [{ ...REFUSED_PARTS, takeable: false, ...patch }],
          limit: 25,
        });
        const { unmount } = renderQueue();
        fireEvent.click(await screen.findByRole(
          'button', { name: /show the points and works you have turned down/i }));
        expect((await screen.findAllByText(sentence)).length).toBeGreaterThan(0);
        unmount();
      }
    });

    it('shows nothing at all when nothing has been turned down', async () => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        refusedParts: [], limit: 25,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /points and works you have turned down/i }))
        .not.toBeInTheDocument();
    });

    it('leaves a way back when its own page comes back empty', async () => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        refusedParts: [], limit: 25,
        paging: { refusedParts: { offset: 25, hasMore: false } },
      });
      renderQueue();

      fireEvent.click(await screen.findByRole(
        'button', { name: /show the points and works you have turned down/i }));

      expect(await screen.findByRole('button', { name: 'Previous' })).toBeEnabled();
    });
  });
});
