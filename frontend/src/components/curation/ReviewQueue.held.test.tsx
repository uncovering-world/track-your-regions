/**
 * What a gated run is holding, as the review page asks it: one card per object however much
 * is open about it, the change and the contents published together or apart, one fact at a
 * time, and the line that says what a publication released or left behind.
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

import { shaped, renderQueue, CONFLICT, ARRIVAL, HELD, CONTENTS } from './reviewQueueFixtures';
import {
  mockedAccept, mockedPublish, mockedDeclineHeld, mockedExperience, mockedInvalidate,
  PUBLISHED, resetCardMocks,
} from './reviewQueueCardMocks';

describe('ReviewQueue', () => {
  beforeEach(() => {
    resetCardMocks(mockedFetch);
  });

  describe('what a gated run is holding', () => {
    it('asks about one museum once, however many things are open about it', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [],
        held: [HELD], contents: [CONTENTS],
        limit: 25,
      });
      renderQueue();

      // The API answers this as two rows so each query stays simple. To a
      // curator a museum whose label is held and which gained twelve paintings
      // is one object and one decision — so one question in the queue, and one
      // card. (The name appears twice on the screen: once in the list, once on
      // the card it opens.)
      expect(await screen.findAllByRole('button', { name: /Museo del Prado/ })).toHaveLength(1);
      // Awaited, not read on the spot: the page selects the first row by writing it into
      // the address, and the router re-renders through a transition, so the bench answers
      // one tick after the list does.
      expect(await screen.findByText(/1 new point/)).toBeInTheDocument();
      expect(screen.getByText(/12 new works/)).toBeInTheDocument();
    });

    it('lists what is waiting, and says so when it is showing only some of it', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [],
        contents: [{
          ...CONTENTS,
          pending_locations: 93,
          pending_treasures: 2,
          // What the server sends for a serial nomination: the first of them, and
          // the count above saying how many there really are.
          pending_points: Array.from({ length: 25 }, (_, i) => ({
            id: 500 + i, name: `Component ${i + 1}`, externalRef: `874-0${i}`,
            latitude: 38.5, longitude: -6.1,
          })),
          pending_works: [
            { id: 9, name: 'Venus de Milo', artists: ['Alexandros of Antioch'], artistsCurated: false, year: -100, imageUrl: null, iconic: true },
            { id: 10, name: 'Study of a head', artists: [], artistsCurated: false, year: null, imageUrl: null, iconic: false },
          ],
        }],
        limit: 25,
      });
      renderQueue();

      // The rows themselves, which is what #524 is about: twelve works "counted
      // rather than listed" asks a curator to decide about things they cannot see.
      expect(await screen.findByText(/Venus de Milo/)).toBeInTheDocument();
      // The last of the twenty-five, whose number no other row's contains.
      expect(screen.getByText(/Component 25/)).toBeInTheDocument();

      // And the cap said out loud. A list shorter than its count that keeps quiet
      // reads as "these are all of them", which is the silent truncation that
      // makes a queue untrustworthy — 25 of 93 here.
      expect(screen.getByText(/showing 25 of 93 points/)).toBeInTheDocument();
      // Nothing is capped on the works side, so nothing is claimed about it.
      expect(screen.queryByText(/showing 2 of 2 works/)).not.toBeInTheDocument();
    });

    it('offers the change alone when a card holds both halves', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [],
        held: [HELD], contents: [CONTENTS],
        limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /Publish the change only/ }));

      // #524's case, from the curator's side: doubting one proposed sentence
      // must stop meaning twelve checked paintings stay invisible.
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(
        7, { fieldsOnly: true, expectedSyncLogId: 47 },
      ));
    });

    it('does not offer it where there is only one half to publish', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], contents: [CONTENTS], limit: 25,
      });
      renderQueue();

      // The one button already means exactly one thing here, and a second saying
      // "only" beside it would be a distinction without a difference.
      await screen.findByText(/12 new works/);
      expect(screen.queryByRole('button', { name: /Publish the change only/ })).not.toBeInTheDocument();
    });

    it('publishes through the one endpoint that can apply a held field', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], contents: [], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // Not `accept-source`: its lookup requires `curatedConflict: true`, and a
      // field held by the kind's gate carries false — that button would 409
      // on every click. The run id is the held pointer, so a newer proposal
      // cannot substitute itself for the one on the card.
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(7, { expectedSyncLogId: 47 }));
      expect(mockedAccept).not.toHaveBeenCalled();
    });

    it('says up front when everything on a held card arrives rather than changes', async () => {
      // Bamiyan's card from run 68, which is the shape of 1272 cards on this catalogue:
      // the criteria and a picture credit appear where there was nothing. A value
      // replacing one readers can see is a different question, and the card says
      // which it is before the rows (#570).
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], contents: [], limit: 25,
        held: [{
          ...HELD,
          proposed: [
            { field: 'tags', old: [], new: ['criterion_i', 'in_danger'], held: true },
            { field: 'metadata', old: { website: 'https://whc.unesco.org/en/list/208' },
              new: { website: 'https://whc.unesco.org/en/list/208', criteria: '(i)(ii)' }, held: true },
          ],
        }],
      });
      renderQueue();

      // Tags are not a row, so the count is the one fact that arrives, and the line
      // says outright that readers see nothing different.
      const count = await screen.findByText('1 new');
      expect(count.parentElement?.textContent).toContain('inscription criteria');
      expect(screen.getByText('· nothing readers see changes')).toBeInTheDocument();
    });

    it('says what a card holding only the catalogue’s labels is, instead of "proposes nothing"', async () => {
      // Tags are not a row (#570), so a card an earlier run filed with tags alone has
      // no table to draw. It must not read as a run proposing nothing over an empty
      // table while its button writes the labels.
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], contents: [], limit: 25,
        held: [{ ...HELD, proposed: [{ field: 'tags', old: [], new: ['criterion_ii'], held: true }] }],
      });
      renderQueue();

      expect(await screen.findByText(/Run 47 proposed only the catalogue’s own labels/)).toBeInTheDocument();
      expect(screen.queryByText(/proposes/)).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /publish the change/i })).toBeInTheDocument();
    });

    it('says nothing of the kind when a value readers see is being replaced', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], contents: [], limit: 25,
      });
      renderQueue();

      await screen.findByRole('button', { name: /publish the change/i });
      expect(screen.getByText('1 changed')).toBeInTheDocument();
      expect(screen.queryByText(/nothing readers see changes/)).not.toBeInTheDocument();
    });

    it('names no run for an arrival, whose own run id points at nothing held', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /readers may see it/i }));

      // A `pending` row holds no proposal — the pointer is set only on a row
      // that is not pending — so sending the run that first saw it would be
      // compared against null and refused every time.
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(55, {}));
    });

    it('publishes contents only for a card with no held half, never an object publish', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], contents: [CONTENTS], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish what has arrived/i }));

      // `{}` means an object publish, which sets curation_state = 'verified' —
      // a false claim that a person read the museum when only twelve paintings
      // were ever looked at (ADR-0025 § 4.4), and a 409 waiting to happen on any
      // row that also carries a claim's own pointer.
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(7, { contentsOnly: true }));
    });

    it('still publishes the object when a held change accompanies the contents', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], contents: [CONTENTS], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change and what arrived/i }));

      // A held half is a real object publish — sending `contentsOnly` here
      // would mark the row read without ever answering the held proposal.
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(7, { expectedSyncLogId: 47 }));
    });

    it('keeps a claimed field a separate question from a held one', async () => {
      // The same museum, both ways: the gate held the description, the curator
      // claims the name. Two answers, two endpoints — merging them under one
      // button is the collapse #519 was filed about.
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [{ ...CONFLICT, id: 7, name: 'Museo del Prado' }],
        held: [HELD], contents: [], limit: 25,
      });
      renderQueue();

      // Two rows for one museum, which is the point: the queue asks them separately
      // because they are answered separately, and the bench shows whichever is open.
      const rows = await screen.findAllByRole('button', { name: /Museo del Prado/ });
      expect(rows).toHaveLength(2);

      fireEvent.click(rows[1]);
      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(7, { expectedSyncLogId: 47 }));

      fireEvent.click(rows[0]);
      fireEvent.click(await screen.findByRole('button', { name: /take all of the source/i }));
      await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(7, ['name'], 41));
    });

    it('does not claim nothing is waiting while a gated object sits below', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25,
      });
      renderQueue();

      await screen.findByRole('button', { name: /readers may see it/i });
      expect(screen.queryByText(/nothing waiting/i)).not.toBeInTheDocument();
    });

    it('can reach gated objects behind a full page', async () => {
      mockedFetch
        .mockResolvedValueOnce({
          contents: Array.from({ length: 2 }, (_, i) => ({ ...CONTENTS, id: 300 + i })),
          limit: 2,
          total: 3,
          paging: { nextCursor: '2026-09-05T10:00:00Z|2|301' },
        })
        .mockResolvedValue({ contents: [{ ...CONTENTS, id: 302, name: 'Museo Nacional' }], limit: 2 });
      renderQueue();

      // The three gated kinds are one row per object in one union now, so there is one
      // control and one cursor — but a page of them still ends short of the backlog.
      fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));

      expect(await screen.findByRole('button', { name: /Museo Nacional/ })).toBeInTheDocument();
    });

    it('says what the publication released, including the pin that went with it', async () => {
      mockedPublish.mockResolvedValue({
        ...PUBLISHED, locationsPublished: 2, treasureLinksPublished: 12, treasuresPublished: 12,
        withdrawalsReleased: 1,
      });
      mockedFetch
        .mockResolvedValueOnce({
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25 });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // The refetch takes the card away, so this is the only place the moment a
      // replaced pin stopped being shown is recorded for the person who caused it.
      expect(await screen.findByText(/2 points and 12 works now visible/)).toBeInTheDocument();
      expect(screen.getByText(/1 replaced point no longer shown/)).toBeInTheDocument();
    });

    it('does not report a publication with stale regions as an unqualified success', async () => {
      mockedPublish.mockResolvedValue({
        ...PUBLISHED, locationsPublished: 1, withdrawalsReleased: 1, placementFailed: true,
        placementFailedWorldViews: [{ id: 4, name: 'Wikivoyage' }],
      });
      mockedFetch
        .mockResolvedValueOnce({
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25 });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      expect(await screen.findByText(/were not recomputed/)).toBeInTheDocument();
    });

    it('names the world views a curator has to report, since they cannot re-place them', async () => {
      mockedPublish.mockResolvedValue({
        ...PUBLISHED, withdrawalsReleased: 1, placementFailed: true,
        placementFailedWorldViews: [{ id: 4, name: 'Wikivoyage' }, { id: 7, name: null }],
      });
      mockedFetch
        .mockResolvedValueOnce({
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25 });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // Region assignment is admin-only end to end, and this page's ordinary
      // reader is a scoped curator. "Something about regions failed" is not a
      // thing they can hand to an admin; a named world view is. The id rides
      // along because that is what the admin works from.
      const notice = await screen.findByText(/were not recomputed/);
      expect(notice).toHaveTextContent('Wikivoyage (world view 4)');
      expect(notice).toHaveTextContent('world view 7');
      expect(notice).toHaveTextContent(/only an admin can run a re-assignment/);
    });

    it('says nothing was even attempted when the world views could not be listed', async () => {
      mockedPublish.mockResolvedValue({
        ...PUBLISHED, withdrawalsReleased: 1, placementFailed: true,
        placementFailedWorldViews: [{ id: null, name: null }],
      });
      mockedFetch
        .mockResolvedValueOnce({
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25 });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // A different fact from a named world view refusing: nothing was placed at
      // all, and there is no world view to name.
      expect(await screen.findByText(/could not even be listed/)).toBeInTheDocument();
    });

    it('drops the object\'s own caches, not only this queue', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // A publication changes the fields, points, works and counts every other
      // surface reads — including the object the curator just looked at from
      // this card, whose cache key Discover and the curation dialog share. Left
      // alone, a publish that succeeded is followed by the pre-publish snapshot
      // for as long as the global staleTime lasts.
      await waitFor(() => expect(mockedInvalidate).toHaveBeenCalledWith(
        expect.anything(), { experienceId: 7 }));
    });

    it('answers one fact at a time, publishing that row and leaving the rest', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish this/i }));

      // #722: a run improves and damages in the same breath, and until now the
      // card's one button took both or neither. The row names the field; what is
      // not named stays open and keeps the card.
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(7, {
        heldFields: ['name'], heldParts: undefined, expectedSyncLogId: 47,
      }));
    });

    it('refuses one fact without claiming it', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /not this/i }));

      // Not `publishExperience` and not an edit: the one lever a curator had
      // before was to claim the field by editing it, which says whose value it
      // is rather than what is wrong with this one, and outlives the question.
      await waitFor(() => expect(mockedDeclineHeld).toHaveBeenCalledWith(
        7, { fields: ['name'], parts: undefined }, 47));
      expect(mockedPublish).not.toHaveBeenCalled();
    });

    it('says what a refusal settled, since the row goes away', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /not this/i }));

      // The answer is about *that value*, so a curator meeting the field again
      // next month is being told the source changed its mind, not that the click
      // failed. Matched on the line's own words rather than on the sentence about
      // proposing again, which the card's standing caption also carries — a
      // pattern both would satisfy would pass with the notice never rendered.
      expect(await screen.findByText(/refused — readers keep what they see/i))
        .toBeInTheDocument();
    });

    it('shows what the server said when the card was drawn against an older run', async () => {
      mockedPublish.mockRejectedValue(
        new Error('This row is holding a proposal from a different run — reload to see it'));
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // The refusal is the answer, and the card has to come back live rather
      // than disabled: the refetch redraws it against what the server now holds.
      await waitFor(() => expect(screen.getByText(/from a different run/)).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /publish the change/i })).toBeEnabled();
    });

    it('follows the card through to the object the gate is hiding', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /look at the object/i }));

      // An arrival is in no list, no count and on no map. A curator's by-id read
      // is the only place it answers at all, and judging it is the whole reason
      // that read was relaxed.
      await waitFor(() => expect(mockedExperience).toHaveBeenCalledWith(55));
      expect(await screen.findByText(/Slim family collection/)).toBeInTheDocument();
    });

    it('does not claim a point count the by-id read never carries', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /look at the object/i }));

      // GET /api/experiences/:id carries no location_count column at all —
      // that field only exists on the region list's own query — so this
      // number was always zero regardless of the object's real contents. A
      // true sentence beats a false zero (#524 tracks the read that would
      // list this properly).
      await screen.findByText(/Slim family collection/);
      expect(screen.queryByText(/reader would see/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/0 points?/i)).not.toBeInTheDocument();
    });

    it('does not print "undefined" for a held card with no run id on record', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [],
        held: [{ ...HELD, sync_log_id: undefined }], contents: [], limit: 25,
      });
      renderQueue();

      // `sync_log_id` is optional on the type; printing the literal word
      // "undefined" for a row that somehow lacks it is worse than naming no
      // run at all.
      expect(await screen.findByText(/An earlier run proposes/)).toBeInTheDocument();
      expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    });
  });
});
