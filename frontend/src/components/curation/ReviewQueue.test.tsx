/**
 * Tests for the curator's review queue.
 *
 * The behaviour worth pinning is what the page promises: three distinct answers
 * to a missing object (two of which change something and one of which does
 * not), and a conflict view that shows both versions before asking anyone to
 * choose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
}));

vi.mock('../../api/experiences', () => ({
  fetchReviewQueue: vi.fn(),
  setExperienceState: vi.fn(),
  setExperienceAdmission: vi.fn(),
  setLocationState: vi.fn(),
  acceptSourceValue: vi.fn(),
  declineSourceValue: vi.fn(),
  publishExperience: vi.fn(),
  fetchExperience: vi.fn(),
}));

import {
  fetchReviewQueue, setExperienceState, setExperienceAdmission, setLocationState,
  acceptSourceValue, declineSourceValue, publishExperience, fetchExperience,
} from '../../api/experiences';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { ReviewPage } from './ReviewPage';

const mockedFetch = fetchReviewQueue as unknown as ReturnType<typeof vi.fn>;
const mockedState = setExperienceState as unknown as ReturnType<typeof vi.fn>;
const mockedAccept = acceptSourceValue as unknown as ReturnType<typeof vi.fn>;
const mockedDecline = declineSourceValue as unknown as ReturnType<typeof vi.fn>;
const mockedAdmission = setExperienceAdmission as unknown as ReturnType<typeof vi.fn>;
const mockedLocationState = setLocationState as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishExperience as unknown as ReturnType<typeof vi.fn>;
const mockedExperience = fetchExperience as unknown as ReturnType<typeof vi.fn>;
const mockedInvalidate = invalidateExperiences as unknown as ReturnType<typeof vi.fn>;

/** What `POST /:id/publish` answers when nothing but the row itself moved. */
const PUBLISHED = {
  experienceId: 7,
  curationState: 'verified',
  appliedFields: ['name'],
  claimedFieldsSkipped: [],
  fromSyncLogId: 47,
  locationsPublished: 0,
  treasureLinksPublished: 0,
  treasuresPublished: 0,
  withdrawalsReleased: 0,
};

const MISSING = {
  id: 77,
  external_id: '1234',
  name: 'Dresden Elbe Valley',
  category_id: 1,
  category_name: 'UNESCO World Heritage Sites',
  missing_since: '2026-08-03T10:00:00Z',
  source_membership: 'present' as const,
  existence: 'extant' as const,
  kind: 'missing' as const,
  proposed: null,
};

const REFUSED = {
  ...MISSING,
  id: 99,
  external_id: 'Q6373',
  name: 'British Museum',
  category_id: 2,
  category_name: 'Top Art Museums',
  kind: 'refused' as const,
  missing_since: null,
  admission_reason: 'not an art museum \u2014 archaeology',
};

const KEPT_OUT = {
  ...REFUSED,
  kind: 'kept-out' as const,
  state_decided_at: '2026-08-08T09:00:00Z',
  state_note: 'archaeology, comes back with that import',
};

const CONFLICT = {
  ...MISSING,
  id: 88,
  name: 'Serengeti National Park',
  kind: 'conflict' as const,
  missing_since: null,
  proposed: [{ field: 'name', old: 'Curator wording', new: 'Renamed upstream', acceptable: true }],
  sync_log_id: 41,
};

const ARRIVAL = {
  ...MISSING,
  id: 55,
  external_id: 'Q160236',
  name: 'Museo Soumaya',
  category_id: 2,
  category_name: 'Top Art Museums',
  kind: 'arrival' as const,
  missing_since: null,
  curation_state: 'pending',
  // The run that first saw it, not a held pointer — see the test that pins
  // what the publish body may carry for an arrival.
  sync_log_id: 61,
};

const HELD = {
  ...MISSING,
  id: 7,
  external_id: 'Q160112',
  name: 'Museo del Prado',
  category_id: 2,
  category_name: 'Top Art Museums',
  kind: 'held' as const,
  missing_since: null,
  proposed: [{ field: 'name', old: 'Prado', new: 'Museo Nacional del Prado', held: true }],
  sync_log_id: 47,
};

