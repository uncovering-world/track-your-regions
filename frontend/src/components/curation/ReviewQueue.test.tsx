/**
 * Tests for the review page's open questions answered on the spot: a missing object and a
 * conflict.
 *
 * The behaviour worth pinning here is what each question promises: three distinct answers
 * to a missing object (two of which change something and one of which does not), a conflict
 * view that shows both versions before asking anyone to choose — and, after every answer,
 * the line that says what it did, since the refetch takes the card away with it.
 *
 * The page's other cards have files of their own: whether a kind admits an object
 * (`ReviewQueue.admission.test.tsx`), the points and works a curator has already answered
 * (`ReviewQueue.parts.test.tsx`) and what a gated run is holding, one card per museum
 * (`ReviewQueue.held.test.tsx`). The page *around* the cards — the address it reads its
 * filters from, the cursor it pages by, the run it can set aside — is `ReviewPage.test.tsx`'s
 * claim. All of them answer from the same fixtures (`reviewQueueFixtures`), and the card
 * files stub the same calls (`reviewQueueCardMocks`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
}));

/**
 * The queue read, in two halves so that a case can say only what it is about: `mockedFetch`
 * is what a case sets and what the assertions read, and the module's own `fetchReviewQueue`
 * passes its answer through `shaped` (`reviewQueueFixtures`), which fills in the parts of
 * the response no card test is about — the `order` the page draws its rows from, the
 * filtered `total`, the `facets` and the cursor. Fifty fixtures each restating those four
 * fields is how they drift; a case that *is* about one of them states it, and `shaped`
 * keeps what it was given.
 */
const { mockedFetch } = vi.hoisted(() => ({ mockedFetch: vi.fn() }));

/**
 * The toolbar is drawn away for these cases, and it is the cost rather than the coupling
 * that decides it: nothing here asserts a chip, a count or the order toggle — that is
 * `ReviewToolbar.test.tsx`'s claim, and the page around the cards is `ReviewPage.test.tsx`'s
 * — while its four MUI menus and its debounced search box are re-rendered by every case
 * here and in the three sibling files. Rendered, the one file these four were split from
 * took 15.4 s of test time; without it, 7.4 s — and the flakes it took under load went with
 * the eight seconds.
 */
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

import { shaped, renderQueue, openRow, MISSING, CONFLICT } from './reviewQueueFixtures';
import { mockedState, mockedAccept, mockedDecline, resetCardMocks } from './reviewQueueCardMocks';

