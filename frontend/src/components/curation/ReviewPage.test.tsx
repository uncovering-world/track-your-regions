/**
 * Tests for the review page itself: the list its address names, and how the page pages it.
 *
 * The cards are the `ReviewQueue*.test.tsx` files' claim — what a curator can answer, and
 * what they are told afterwards. What is pinned here is everything around them, which
 * ADR-0051 moved out of the page's own state: the filters go out with the query because
 * they are in the URL, the selected row comes back into the URL, one cursor pages the whole
 * union, and a run's batch can be put aside.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
}));

/**
 * The queue read, in two halves so that a case can say only what it is about: `mockedFetch`
 * is what a case sets and what the assertions read, and the module's own
 * `fetchReviewQueue` passes its answer through `shaped` (`reviewQueueFixtures`).
 */
const { mockedFetch } = vi.hoisted(() => ({ mockedFetch: vi.fn() }));

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
}));
vi.mock('../../api/experiences', () => ({
  fetchExperience: vi.fn(),
}));

import { setExperienceState } from '../../api/curation';
import { setRunAside, bringRunBack } from '../../api/reviewQueue';
import {
  shaped, renderQueue, openRow, at, navType, goBack, followLink,
  ASKED_AT, NO_FACETS, ARRIVAL, CONFLICT, MISSING, KEPT_OUT,
} from './reviewQueueFixtures';

const mockedState = setExperienceState as unknown as ReturnType<typeof vi.fn>;
const mockedSetAside = setRunAside as unknown as ReturnType<typeof vi.fn>;
const mockedBringBack = bringRunBack as unknown as ReturnType<typeof vi.fn>;

/** A catalogue with one run in it, which is what the run control needs to offer anything. */
const RUN_98_FACETS = {
  ...NO_FACETS,
  source: [{ id: 1, name: 'UNESCO World Heritage Sites', count: 1 }],
  run: [{
    id: 98, sourceId: 1, completedAt: ASKED_AT, count: 1255, setAside: false,
  }],
};

/**
 * A filter change through the toolbar's own control: the question chip, ticked.
 *
 * Not the order toggle: reordering keeps the selected row on purpose — the same questions
 * in the other direction — so it is not an example of a filter at all, and a case about
 * a *different list* has to name one.
 */
async function pickKind(label: RegExp) {
  fireEvent.click(screen.getByRole('button', {
    name: (accessible: string) => accessible.startsWith('Question'),
  }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: label }));
  // The menu stays open on a tick — it is a multi-select with no Apply — and while it is,
  // MUI marks the rest of the page `aria-hidden`, where every query below would find
  // nothing. Escape closes it, as it does for the curator.
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