const CONTENTS = {
  ...HELD,
  kind: 'contents' as const,
  proposed: null,
  sync_log_id: undefined,
  pending_locations: 1,
  pending_treasures: 12,
};

/**
 * The page, not the cards.
 *
 * These assertions are about what a curator can do — answer, be told what happened, reach
 * what is behind a page — and none of them was about the single-column layout the page used
 * to have. The screen is now a list beside a bench, which selects the first question on its
 * own, so a queue holding one of something opens on it exactly as before.
 */
function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewPage />
    </QueryClientProvider>
  );
}

/**
 * Open one question, where the queue holds more than one.
 *
 * The page selects the first row on its own, so a queue with a single question needs no
 * click. With several, the bench shows one at a time — which is the change — and a test
 * about a particular card has to say which.
 */
async function openRow(name: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

describe('ReviewQueue', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedState.mockReset().mockResolvedValue({ experienceId: 77 });
    mockedAccept.mockReset().mockResolvedValue({ experienceId: 88, applied: ['name'], released: [], fromSyncLogId: 9 });
    mockedDecline.mockReset().mockResolvedValue({ experienceId: 88, declined: ['name'], fromSyncLogId: 41 });
    mockedAdmission.mockReset().mockResolvedValue({
      experienceId: 99, admission: 'refused', published: false,
    });
    mockedLocationState.mockReset().mockResolvedValue({
      locationId: 13211, experienceId: 1592, offeredToReaders: true,
    });
    mockedPublish.mockReset().mockResolvedValue(PUBLISHED);
    mockedInvalidate.mockReset();
    mockedExperience.mockReset().mockResolvedValue({
      id: 55, name: 'Museo Soumaya', description: 'The Slim family collection.',
      short_description: null, image_url: null, latitude: 19.4406, longitude: -99.2047,
      country_names: ['Mexico'], location_count: 1,
    });
    mockedFetch.mockResolvedValue({
      missing: [MISSING], refused: [], conflicts: [CONFLICT], limit: 25, offset: 0,
    });
  });

  it('moves to the question that took the answered one’s place, not back to the top', async () => {
    // The property the whole list/bench split is for, and it was wired wrong while the
    // function underneath it passed its own tests: `selectedIndex` is recomputed from the
    // *current* rows, so the moment the answered row leaves it reads -1 — which means
    // "nothing was selected" and sends the selection to row one.
    const three = [77, 78, 79].map(id => ({ ...MISSING, id, name: `Site ${id}` }));
    mockedFetch
      .mockResolvedValueOnce({ missing: three, conflicts: [], limit: 25 })
      .mockResolvedValue({ missing: [three[0], three[2]], conflicts: [], limit: 25 });
    renderQueue();

    await openRow(/Site 78/);
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // Site 79 took index 1 when 78 left, so it is the question in front of the curator.
    expect(await screen.findByRole('heading', { name: /Site 79/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Site 77/ })).not.toBeInTheDocument();
  });

  it('keeps a way back when a kind’s page comes back empty', async () => {
    // Page the refusals forward, answer what was on page 2, and the rows in front of them
    // become unreachable: the per-kind pager renders under the last row of its kind, so a
    // kind with no rows renders no pager at all.
    mockedFetch.mockResolvedValue({
      missing: [MISSING], refused: [], conflicts: [], limit: 25,
      paging: { refused: { offset: 25, hasMore: false }, missing: { offset: 0, hasMore: false } },
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /refused — previous/i }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith({ offsets: { refused: 0 } }));
  });

  it('offers the three answers a missing object can have', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);

    expect(await screen.findByRole('button', { name: /former/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lost/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /false alarm/i })).toBeInTheDocument();
  });

  it('tells the server what the card was showing', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // Without it the server cannot tell this card from one drawn before
    // someone else answered — and a correction from a current view has to
    // stay possible, or a mis-clicked verdict could never be taken back
    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({
        expected: { membership: 'present', existence: 'extant', flagged: true },
      }));
    });
  });

  it('sends "former" as a membership decision, leaving existence alone', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({ membership: 'former' }));
    });
    expect(mockedState.mock.calls[0][1]).not.toHaveProperty('existence');
  });

  it('sends "lost" as an existence decision — a destroyed site can still be listed', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);

    fireEvent.click(await screen.findByRole('button', { name: /lost/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({ existence: 'lost' }));
    });
    expect(mockedState.mock.calls[0][1]).not.toHaveProperty('membership');
  });

  it('treats "false alarm" as restoring presence, which clears the flag', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);

    fireEvent.click(await screen.findByRole('button', { name: /false alarm/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({ membership: 'present' }));
    });
  });

  it('shows both versions in full before asking anyone to choose', async () => {
    renderQueue();

    // Whole values, side by side under their own labels — not the two ellipses the
    // 120-character summary used to give. The words themselves are split across marked
    // and unmarked runs, so this asks the rendered text for them rather than one node.
    const yours = await screen.findByText('yours');
    const source = screen.getByText('the source proposes');
    expect(yours.parentElement?.textContent).toContain('Curator wording');
    expect(source.parentElement?.textContent).toContain('Renamed upstream');
    // Each value stays under its own heading: a comparison that put the source's text on
    // the curator's side would read as their own words being replaced by themselves.
    expect(yours.parentElement?.textContent).not.toContain('Renamed upstream');
  });

  it('compares an added value against nothing, instead of calling it a shape difference', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'shortDescription', old: null, new: 'A description this row never had', acceptable: true },
      ] }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25, offset: 0,
    });
    renderQueue();

    // The commonest non-text shape is not a shape disagreement at all: one side is
    // simply empty, which a gated proposal adding a description does constantly. Saying
    // "the shape is part of the difference" there is false, and it withholds the marking
    // from text that compares perfectly well.
    expect(await screen.findByText(/A description this row never had/)).toBeInTheDocument();
    expect(screen.queryByText(/the shape is part of the difference/)).not.toBeInTheDocument();
  });

  it('takes one field without taking the rest', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'name', old: 'Curator wording', new: 'Renamed upstream', acceptable: true },
        { field: 'shortDescription', old: 'Mine', new: 'Theirs', acceptable: true },
      ] }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25, offset: 0,
    });
    renderQueue();

    // A run improves and damages in the same breath: a better description arriving with
    // a mangled name was one button that took both or neither. The endpoint always
    // accepted a list — the screen could not say "this one".
    const takeThese = await screen.findAllByRole('button', { name: 'take this' });
    fireEvent.click(takeThese[1]);

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['shortDescription'], 41));
  });

  it('lets a curator settle one field their own way', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{
        ...CONFLICT,
        sync_log_id: 41,
        proposed: [
          { field: 'name', old: 'Curator wording', new: 'Renamed upstream', acceptable: true },
          { field: 'shortDescription', old: 'Mine', new: 'Theirs', acceptable: true },
        ],
      }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25, offset: 0,
    });
    renderQueue();

    // Standing by your own value used to be the absence of an action, which is why the
    // same card came back after every run. The run id goes with it for the reason it goes
    // with an acceptance: refusing the wrong run silences a proposal nobody read.
    const keepThese = await screen.findAllByRole('button', { name: 'keep this' });
    fireEvent.click(keepThese[1]);

    await waitFor(() => expect(mockedDecline).toHaveBeenCalledWith(88, ['shortDescription'], 41));
    expect(mockedAccept).not.toHaveBeenCalled();
  });

  it('offers the refusal on a field the source’s value cannot be written to', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{
        ...CONFLICT,
        sync_log_id: 41,
        proposed: [{ field: 'location', old: null, new: { lat: 1 }, acceptable: false }],
      }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25, offset: 0,
    });
    renderQueue();

    // Accepting a coordinate waits for the next sync; refusing one writes nothing at
    // all, so there is no field the answer cannot reach.
    fireEvent.click(await screen.findByRole('button', { name: 'keep this' }));

    await waitFor(() => expect(mockedDecline).toHaveBeenCalledWith(88, ['location'], 41));
  });

  it('says what a refusal settled, since the card leaves with it', async () => {
    mockedDecline.mockResolvedValue({ experienceId: 88, declined: ['shortDescription'], fromSyncLogId: 41 });
    mockedFetch
      .mockResolvedValueOnce({
        missing: [],
        conflicts: [{ ...CONFLICT, sync_log_id: 41, proposed: [{ field: 'shortDescription', old: 'Mine', new: 'Theirs', acceptable: true }] }],
        refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25, offset: 0,
      })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'keep this' }));

    // In the reader's words, and naming the run — so a curator meeting the field again
    // later is being told the source changed its mind, not that the click failed.
    expect(await screen.findByText(/short description — yours stands/)).toBeInTheDocument();
    expect(screen.getByText(/run 41/)).toBeInTheDocument();
  });

  it('stops calling another curator’s claim "my edit"', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{
        ...CONFLICT,
        run_completed_at: '2026-08-05T09:00:00Z',
        proposed: [{
          field: 'name',
          old: 'Curator wording',
          new: 'Renamed upstream',
          acceptable: true,
          claim: { by: 'Dana', at: '2026-08-04T12:29:32Z' },
          decidedBefore: [{ by: 'admin', at: '2026-07-30T08:00:00Z', applied: 'An earlier upstream name' }],
        }],
      }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25, offset: 0,
    });
    renderQueue();

    // The dead button said "Keep my edit (current)" over a claim someone else made, and
    // named the run only after acting. Now the trail says whose text stands, when the
    // source proposed otherwise, and what was answered here before.
    expect(await screen.findByText(/Claimed by Dana/)).toBeInTheDocument();
    expect(screen.getByText(/Proposed by the run that finished/)).toBeInTheDocument();
    expect(screen.getByText(/admin took the source’s value/)).toBeInTheDocument();
    expect(screen.queryByText(/Keep my edit/)).not.toBeInTheDocument();
  });

  it('accepts exactly the fields the source proposed', async () => {
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /take all of the source/i }));

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['name'], 41));
  });

  it('says when accepting takes effect at the next sync instead of now', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'location', old: [1, 2], new: [3, 4], acceptable: false },
      ] }],
      limit: 25,
      offset: 0,
    });
    renderQueue();

    // The coordinate says it in its own words, because it is the one field that
    // sits across the line: the pin moves on the spot, the object's position
    // waits for the run. Told before the click, where the decision is made.
    expect(await screen.findByText(/the point moves back to the source’s coordinate now/))
      .toBeInTheDocument();
    expect(screen.getByText(/object’s own position follows at the next sync/)).toBeInTheDocument();
    // Still answerable: releasing the claim is what takes it off the queue,
    // and it is the only thing that does — editing only ever adds a claim
    expect(screen.getByRole('button', { name: /take all of the source/i })).toBeEnabled();
  });

  it('keeps the plain deferred note for a field with no pin to move', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'tags', old: ['a'], new: ['b'], acceptable: false },
      ] }],
      limit: 25,
      offset: 0,
    });
    renderQueue();

    expect(await screen.findByText(/lands at the next sync/)).toBeInTheDocument();
  });

  it('sends every conflicted field, not only the ones written on the spot', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'name', old: 'a', new: 'b', acceptable: true },
        { field: 'location', old: [1, 2], new: [3, 4], acceptable: false },
      ] }],
      limit: 25,
      offset: 0,
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /take all of the source/i }));

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['name', 'location'], 41));
  });

  it('can reach the items behind a full page, moving only that kind', async () => {
    mockedFetch.mockResolvedValue({
      missing: Array.from({ length: 2 }, (_, i) => ({ ...MISSING, id: i + 1 })),
      conflicts: [CONFLICT],
      limit: 2,
      paging: {
        missing: { offset: 0, hasMore: true },
        conflicts: { offset: 0, hasMore: false },
      },
    });
    renderQueue();

    // Without this the curator is told more exist and cannot see them until the ones in
    // front are answered. And the offset it moves is that kind's own: a shared one made
    // "show more" under one heading page every other section past its own first page.
    fireEvent.click(await screen.findByRole('button', { name: /show more/i }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith({ offsets: { missing: 2 } }));
  });

  it('offers no paging when one page holds everything', async () => {
    mockedFetch.mockResolvedValue({ missing: [MISSING], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    await screen.findByRole('button', { name: /former/i });
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('does not present a full page as the whole backlog', async () => {
    mockedFetch.mockResolvedValue({
      missing: Array.from({ length: 2 }, (_, i) => ({ ...MISSING, id: i + 1 })),
      conflicts: [],
      limit: 2,
      paging: { missing: { offset: 0, hasMore: true } },
    });
    renderQueue();

    expect(await screen.findByText(/Gone from the source \(first 2\)/)).toBeInTheDocument();
  });

  it('says a full page is the whole of it when nothing waits behind', async () => {
    // The old heading read "first N" off the page being full, so a kind that happened to
    // hold exactly one page always claimed a backlog it did not have. The server answers
    // this now, from the row it fetched past the page.
    mockedFetch.mockResolvedValue({
      missing: Array.from({ length: 2 }, (_, i) => ({ ...MISSING, id: i + 1 })),
      conflicts: [],
      limit: 2,
      paging: { missing: { offset: 0, hasMore: false } },
    });
    renderQueue();

    expect(await screen.findByText(/Gone from the source \(2\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('refreshes after a refusal, so the stale card cannot be clicked again', async () => {
    mockedState.mockRejectedValue(new Error('Already answered: this object is not waiting on that decision'));
    // The second read is what the server now says: someone else answered it
    mockedFetch
      .mockResolvedValueOnce({ missing: [MISSING], conflicts: [], limit: 25, offset: 0 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // The card goes, and the reason survives it — the message cannot live on
    // the card, because refetching is what takes the card away
    await waitFor(() => expect(screen.queryByRole('button', { name: /former/i })).toBeNull());
    expect(screen.getByText(/Already answered/)).toBeInTheDocument();
  });

  it('keeps the card and shows the reason while the queue still lists it', async () => {
    mockedState.mockRejectedValue(new Error('network down'));
    renderQueue();
    await openRow(/Dresden Elbe Valley/);

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /former/i })).toBeInTheDocument();
  });

  it('says what landed and which run it came from', async () => {
    mockedAccept.mockResolvedValue({
      experienceId: 88, applied: ['name'], released: ['location'], fromSyncLogId: 41,
    });
    mockedFetch
      .mockResolvedValueOnce({ missing: [], conflicts: [CONFLICT], limit: 25, offset: 0 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /take all of the source/i }));

    // The refetch removes the card, so this is the only place the split the
    // button promised, and the run the values came from, can be said at all.
    // In the same words the card used: the server answers `location`, the card
    // called it coordinates, and one click must not rename the thing it acted on.
    expect(await screen.findByText(/name applied now/)).toBeInTheDocument();
    expect(screen.getByText(/coordinates at the next sync/)).toBeInTheDocument();
    expect(screen.getByText(/from run 41/)).toBeInTheDocument();
  });

  it('says that accepting the picture dropped its credit', async () => {
    mockedAccept.mockResolvedValue({
      experienceId: 88,
      applied: ['imageUrl'],
      released: [],
      releasedPoints: [],
      movedPoints: [],
      releasedCredit: true,
      fromSyncLogId: 41,
    });
    mockedFetch
      .mockResolvedValueOnce({ missing: [], conflicts: [CONFLICT], limit: 25, offset: 0 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /take all of the source/i }));

    // The value deleted is the curator's own — the edit that claimed the picture
    // wrote the credit in the same statement — and the card said nothing about a
    // photographer, so without this line the name simply stops being there.
    expect(await screen.findByText(/picture credit dropped with it/)).toBeInTheDocument();
  });

  it('says that accepting the coordinate handed the pin back too', async () => {
    mockedAccept.mockResolvedValue({
      experienceId: 88,
      applied: [],
      released: ['location'],
      releasedPoints: [41],
      movedPoints: [41],
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Wikivoyage' }],
      fromSyncLogId: 41,
    });
    mockedFetch
      .mockResolvedValueOnce({ missing: [], conflicts: [CONFLICT], limit: 25, offset: 0 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /take all of the source/i }));

    // The card asked about the object and never mentioned a point, while the
    // answer moves the pin a curator placed by hand — and leaves its regions
    // behind when placement fails, which only an admin can fix.
    expect(await screen.findByText(/its point moved back to the source's coordinate/)).toBeInTheDocument();
    expect(screen.getByText(/Wikivoyage \(world view 4\)/)).toBeInTheDocument();
  });

  describe('a row this category refused', () => {
    beforeEach(() => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [REFUSED], conflicts: [], limit: 25, offset: 0,
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
        missing: [MISSING], refused: [], conflicts: [], limit: 25, offset: 0,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByText(/hidden already/i)).not.toBeInTheDocument();
    });

    it('can reach refusals behind a full page', async () => {
      const page = Array.from({ length: 25 }, (_, i) => ({ ...REFUSED, id: 200 + i }));
      mockedFetch.mockResolvedValue({
        missing: [], refused: page, conflicts: [], limit: 25,
        paging: { refused: { offset: 0, hasMore: true } },
      });
      renderQueue();

      await screen.findByRole('button', { name: /show more/i });
      expect(screen.getByRole('button', { name: /show more/i })).toBeEnabled();
    });
  });

  describe('a refusal the curator confirmed', () => {
    beforeEach(() => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [KEPT_OUT], conflicts: [], limit: 25, offset: 0,
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
        missing: [MISSING], refused: [], keptOut: [], conflicts: [], limit: 25, offset: 0,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /kept out/i })).not.toBeInTheDocument();
    });
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
        answeredWithdrawals: [ANSWERED], limit: 25, offset: 0,
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
        limit: 25, offset: 0,
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
        answeredWithdrawals: [], limit: 25, offset: 0,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /lost places you have answered/i }))
        .not.toBeInTheDocument();
    });

    it('leaves a way back when its own page comes back empty', async () => {
      // The block renders whole or not at all, and its pager renders inside it — so a
      // page answered down to nothing takes the only control that could go back with it.
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [],
        answeredWithdrawals: [], limit: 25, offset: 0,
        paging: { answeredWithdrawals: { offset: 25, hasMore: false } },
      });
      renderQueue();

      expect(await screen.findByRole(
        'button', { name: /lost places you have answered — previous/i })).toBeInTheDocument();
    });
  });

  describe('what a gated run is holding', () => {
    it('asks about one museum once, however many things are open about it', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [],
        held: [HELD], contents: [CONTENTS],
        limit: 25, offset: 0,
      });
      renderQueue();

      // The API answers this as two rows so each query stays simple. To a
      // curator a museum whose label is held and which gained twelve paintings
      // is one object and one decision — so one question in the queue, and one
      // card. (The name appears twice on the screen: once in the list, once on
      // the card it opens.)
      expect(await screen.findAllByRole('button', { name: /Museo del Prado/ })).toHaveLength(1);
      expect(screen.getByText(/1 new point/)).toBeInTheDocument();
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
            { id: 9, name: 'Venus de Milo', artist: 'Alexandros of Antioch', year: -100, imageUrl: null, iconic: true },
            { id: 10, name: 'Study of a head', artist: null, year: null, imageUrl: null, iconic: false },
          ],
        }],
        limit: 25, offset: 0,
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
        limit: 25, offset: 0,
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
        missing: [], refused: [], conflicts: [], contents: [CONTENTS], limit: 25, offset: 0,
      });
      renderQueue();

      // The one button already means exactly one thing here, and a second saying
      // "only" beside it would be a distinction without a difference.
      await screen.findByText(/12 new works/);
      expect(screen.queryByRole('button', { name: /Publish the change only/ })).not.toBeInTheDocument();
    });

    it('publishes through the one endpoint that can apply a held field', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], contents: [], limit: 25, offset: 0,
      });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // Not `accept-source`: its lookup requires `curatedConflict: true`, and a
      // field held by the category's gate carries false — that button would 409
      // on every click. The run id is the held pointer, so a newer proposal
      // cannot substitute itself for the one on the card.
      await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(7, { expectedSyncLogId: 47 }));
      expect(mockedAccept).not.toHaveBeenCalled();
    });

    it('names no run for an arrival, whose own run id points at nothing held', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25, offset: 0,
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
        missing: [], refused: [], conflicts: [], contents: [CONTENTS], limit: 25, offset: 0,
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
        missing: [], refused: [], conflicts: [], held: [HELD], contents: [CONTENTS], limit: 25, offset: 0,
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
        held: [HELD], contents: [], limit: 25, offset: 0,
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
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25, offset: 0,
      });
      renderQueue();

      await screen.findByRole('button', { name: /readers may see it/i });
      expect(screen.queryByText(/nothing waiting/i)).not.toBeInTheDocument();
    });

    it('can reach gated objects behind a full page', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [],
        contents: Array.from({ length: 2 }, (_, i) => ({ ...CONTENTS, id: 300 + i })),
        limit: 2,
        paging: { contents: { offset: 0, hasMore: true } },
      });
      renderQueue();

      // Each kind is its own query with its own LIMIT, so its second page exists on the
      // server whether or not any control asks for it.
      fireEvent.click(await screen.findByRole('button', { name: /show more/i }));

      // The three gated kinds share one control because the section groups them by
      // experience — but not one offset: only the kind that has more moves.
      await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith({ offsets: { contents: 2 } }));
    });

    it('says what the publication released, including the pin that went with it', async () => {
      mockedPublish.mockResolvedValue({
        ...PUBLISHED, locationsPublished: 2, treasureLinksPublished: 12, treasuresPublished: 12,
        withdrawalsReleased: 1,
      });
      mockedFetch
        .mockResolvedValueOnce({
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25, offset: 0,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25, offset: 0 });
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
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25, offset: 0,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25, offset: 0 });
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
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25, offset: 0,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25, offset: 0 });
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
          missing: [], refused: [], conflicts: [], held: [HELD], limit: 25, offset: 0,
        })
        .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25, offset: 0 });
      renderQueue();

      fireEvent.click(await screen.findByRole('button', { name: /publish the change/i }));

      // A different fact from a named world view refusing: nothing was placed at
      // all, and there is no world view to name.
      expect(await screen.findByText(/could not even be listed/)).toBeInTheDocument();
    });

    it('drops the object\'s own caches, not only this queue', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25, offset: 0,
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

    it('names the order that keeps a curator\'s own wording through a publish', async () => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25, offset: 0,
      });
      renderQueue();

      // Publishing re-reads the claims under its write lock and skips a field the
      // curator has claimed since the run. That makes "keep the paintings, refuse
      // the label" possible — but only if the card says which order to do it in.
      expect(await screen.findByText(/editing claims the field/i)).toBeInTheDocument();
    });

    it('shows what the server said when the card was drawn against an older run', async () => {
      mockedPublish.mockRejectedValue(
        new Error('This row is holding a proposal from a different run — reload to see it'));
      mockedFetch.mockResolvedValue({
        missing: [], refused: [], conflicts: [], held: [HELD], limit: 25, offset: 0,
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
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25, offset: 0,
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
        missing: [], refused: [], conflicts: [], arrivals: [ARRIVAL], limit: 25, offset: 0,
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
        held: [{ ...HELD, sync_log_id: undefined }], contents: [], limit: 25, offset: 0,
      });
      renderQueue();

      // `sync_log_id` is optional on the type; printing the literal word
      // "undefined" for a row that somehow lacks it is worse than naming no
      // run at all.
      expect(await screen.findByText(/Proposed by an earlier run/)).toBeInTheDocument();
      expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    });
  });

  it('says whether putting a row back also put it in front of readers, and what came with it', async () => {
    mockedAdmission.mockResolvedValue({
      experienceId: 99, admission: 'admitted', published: true,
      curationState: 'verified', appliedFields: [], claimedFieldsSkipped: [], fromSyncLogId: null,
      locationsPublished: 1, treasureLinksPublished: 12, treasuresPublished: 12, withdrawalsReleased: 0,
    });
    mockedFetch
      .mockResolvedValueOnce({ missing: [], refused: [REFUSED], conflicts: [], limit: 25, offset: 0 })
      .mockResolvedValue({ missing: [], refused: [], conflicts: [], limit: 25, offset: 0 });
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

  it('says plainly when there is nothing to answer', async () => {
    mockedFetch.mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it('reports a failed load instead of showing an empty queue', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'));
    renderQueue();

    expect(await screen.findByText(/could not load the review queue/i)).toBeInTheDocument();
  });
});