describe('ReviewQueue', () => {
  beforeEach(() => {
    resetCardMocks(mockedFetch);
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

    // Whole values, side by side in their own columns — not two ellipses from a
    // truncated summary. The words themselves are split across marked
    // and unmarked runs, so this asks the rendered text for them rather than one node.
    await screen.findByRole('columnheader', { name: 'Current' });
    expect(screen.getByRole('columnheader', { name: 'Proposed' })).toBeInTheDocument();
    const cells = screen.getAllByRole('cell').map(cell => cell.textContent ?? '');
    const yours = cells.find(text => text.includes('Curator wording'));
    expect(yours).toBeDefined();
    expect(cells.some(text => text.includes('Renamed upstream'))).toBe(true);
    // Each value stays in its own column: a comparison that put the source's text on
    // the curator's side would read as their own words being replaced by themselves.
    expect(yours).not.toContain('Renamed upstream');
  });

  it('says what a conflict over the catalogue’s own labels is, instead of "proposes nothing"', async () => {
    // A changeset an earlier run filed can carry a tags conflict, and the conflict query
    // surfaces it while the claim on tags stands (#570). No rows to table, and the two
    // live buttons must not sit under "proposes nothing".
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'tags', old: ['a'], new: ['b'], claim: { by: 'Dana', at: '2026-08-04T12:29:32Z' } },
      ] }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25,
    });
    renderQueue();

    expect(await screen.findByText(/proposes only the catalogue’s own labels, which nothing readers see, over an edit claimed by Dana/))
      .toBeInTheDocument();
    expect(screen.queryByText(/proposes nothing/)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use all proposed' })).toBeEnabled();
  });

  it('compares an added value against nothing, instead of calling it a shape difference', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'description', old: null, new: 'A description this row never had' },
      ] }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25,
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
        { field: 'name', old: 'Curator wording', new: 'Renamed upstream' },
        { field: 'description', old: 'Mine', new: 'Theirs' },
      ] }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25,
    });
    renderQueue();

    // A run improves and damages in the same breath: a better description arriving with
    // a mangled name was one button that took both or neither. The endpoint always
    // accepted a list — the screen could not say "this one".
    const takeThese = await screen.findAllByRole('button', { name: 'Use proposed' });
    fireEvent.click(takeThese[1]);

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['description'], 41));
  });

  it('lets a curator settle one field their own way', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{
        ...CONFLICT,
        sync_log_id: 41,
        proposed: [
          { field: 'name', old: 'Curator wording', new: 'Renamed upstream' },
          { field: 'description', old: 'Mine', new: 'Theirs' },
        ],
      }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25,
    });
    renderQueue();

    // Standing by your own value writes a refusal, or the same card comes back after
    // every run. The run id goes with it for the reason it goes
    // with an acceptance: refusing the wrong run silences a proposal nobody read.
    const keepThese = await screen.findAllByRole('button', { name: 'Keep current' });
    fireEvent.click(keepThese[1]);

    await waitFor(() => expect(mockedDecline).toHaveBeenCalledWith(88, ['description'], 41));
    expect(mockedAccept).not.toHaveBeenCalled();
  });

  it('offers the refusal on a field the source’s value cannot be written to', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{
        ...CONFLICT,
        sync_log_id: 41,
        proposed: [{ field: 'location', old: null, new: { lat: 1 } }],
      }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25,
    });
    renderQueue();

    // Refusing a coordinate writes nothing at all, so there is no field the
    // answer cannot reach.
    fireEvent.click(await screen.findByRole('button', { name: 'Keep current' }));

    await waitFor(() => expect(mockedDecline).toHaveBeenCalledWith(88, ['location'], 41));
  });

  it('says what a refusal settled, since the card leaves with it', async () => {
    mockedDecline.mockResolvedValue({ experienceId: 88, declined: ['description'], fromSyncLogId: 41 });
    mockedFetch
      .mockResolvedValueOnce({
        missing: [],
        conflicts: [{ ...CONFLICT, sync_log_id: 41, proposed: [{ field: 'description', old: 'Mine', new: 'Theirs' }] }],
        refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25,
      })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Keep current' }));

    // In the reader's words, and naming the run — so a curator meeting the field again
    // later is being told the source changed its mind, not that the click failed.
    expect(await screen.findByText(/description — kept as curated/)).toBeInTheDocument();
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
          claim: { by: 'Dana', at: '2026-08-04T12:29:32Z' },
          decidedBefore: [{ by: 'admin', at: '2026-07-30T08:00:00Z', applied: 'An earlier upstream name' }],
        }],
      }],
      refused: [], keptOut: [], arrivals: [], held: [], contents: [], limit: 25,
    });
    renderQueue();

    // The dead button said "Keep my edit (current)" over a claim someone else made, and
    // named the run only after acting. Now the trail says whose text stands, when the
    // source proposed otherwise, and what was answered here before.
    expect(await screen.findByText(/Claimed by Dana/)).toBeInTheDocument();
    // The run is named once, in the line above the table, rather than under every field.
    expect(screen.getByText(/The run that finished .* proposes/)).toBeInTheDocument();
    expect(screen.getByText(/admin took the source’s value/)).toBeInTheDocument();
    expect(screen.queryByText(/Keep my edit/)).not.toBeInTheDocument();
    // Nor in any newer spelling: the summary names whose edit the source proposes
    // over, and the per-field answer keeps "this" rather than "mine".
    expect(screen.getByText(/over an edit claimed by Dana/)).toBeInTheDocument();
    // Nowhere on the card: not the summary, not the column, not the per-field or the
    // whole-card answer, not the note under them.
    expect(screen.queryByText(/of yours|keep mine|all of mine|keeping yours/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'yours' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Current' })).toBeInTheDocument();
  });

  it('accepts exactly the fields the source proposed', async () => {
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Use all proposed' }));

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['name'], 41));
  });

  it('says what each answer does to a point: it moves now, or stays where it is', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      // Aqua Virgo (#2222): a curator moved it to Vicus Caprarius by the Trevi
      // Fountain, and the run proposes the springs near Salone, 12 km east.
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'location', old: { lat: 41.9004, lon: 12.4841 }, new: { lat: 41.9102, lon: 12.6269 } },
      ] }],
      limit: 25,
    });
    renderQueue();

    // The headings and the answers name each other, and nothing says "text" about a point.
    expect(await screen.findByRole('columnheader', { name: 'Proposed' })).toBeInTheDocument();
    expect(screen.getByText(/Use proposed moves the place on the map, now\. Keep current leaves the point where it is/))
      .toBeInTheDocument();
    expect(screen.queryByText(/next sync/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use all proposed' })).toBeEnabled();
  });

  it('says what each answer does to a text, and to the countries, in their own words', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'description', old: 'Mine', new: 'Theirs' },
        { field: 'countryCodes', old: ['FR'], new: ['BE'] },
      ] }],
      limit: 25,
    });
    renderQueue();

    expect(await screen.findByText(
      /Use proposed changes the text readers see and changes the countries it counts in, now\. Keep current changes nothing readers see/,
    )).toBeInTheDocument();
  });


  it('sends every conflicted field with one answer for the whole card', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'name', old: 'a', new: 'b' },
        { field: 'location', old: [1, 2], new: [3, 4] },
      ] }],
      limit: 25,
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Use all proposed' }));

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['name', 'location'], 41));
  });

  it('refreshes after a refusal, so the stale card cannot be clicked again', async () => {
    mockedState.mockRejectedValue(new Error('Already answered: this object is not waiting on that decision'));
    // The second read is what the server now says: someone else answered it
    mockedFetch
      .mockResolvedValueOnce({ missing: [MISSING], conflicts: [], limit: 25 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25 });
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
      experienceId: 88, applied: ['name', 'location'], released: [], fromSyncLogId: 41,
    });
    mockedFetch
      .mockResolvedValueOnce({ missing: [], conflicts: [CONFLICT], limit: 25 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Use all proposed' }));

    // The refetch removes the card, so this is the only place what landed, and
    // the run the values came from, can be said at all. In the same words the
    // card used: the server answers `location`, the card called it coordinates,
    // and one click must not rename the thing it acted on.
    expect(await screen.findByText(/name, coordinates applied now/)).toBeInTheDocument();
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
      .mockResolvedValueOnce({ missing: [], conflicts: [CONFLICT], limit: 25 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Use all proposed' }));

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
      .mockResolvedValueOnce({ missing: [], conflicts: [CONFLICT], limit: 25 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Use all proposed' }));

    // The card asked about the object and never mentioned a point, while the
    // answer moves the pin a curator placed by hand — and leaves its regions
    // behind when placement fails, which only an admin can fix.
    expect(await screen.findByText(/its point moved back to the source's coordinate/)).toBeInTheDocument();
    expect(screen.getByText(/Wikivoyage \(world view 4\)/)).toBeInTheDocument();
  });
});