describe('ReviewPage', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedState.mockReset().mockResolvedValue({ experienceId: 77 });
    mockedSetAside.mockReset().mockResolvedValue({ syncLogId: 98, setAside: true });
    mockedBringBack.mockReset().mockResolvedValue({ syncLogId: 98, setAside: false });
    mockedFetch.mockResolvedValue({ missing: [MISSING], conflicts: [CONFLICT], limit: 25 });
  });

  it('moves to the question that took the answered one’s place, not back to the top', async () => {
    // The property the whole list/bench split is for, and it was wired wrong while the
    // function underneath it passed its own tests: `selectedIndex` is recomputed from the
    // *current* rows, so the moment the answered row leaves it reads -1 — which means
    // "nothing was selected" and sends the selection to row one.
    const three = [77, 78, 79].map(id => ({ ...MISSING, id, name: `Site ${id}` }));
    mockedFetch
      .mockResolvedValueOnce({ missing: three, limit: 25 })
      .mockResolvedValue({ missing: [three[0], three[2]], limit: 25 });
    renderQueue();

    await openRow(/Site 78/);
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // Site 79 took index 1 when 78 left, so it is the question in front of the curator.
    expect(await screen.findByRole('heading', { name: /Site 79/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Site 77/ })).not.toBeInTheDocument();
    // And the address followed it, replaced rather than pushed: the page moved the
    // selection because the row went away, which is not something Back should undo.
    await waitFor(() => expect(at()).toBe('/review?row=missing:79'));
    expect(navType()).toBe('REPLACE');
  });

  it('keeps the row Back restored, even when Back changes the filter with it', async () => {
    // The one transition that moves the filter and the selection in a single commit.
    // Both effects fire in it, in declaration order: reset the remembered index, then
    // record the restored row's. The other way round the reset wins, the index reads 0,
    // and the next answer sends the curator to the top of the list instead of to the
    // neighbour of the question they just answered.
    const three = [77, 78, 79].map(id => ({ ...MISSING, id, name: `Site ${id}` }));
    let answered = false;
    mockedFetch.mockImplementation(() => Promise.resolve({
      missing: answered ? [three[0], three[1]] : three, limit: 25,
    }));
    mockedState.mockImplementation(() => {
      answered = true;
      return Promise.resolve({ experienceId: 79 });
    });
    renderQueue();

    await openRow(/Site 79/);
    await waitFor(() => expect(at()).toBe('/review?row=missing:79'));
    await pickKind(/Gone from the source/);
    await waitFor(() => expect(at()).toBe('/review?kind=missing&row=missing:77'));

    goBack();
    await waitFor(() => expect(at()).toBe('/review?row=missing:79'));
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // Site 79 was the last of three; with it answered the index clamps to Site 78 beside
    // it, never back to Site 77.
    expect(await screen.findByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    await waitFor(() => expect(at()).toBe('/review?row=missing:78'));
  });

  it('moves to the neighbour after an order change too, not back to the top', async () => {
    // The order toggle is the one filter change that keeps `row` — the same questions read
    // the other way round — so the curator's place has to survive it. It survives the
    // reset only if the tracker re-runs in that commit, and the index it would write is
    // often the very one it already holds: Site 79 is the third row in both orders. Watch
    // `selectedIndex` alone and the reset's 0 stands, and the answer sends the curator to
    // the top of the list instead of to the neighbour of the question they just answered.
    const three = [77, 78, 79].map(id => ({ ...MISSING, id, name: `Site ${id}` }));
    let answered = false;
    mockedFetch.mockImplementation(() => Promise.resolve({
      missing: answered ? [three[0], three[1]] : three, limit: 25,
    }));
    mockedState.mockImplementation(() => {
      answered = true;
      return Promise.resolve({ experienceId: 79 });
    });
    renderQueue();

    await openRow(/Site 79/);
    await waitFor(() => expect(at()).toBe('/review?row=missing:79'));

    fireEvent.click(screen.getByRole('button', { name: 'By question' }));
    await waitFor(() => expect(at()).toBe('/review?sort=question&row=missing:79'));

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    expect(await screen.findByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    await waitFor(() => expect(at()).toBe('/review?sort=question&row=missing:78'));
  });

  it('asks the queue for the list its address names', async () => {
    mockedFetch.mockResolvedValue({ arrivals: [ARRIVAL], limit: 25 });
    renderQueue('/review?run=93&kind=arrival');

    // The filters are not state this page holds: they are read off the URL and go
    // straight out with the query, which is what makes a filtered feed a link
    // (ADR-0051 decision 5).
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 93, kinds: ['arrival'] })));
  });

  it('puts the question a curator opened into the address', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);

    // Pushed, because opening a question is something the curator did: Back takes them
    // to the one they were reading before it.
    await waitFor(() => expect(at()).toBe('/review?row=missing:77'));
    expect(navType()).toBe('PUSH');
  });

  it('does not re-read the list when a curator opens a question in it', async () => {
    renderQueue();
    await screen.findByRole('columnheader', { name: 'Current' });
    const reads = mockedFetch.mock.calls.length;

    await openRow(/Dresden Elbe Valley/);

    // `row` names a card, not a filter, so it is out of the query key. A refetch per
    // click would put a spinner between a curator and every question they open.
    await screen.findByRole('button', { name: /former/i });
    expect(mockedFetch.mock.calls.length).toBe(reads);
  });

  it('pushes a filter the toolbar reports, and lets the page pick the row again', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);
    await waitFor(() => expect(at()).toBe('/review?row=missing:77'));

    await pickKind(/The source disagrees with an edit/);

    // The filter goes into the address as the curator's own act, and the row goes with
    // it: the question they had open was chosen out of a list that no longer exists, so
    // the page opens the new one at its first question instead.
    await waitFor(() => expect(at()).toBe('/review?kind=conflict&row=conflicts:88'));
    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: ['conflict'] })));
  });

  it('keeps the open question when only the order changes', async () => {
    renderQueue();
    await openRow(/Dresden Elbe Valley/);
    await waitFor(() => expect(at()).toBe('/review?row=missing:77'));

    fireEvent.click(screen.getByRole('button', { name: 'By question' }));

    // The other order is the same questions read the other way round, so the one the
    // curator is deciding on is still in the list: dropping it would take them off the
    // card they were reading to look at whatever now sorts first. The order itself is
    // still the curator's own act, so it is pushed and Back undoes it.
    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'question' })));
    expect(at()).toBe('/review?sort=question&row=missing:77');
    expect(navType()).toBe('PUSH');

    goBack();
    await waitFor(() => expect(at()).toBe('/review?row=missing:77'));
  });

  it('leaves the row alone when a search settles to the list already open', async () => {
    // The box reports what was typed — a trailing space included — while the address only
    // ever holds the normalised form. Asking "did the patch carry `q`" would clear the row
    // on a keystroke that names the very same list; asking whether the built address moves
    // does not. Without the fix this pushes a dead entry (the row dropped) and then writes
    // the same row straight back with `replace`.
    renderQueue('/review?q=cologne&row=missing:77');
    await waitFor(() => expect(at()).toBe('/review?q=cologne&row=missing:77'));
    const navBefore = navType();

    vi.useFakeTimers();
    try {
      const box = screen.getByLabelText('Find an object by name') as HTMLInputElement;
      fireEvent.change(box, { target: { value: 'cologne ' } });
      act(() => { vi.advanceTimersByTime(300); });
    } finally {
      vi.useRealTimers();
    }

    // Nothing moved: same address, and no navigation at all — not even the push-then-replace
    // pair that would still land here.
    expect(at()).toBe('/review?q=cologne&row=missing:77');
    expect(navType()).toBe(navBefore);
    expect(mockedFetch.mock.calls.length).toBe(1);
  });

  it('keeps the row when the set-aside toggle changes, though not the remembered index', async () => {
    // `aside=show` only adds rows to the list — it never narrows it — so the question the
    // curator has open is still on it, unlike a real filter. `filterKey` still moves on this
    // path (it is the whole address bar the query is keyed on), so the remembered scroll
    // index resets, but that is invisible next to the row itself surviving.
    mockedFetch.mockResolvedValue({
      missing: [MISSING],
      conflicts: [CONFLICT],
      limit: 25,
      facets: { ...NO_FACETS, setAside: { batches: 1 } },
    });
    renderQueue('/review?row=missing:77');
    await waitFor(() => expect(at()).toBe('/review?row=missing:77'));

    fireEvent.click(await screen.findByRole('button', { name: /1 batch set aside/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show the set-aside rows in the list' }));

    await waitFor(() => expect(at()).toBe('/review?aside=show&row=missing:77'));
  });

  it('keeps the previous answer on screen while a filter’s first page loads', async () => {
    // Without `keepPreviousData` the read empties on every key change, so the toolbar
    // prints "0 open" and the chips say they have nothing — an answer, where the truth is
    // a wait. On a debounced search that is once per settled word.
    let answerSecond: ((value: unknown) => void) | undefined;
    mockedFetch
      .mockResolvedValueOnce({ missing: [MISSING], limit: 25, total: 1621 })
      .mockReturnValue(new Promise(resolve => { answerSecond = resolve; }));
    renderQueue();
    expect(await screen.findByText('1,621 open')).toBeInTheDocument();

    await pickKind(/Gone from the source/);

    // The second read has not answered yet, and the count is still the one it replaces —
    // never 0, and never a spinner where a list was.
    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: ['missing'] })));
    expect(screen.getByText('1,621 open')).toBeInTheDocument();
    expect(screen.queryByText('0 open')).toBeNull();
    expect(screen.getByRole('button', { name: /Dresden Elbe Valley/ })).toBeInTheDocument();
    // And nothing was selected out of the kept rows: they answer the address the curator
    // has just left, so a `row` written from them would name a question the new list may
    // not hold.
    expect(at()).toBe('/review?kind=missing');

    answerSecond?.({ missing: [MISSING], limit: 25, total: 1621 });
    await waitFor(() => expect(at()).toBe('/review?kind=missing&row=missing:77'));
  });

  it('refuses a click on a stale row until the new filter’s page answers', async () => {
    // The rows kept on screen through `keepPreviousData` still answer the *previous*
    // filter for the whole window `queue.stale` names — a click landing in it is a click
    // on a row the new filter may not even contain. Writing it would push a history entry
    // the page then has to correct the moment the real page answers.
    let answerSecond: ((value: unknown) => void) | undefined;
    mockedFetch
      .mockResolvedValueOnce({ missing: [MISSING], limit: 25, total: 1621 })
      .mockReturnValue(new Promise(resolve => { answerSecond = resolve; }));
    renderQueue();
    expect(await screen.findByText('1,621 open')).toBeInTheDocument();

    await pickKind(/Gone from the source/);
    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: ['missing'] })));
    expect(at()).toBe('/review?kind=missing');

    // The list still shows the previous filter's row while the new one is pending.
    fireEvent.click(screen.getByRole('button', { name: /Dresden Elbe Valley/ }));
    expect(at()).toBe('/review?kind=missing');

    // Once the real page answers, the page picks its own first row, with `replace` — as
    // it does for any load, never the stale click.
    answerSecond?.({ missing: [MISSING], limit: 25, total: 1621 });
    await waitFor(() => expect(at()).toBe('/review?kind=missing&row=missing:77'));
    expect(navType()).toBe('REPLACE');
  });

  it('sets a run’s batch aside and reads the queue again', async () => {
    mockedFetch.mockResolvedValue({ missing: [MISSING], limit: 25, facets: RUN_98_FACETS });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /^Run/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set aside run 98' }));

    // The batch is the unit — "UNESCO, 5 Sep, 1 255 open" is one decision not yet taken
    // (ADR-0051 decision 4) — and the list has to come back without it.
    await waitFor(() => expect(mockedSetAside).toHaveBeenCalledWith(98));
    await waitFor(() => expect(mockedFetch.mock.calls.length).toBeGreaterThan(1));
  });

  it('brings a set-aside batch back and reads the queue again', async () => {
    mockedFetch.mockResolvedValue({
      missing: [MISSING],
      limit: 25,
      facets: {
        ...RUN_98_FACETS,
        run: [{ ...RUN_98_FACETS.run[0], setAside: true }],
        setAside: { batches: 1 },
      },
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /^Run/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bring back run 98' }));

    // The way back matters more than the way in: a batch nobody can un-hide is a batch
    // of questions quietly dropped from the queue.
    await waitFor(() => expect(mockedBringBack).toHaveBeenCalledWith(98));
    await waitFor(() => expect(mockedFetch.mock.calls.length).toBeGreaterThan(1));
    expect(mockedSetAside).not.toHaveBeenCalled();
  });

  it('says why a batch could not be set aside, rather than doing nothing visible', async () => {
    mockedSetAside.mockRejectedValue(new Error('that run is not yours to hide'));
    mockedFetch.mockResolvedValue({ missing: [MISSING], limit: 25, facets: RUN_98_FACETS });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /^Run/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set aside run 98' }));

    expect(await screen.findByText(/Could not set run 98 aside: that run is not yours to hide/))
      .toBeInTheDocument();
  });

  it('asks for the next page at the cursor the last one ended at, and appends it', async () => {
    // One cursor over the whole union, not seven offsets (ADR-0051 decision 2): answering
    // a row shifts every later one, which is exactly what an offset cannot survive.
    mockedFetch
      .mockResolvedValueOnce({
        missing: [MISSING], limit: 1, total: 2, paging: { nextCursor: '2026-09-05T10:00:00Z|4|77' },
      })
      .mockResolvedValue({ missing: [{ ...MISSING, id: 78, name: 'Site 78' }], limit: 1, total: 2 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: '2026-09-05T10:00:00Z|4|77' })));
    // Appended, not replaced: the page a curator has already read stays under them.
    expect(await screen.findByRole('button', { name: /Site 78/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dresden Elbe Valley/ })).toBeInTheDocument();
  });

  it('pages an answered block without dropping the questions loaded under Show more (#840)', async () => {
    // The answered lists are read on their own once one is paged, so the questions'
    // pages stay as loaded; at their first pages they come with the questions' first page.
    const WALLACE = { ...KEPT_OUT, id: 6222, external_id: 'Q1327919', name: 'Wallace Collection' };
    mockedFetch.mockImplementation(async (params: { cursor?: string; keptOutOffset?: number }) => {
      if (params.keptOutOffset) {
        return { keptOut: [WALLACE], limit: 1, paging: { keptOut: { offset: 1, hasMore: false } } };
      }
      if (params.cursor) return { missing: [{ ...MISSING, id: 78, name: 'Site 78' }], limit: 1, total: 2 };
      return {
        missing: [MISSING], keptOut: [KEPT_OUT], limit: 1, total: 2,
        paging: { nextCursor: '2026-09-05T10:00:00Z|4|77', keptOut: { offset: 0, hasMore: true } },
      };
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('button', { name: /Site 78/ })).toBeInTheDocument();
    const questionReads = mockedFetch.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /show what you have kept out/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByText(/Wallace Collection/)).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenLastCalledWith(expect.objectContaining({ keptOutOffset: 1 }));
    expect(mockedFetch.mock.calls.length).toBe(questionReads + 1);
    // Both pages of questions are still there.
    expect(screen.getByRole('button', { name: /Site 78/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dresden Elbe Valley/ })).toBeInTheDocument();
  });

  it("says a paged answered block's page failed inside the block, and keeps the rest of the page", async () => {
    mockedFetch.mockImplementation(async (params: { keptOutOffset?: number }) => {
      if (params.keptOutOffset) throw new Error('timeout');
      return {
        missing: [MISSING], keptOut: [KEPT_OUT], limit: 1, total: 1,
        paging: { keptOut: { offset: 0, hasMore: true } },
      };
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByText(/Could not load this page of the list/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Dresden Elbe Valley/ })).toBeInTheDocument();
    expect(screen.queryByText(/Could not load the review queue/)).toBeNull();
  });

  it('says which filters do not narrow an answered block, and only when one is set', async () => {
    mockedFetch.mockResolvedValue({ missing: [MISSING], keptOut: [KEPT_OUT], limit: 25 });
    renderQueue('/review?region=6737&run=98');

    fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));
    expect(screen.getByText(
      'Not narrowed by the region and the run you chose — only the search and the source reach this block.',
    )).toBeInTheDocument();
  });

  it('adds no such line under the search alone, which does narrow the block', async () => {
    mockedFetch.mockResolvedValue({ missing: [MISSING], keptOut: [KEPT_OUT], limit: 25 });
    renderQueue('/review?q=british');

    fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));
    expect(screen.queryByText(/Not narrowed by/)).toBeNull();
  });

  it("asks for a linked row's page on the first read, in the server's words, and pages on by cursor (#843)", async () => {
    mockedFetch
      .mockResolvedValueOnce({
        missing: [MISSING], limit: 1, total: 2, paging: { nextCursor: '2026-09-05T10:00:00Z|4|77' },
      })
      .mockResolvedValue({ missing: [{ ...MISSING, id: 78, name: 'Site 78' }], limit: 1, total: 2 });
    renderQueue('/review?row=missing:77');

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'missing:77' })));
    expect(await screen.findByRole('button', { name: /Dresden Elbe Valley/ })).toBeInTheDocument();
    expect(at()).toBe('/review?row=missing:77');

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: '2026-09-05T10:00:00Z|4|77', anchor: undefined })));
  });

  it('stays where a link opened once its row is answered, and moves to the next question (#843)', async () => {
    // Linked to Site 78 deep in a batch: the page opened one key before it, at Site 77,
    // and said so. Answering 78 takes it out of the list, so the list is read again from
    // 77 — read again at 78, it would open at the batch's top, far from Site 79.
    const three = [77, 78, 79].map(id => ({ ...MISSING, id, name: `Site ${id}` }));
    mockedFetch
      .mockResolvedValueOnce({ missing: three, limit: 25, paging: { from: 'KEY-77' } })
      .mockResolvedValue({ missing: [three[0], three[2]], limit: 25, paging: { from: 'KEY-77' } });
    renderQueue('/review?row=missing:78');

    expect(await screen.findByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    expect(await screen.findByRole('heading', { name: /Site 79/ })).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ from: 'KEY-77', anchor: undefined }));
    // Read from 77's key, the list cannot say 78 was answered rather than moved away, so
    // the server is asked at 78 once (#1779), and its answer, gone, moves the page on.
    expect(mockedFetch).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: 'missing:78' }));
    await waitFor(() => expect(at()).toBe('/review?row=missing:79'));
  });

  it('keeps a card whose answer moved its row past the loaded pages, and reads the list at it (#1779)', async () => {
    // The Hermitage's shape: a row dated by its newest question, which the answer took, so
    // the re-read sorts it under an older day, past the rows loaded. Site 78 is that row.
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78), site(79)], limit: 25 })
      .mockResolvedValueOnce({ missing: [site(77), site(79)], limit: 25, paging: { nextCursor: 'C-2' } })
      .mockResolvedValueOnce({ missing: [site(78), site(80)], limit: 25, paging: { from: 'KEY-78' } })
      .mockResolvedValue({ missing: [site(78), site(80)], limit: 25, paging: { from: 'KEY-78' } });
    renderQueue();

    await openRow(/Site 78/);
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // The server still holds it: the list is read again at the row, and the card stays.
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'missing:78' })));
    expect(await screen.findByRole('button', { name: /Site 80/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Site 79/ })).toBeNull();
    expect(at()).toBe('/review?row=missing:78');
  });

  it('moves on once the anchored read says the row was answered (#1779)', async () => {
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78), site(79)], limit: 25 })
      .mockResolvedValue({ missing: [site(77), site(79)], limit: 25 });
    renderQueue();

    await openRow(/Site 78/);
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    expect(await screen.findByRole('heading', { name: /Site 79/ })).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'missing:78' }));
    await waitFor(() => expect(at()).toBe('/review?row=missing:79'));
  });

  it('keeps the card on the bench while the server is asked, rather than closing it (#1779)', async () => {
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    let answerProbe: (value: unknown) => void = () => {};
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78), site(79)], limit: 25 })
      .mockResolvedValueOnce({ missing: [site(77), site(79)], limit: 25 })
      .mockImplementationOnce(() => new Promise(resolve => { answerProbe = resolve; }))
      .mockResolvedValue({ missing: [site(78), site(80)], limit: 25, paging: { from: 'KEY-78' } });
    renderQueue();

    await openRow(/Site 78/);
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'missing:78' })));

    // The probe is out: the row is not in the list, and the card is still in front of the curator.
    expect(screen.getByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    expect(screen.queryByText('Pick a question on the left.')).toBeNull();
    await act(async () => { answerProbe({ missing: [site(78), site(80)], limit: 25, paging: { from: 'KEY-78' } }); });
    expect(await screen.findByRole('button', { name: /Site 80/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
  });

  it('keeps the card in a list a link opened, whose re-read starts at an older key (#1779)', async () => {
    // A linked list re-reads from the key it began at, and the answer re-dated Site 78 out
    // of that window: its absence there says nothing, so the server is asked at 78.
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78), site(79)], limit: 25, paging: { from: 'KEY-77' } })
      .mockResolvedValueOnce({ missing: [site(77), site(79)], limit: 25, paging: { from: 'KEY-77' } })
      .mockResolvedValue({ missing: [site(78), site(80)], limit: 25, paging: { from: 'KEY-78' } });
    renderQueue('/review?row=missing:78');

    expect(await screen.findByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    expect(await screen.findByRole('button', { name: /Site 80/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    expect(at()).toBe('/review?row=missing:78');
  });

  it('drops a late answer about a row the curator has left (#1779)', async () => {
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    let answerProbe: (value: unknown) => void = () => {};
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78), site(79)], limit: 25 })
      .mockResolvedValueOnce({ missing: [site(77), site(79)], limit: 25 })
      .mockImplementationOnce(() => new Promise(resolve => { answerProbe = resolve; }))
      .mockResolvedValue({ missing: [site(77), site(79)], limit: 25 });
    renderQueue();

    await openRow(/Site 78/);
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'missing:78' })));
    await openRow(/Site 79/);
    const calls = mockedFetch.mock.calls.length;

    await act(async () => { answerProbe({ missing: [site(78)], limit: 25 }); });
    expect(mockedFetch.mock.calls.length).toBe(calls);
    expect(at()).toBe('/review?row=missing:79');

  });

  it('reads the questions above once every one from where a link opened is answered (#843)', async () => {
    // The link opened at Site 77; once 77 and 78 are answered the page read from 77's key
    // holds nothing, while three questions above it are still waiting.
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78)], limit: 25, total: 5, paging: { from: 'KEY-77' } })
      .mockResolvedValueOnce({ missing: [], limit: 25, total: 3, paging: {} })
      .mockResolvedValue({ missing: [site(1), site(2), site(3)], limit: 25, total: 3 });
    renderQueue('/review?row=missing:78');

    expect(await screen.findByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    expect(await screen.findByRole('button', { name: /Site 1\b/ })).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenLastCalledWith(expect.not.objectContaining({ from: expect.anything() }));
    expect(screen.queryByText(/Nothing waiting/)).toBeNull();
  });

  it('offers the questions above a list a link opened past its top, and reads them (#843)', async () => {
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78)], limit: 25, total: 5, paging: { from: 'KEY-77' } })
      .mockResolvedValue({ missing: [1, 2, 3, 77, 78].map(site), limit: 25, total: 5 });
    renderQueue('/review?row=missing:78');

    fireEvent.click(await screen.findByRole('button', { name: 'Show the questions above' }));

    expect(await screen.findByRole('button', { name: /Site 1\b/ })).toBeInTheDocument();
    const last = mockedFetch.mock.calls.at(-1)![0];
    expect([last.anchor, last.from]).toEqual([undefined, undefined]);
    expect(screen.queryByRole('button', { name: 'Show the questions above' })).toBeNull();
  });

  it('asks again about a row the curator comes back to after a dropped answer (#1779)', async () => {
    // A list a link opened at Site 78: its answer re-reads from 77's key without it, the
    // curator moves to 79 before the probe answers, then goes Back. The list is already
    // opened at 78, so nothing re-reads it; only a forgotten probe lets the server be asked.
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    let answerProbe: (value: unknown) => void = () => {};
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78), site(79)], limit: 25, paging: { from: 'KEY-77' } })
      .mockResolvedValueOnce({ missing: [site(77), site(79)], limit: 25, paging: { from: 'KEY-77' } })
      .mockImplementationOnce(() => new Promise(resolve => { answerProbe = resolve; }))
      .mockResolvedValue({ missing: [site(77), site(79)], limit: 25, paging: { from: 'KEY-77' } });
    renderQueue('/review?row=missing:78');

    expect(await screen.findByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'missing:78' })));
    await openRow(/Site 79/);
    await act(async () => { answerProbe({ missing: [site(78)], limit: 25 }); });

    goBack();
    await waitFor(() => expect(
      mockedFetch.mock.calls.filter(([params]) => params.anchor === 'missing:78' && params.from === undefined),
    ).toHaveLength(3));
    // The second probe says it was answered, so the page moves on rather than hanging.
    await waitFor(() => expect(at()).toBe('/review?row=missing:79'));
  });

  it('reads the questions above even when the top read leaves out the linked row (#1779)', async () => {
    // Show the questions above is the curator asking for the top: the row they had open is
    // not looked for again, so the list does not jump back to it.
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78)], limit: 25, total: 30, paging: { from: 'KEY-77' } })
      .mockResolvedValue({ missing: [1, 2, 3].map(site), limit: 3, total: 30, paging: { nextCursor: 'C-3' } });
    renderQueue('/review?row=missing:78');

    fireEvent.click(await screen.findByRole('button', { name: 'Show the questions above' }));

    expect(await screen.findByRole('heading', { name: /Site 1\b/ })).toBeInTheDocument();
    await waitFor(() => expect(at()).toBe('/review?row=missing:1'));
    const anchored = mockedFetch.mock.calls.filter(([params]) => params.anchor === 'missing:78');
    expect(anchored).toHaveLength(1);
  });

  it('asks about a row again once Show more brings it back after a top read (#1779)', async () => {
    // The top read marked Site 78 as not to be looked for; reached again and answered in a
    // way that moves it, it is asked about like any other row.
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(77), site(78)], limit: 25, total: 30, paging: { from: 'KEY-77' } })
      .mockResolvedValueOnce({ missing: [site(1), site(2)], limit: 2, total: 30, paging: { nextCursor: 'C-2' } })
      .mockResolvedValueOnce({ missing: [site(78)], limit: 2, total: 30 })
      .mockResolvedValue({ missing: [site(1), site(2)], limit: 2, total: 29 });
    renderQueue('/review?row=missing:78');

    fireEvent.click(await screen.findByRole('button', { name: 'Show the questions above' }));
    await waitFor(() => expect(at()).toBe('/review?row=missing:1'));
    fireEvent.click(await screen.findByRole('button', { name: /show more/i }));
    await openRow(/Site 78/);
    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    await waitFor(() => expect(
      mockedFetch.mock.calls.filter(([params]) => params.anchor === 'missing:78' && params.from === undefined),
    ).toHaveLength(2));
  });

  it('opens at a linked row the open list does not hold, rather than replacing it (#843)', async () => {
    const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
    mockedFetch
      .mockResolvedValueOnce({ missing: [site(1), site(2)], limit: 2, total: 9, paging: { nextCursor: 'C-2' } })
      .mockResolvedValue({ missing: [site(89), site(90)], limit: 2, total: 9, paging: { from: 'KEY-89' } });
    renderQueue('/review');
    expect(await screen.findByRole('button', { name: /Site 1\b/ })).toBeInTheDocument();

    followLink('/review?row=missing:90');

    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: 'missing:90' })));
    expect(await screen.findByRole('heading', { name: /Site 90/ })).toBeInTheDocument();
    expect(at()).toBe('/review?row=missing:90');
  });

  it("names a conflict row by the server's word for its kind", async () => {
    mockedFetch.mockResolvedValue({ conflicts: [CONFLICT], limit: 25 });
    renderQueue(`/review?row=conflicts:${CONFLICT.id}`);

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ anchor: `conflict:${CONFLICT.id}` })));
  });

  it('offers no paging when one page holds everything', async () => {
    mockedFetch.mockResolvedValue({ missing: [MISSING], limit: 25 });
    renderQueue();

    await screen.findByRole('button', { name: /former/i });
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('does not present a full page as the whole backlog', async () => {
    // The heading counts what is loaded under it, so the list itself has to say what that
    // is a page *of* — the server's own count under the filter, never `rows.length`.
    mockedFetch.mockResolvedValue({
      missing: Array.from({ length: 2 }, (_, i) => ({ ...MISSING, id: i + 1 })),
      limit: 2,
      total: 1630,
      paging: { nextCursor: 'more' },
    });
    renderQueue();

    expect(await screen.findByLabelText('2 of 1,630 questions loaded')).toBeInTheDocument();
  });

  it('says a filter matched nothing rather than that nothing is waiting', async () => {
    mockedFetch.mockResolvedValue({ limit: 25 });
    renderQueue('/review?q=colo&kind=refused');

    // The two are different facts, and telling a curator every flagged object has been
    // answered while a search is narrowing the list to none of them is simply false.
    expect(await screen.findByText(/Nothing matches\. Clear a filter or the search\./))
      .toBeInTheDocument();
    expect(screen.queryByText(/nothing waiting/i)).not.toBeInTheDocument();
    // And the toolbar stays, because *Clear all* is the way back out of it.
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('says plainly when there is nothing to answer', async () => {
    mockedFetch.mockResolvedValue({ limit: 25 });
    renderQueue();

    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it('reports a failed load instead of showing an empty queue', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'));
    renderQueue();

    expect(await screen.findByText(/could not load the review queue/i)).toBeInTheDocument();
  });
});
