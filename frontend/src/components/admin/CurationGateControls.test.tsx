/**
 * Tests for the sync panel's gate controls.
 *
 * The copy is the feature here, so the copy is what these pin. Three sentences
 * carry decisions a reader of the code cannot infer from the props: turning the
 * gate on does not hide what is already published; the number on the button
 * excludes held changes; and the dialog says outright that a held change will not
 * be published, because that is the one thing a curator would otherwise assume
 * "publish all waiting" meant.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurationGateControls } from './CurationGateControls';
import { publishWaiting, setCurationGate } from '../../api/admin';
import type { ExperienceCategory } from '../../api/admin';

vi.mock('../../api/admin', async () => ({
  setCurationGate: vi.fn(),
  publishWaiting: vi.fn(),
}));

function source(overrides: Partial<ExperienceCategory> = {}): ExperienceCategory {
  return {
    id: 2,
    name: 'Top Art Museums',
    description: 'Museums selected by what they hold',
    is_active: true,
    requires_curation: false,
    last_sync_at: null,
    last_sync_status: null,
    display_priority: 2,
    created_at: '2026-01-01T00:00:00Z',
    waiting: { arrivals: 0, held: 0, contents: 0 },
    ...overrides,
  };
}

const mockedPublishWaiting = publishWaiting as unknown as ReturnType<typeof vi.fn>;
const mockedSetCurationGate = setCurationGate as unknown as ReturnType<typeof vi.fn>;

function renderControls(s: ExperienceCategory) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurationGateControls source={s} />
    </QueryClientProvider>,
  );
}

describe('CurationGateControls', () => {
  // Reset between cases, because `vi.fn()` accumulates calls across a file: without this
  // `toHaveBeenCalledWith(2, false)` in the second case below is satisfied by the *first*
  // case's call, so a switch that always sent the same value passed both. Found by
  // mutation rather than by reading — the pair looked like two directions and was one.
  beforeEach(() => {
    mockedSetCurationGate.mockReset();
    mockedPublishWaiting.mockReset();
  });

  it('asks the server to hold this source, and only this source', async () => {
    mockedSetCurationGate.mockResolvedValue({ categoryId: 2, name: 'Top Art Museums', requiresCuration: true });
    renderControls(source({ requires_curation: false }));

    fireEvent.click(screen.getByRole('checkbox'));

    // The one write on this control, and the PR's headline mechanism: everything else in
    // this file reads `source`, so a flip in the wrong direction or against another id
    // renders identically and passes every other case here.
    await waitFor(() => expect(mockedSetCurationGate).toHaveBeenCalledWith(2, true));
  });

  it('asks the server to stop holding it when the switch is already on', async () => {
    mockedSetCurationGate.mockResolvedValue({ categoryId: 2, name: 'Top Art Museums', requiresCuration: false });
    renderControls(source({ requires_curation: true }));

    fireEvent.click(screen.getByRole('checkbox'));

    // Both directions, because `mutate(!e.target.checked)` is the mistake that passes a
    // one-direction test: it would send `false` here and `true` above.
    await waitFor(() => expect(mockedSetCurationGate).toHaveBeenCalledWith(2, false));
  });

  it('refetches the sources after a flip, since every sentence here reads the flag', async () => {
    mockedSetCurationGate.mockResolvedValue({ categoryId: 2, name: 'Top Art Museums', requiresCuration: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <CurationGateControls source={source({ requires_curation: false })} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    // Without this the switch answers, the server agrees, and the panel keeps rendering
    // the old position with the old consequence — the copy is read from the query, not
    // from the mutation's reply.
    await waitFor(() => {
      const keys = invalidate.mock.calls.map(c => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
      expect(keys).toContain('["admin","sources"]');
    });
    invalidate.mockRestore();
  });

  it('says the switch did not move when the server refuses it', async () => {
    mockedSetCurationGate.mockRejectedValue(new Error('gateway timeout'));
    renderControls(source({ requires_curation: false }));

    fireEvent.click(screen.getByRole('checkbox'));

    // MUI's switch renders the position it was given, so a failed flip leaves the toggle
    // where the reader last saw it and nothing else says the request died. "Reload to see
    // where it stands" rather than a claim about which way it ended up.
    const alert = await screen.findByText(/The switch did not change/);
    expect(alert.textContent).toContain('Reload to see where it stands');
  });

  it('warns before the flip, not after, when the source is holding a change', () => {
    renderControls(source({ requires_curation: true, waiting: { arrivals: 0, held: 2, contents: 0 } }));

    // A warning that appears only after the switch is off is a report. The point of
    // this sentence is the decision: switching off does not hand the held changes to a
    // curator, it hands them to the next run, which writes them with nobody looking.
    const copy = screen.getByText(/Switching it off would not hand the 2 changes/);
    expect(copy.textContent).toContain('would apply them instead');
  });

  it('says the panel could not count, and offers no release, when the server could not', () => {
    renderControls(source({ requires_curation: true, waiting: null }));

    // The sources list arrives intact and the counts do not: this endpoint's addition
    // must not be able to take the screen with it. "Nothing waiting." here would be the
    // answer a curator acts on by leaving a gated source alone, and the release button
    // would offer to publish a backlog it cannot name.
    expect(screen.getByText('How much this source is holding could not be counted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish all waiting/ })).not.toBeInTheDocument();
    // Still says what the switch does — that part needs no count.
    expect(screen.getByText(/What was published before the switch stays visible/)).toBeInTheDocument();
    // No count is asserted — neither branch's counted wording appears…
    expect(screen.queryByText(/would stay waiting: switching/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Switching it off would not hand/)).not.toBeInTheDocument();
    // …and it is not silent either: the class of consequence a flip back cannot undo is
    // the one thing an admin must know exists before deciding, whether or not anyone
    // could count it.
    const copy = screen.getByText(/could not be counted, so how much is not said here/);
    expect(copy.textContent).toContain('would stay waiting for a person');
    expect(copy.textContent).toContain('would be applied by the next run of this source');
  });

  it('claims nothing about an uncounted backlog with the gate off either', () => {
    renderControls(source({ requires_curation: false, waiting: null }));

    // The other switch position, driven rather than asserted about: this branch has its
    // own wording for both halves, so a guard added to only one of the two would pass a
    // test that named just the gated spelling. This is the property `gateConsequence`'s
    // fallback exists for.
    const copy = screen.getByText(/reaches readers as soon as a run writes it/);
    // No number, and no count-dependent wording from this branch…
    expect(copy.textContent).not.toMatch(/\d/);
    expect(copy.textContent).not.toContain('What is already waiting to be published stays waiting');
    // …but both answers still stated as classes, which is what the decision needs.
    expect(copy.textContent).toContain('anything unread stays waiting for a person');
    expect(copy.textContent).toContain('will be applied by the next run of this source');
  });

  it('drops a pending confirmation when a refetch loses the count, rather than re-opening it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const counted = source({ waiting: { arrivals: 4, held: 0, contents: 0 } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <CurationGateControls source={counted} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Publish all waiting/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // `['admin', 'sources']` refetches under an open dialog — a completed sync
    // invalidates it, and so does the switch — so a refetch whose count fails must not
    // leave `confirmPublish` true behind an unmounted dialog: the next refetch that does
    // count would re-open a modal whose primary button releases the whole backlog.
    rerender(
      <QueryClientProvider client={client}>
        <CurationGateControls source={source({ waiting: null })} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(
      <QueryClientProvider client={client}>
        <CurationGateControls source={counted} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('drops a pending confirmation when a refetch leaves nothing to release', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <CurationGateControls source={source({ waiting: { arrivals: 18, held: 0, contents: 0 } })} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Publish all waiting/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // The counts can arrive as nothing rather than as null: a completed run marks those
    // pending arrivals missing (both waiting predicates require `missing_since IS NULL`),
    // or another curator answers them from the queue. Kept open, every count-gated line
    // drops out and the dialog reads "Each is recorded on its own, so the log still says."
    // over a button offering "Publish 0" — which posts and comes back "Nothing was
    // waiting."
    rerender(
      <QueryClientProvider client={client}>
        <CurationGateControls source={source({ waiting: { arrivals: 0, held: 0, contents: 0 } })} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Publish 0$/ })).not.toBeInTheDocument();
  });

  it('warns before the flip that the unread backlog would not be published by it', () => {
    renderControls(source({ requires_curation: true, waiting: { arrivals: 18, held: 0, contents: 0 } }));

    // The shape a source gated before its first run is in, and the reason this branch
    // exists at all: an admin about to un-gate 18 unread objects would otherwise read
    // only what the gate does to *future* runs, flip it expecting the 18 to flow, and be
    // told they stay only once the sentence had become a report.
    const copy = screen.getByText(/already waiting to be published would stay waiting/);
    expect(copy.textContent).toContain('only a person can release it');
    // Count-free, asserted as the property rather than as one phrasing of its violation:
    // with nothing held, no clause of this text may carry a number at all, so any count
    // over `arrivals + contents` fails here however it is worded. 18 arrivals and 18
    // visible objects holding unread points are different work, and one number over the
    // pair names whichever the reader assumes.
    expect(copy.textContent).not.toMatch(/\d/);
  });

  it('says nothing about either backlog while the gate is on and nothing is waiting', () => {
    renderControls(source({ requires_curation: true }));

    expect(screen.queryByText(/Switching it off would not hand/)).not.toBeInTheDocument();
    expect(screen.queryByText(/would stay waiting/)).not.toBeInTheDocument();
    expect(screen.getByText(/What was published before the switch stays visible/)).toBeInTheDocument();
  });

  it('gives both answers before the flip when the source is holding both kinds', () => {
    renderControls(source({ requires_curation: true, waiting: { arrivals: 18, held: 2, contents: 3 } }));

    // The two answers are opposite, so a person deciding needs them together: the unread
    // rows stay until someone releases them, the held changes are written by the next run
    // with nobody looking. Half of this pair has been missing twice.
    expect(screen.getByText(/already waiting to be published would stay waiting/)).toBeInTheDocument();
    expect(screen.getByText(/Switching it off would not hand the 2 changes/)).toBeInTheDocument();
  });

  it('says what the gate does to future runs and what it leaves alone', () => {
    renderControls(source({ requires_curation: true }));

    // The sentence that makes the switch safe to touch: an admin flipping it must
    // know it does not remove what readers can already see.
    expect(screen.getByText(/What was published before the switch stays visible/)).toBeInTheDocument();
  });

  it('says the unread backlog stays put when the gate is switched off', () => {
    renderControls(source({ requires_curation: false, waiting: { arrivals: 4, held: 0, contents: 0 } }));

    // "Everything this source finds reaches readers" is true of future runs and says
    // nothing about the four rows already waiting — and the design turns on those
    // staying put until a person releases them (ADR-0025 decision 5). This is the
    // sentence someone
    // reads while deciding to flip the switch.
    const copy = screen.getByText(/already waiting to be published stays waiting/);
    expect(copy.textContent).toContain('publishes nothing');
  });

  it('warns that a held change will be applied by the next run instead, not held', () => {
    renderControls(source({ requires_curation: false, waiting: { arrivals: 0, held: 2, contents: 0 } }));

    // The exception, and the more damaging half to get wrong: a held change is not a
    // `pending` row but a visible one carrying a pointer, and the hold is
    // `requires_curation AND curation_state <> 'pending'` — so with the gate off the
    // next run writes the proposed values and clears the pointer, and no curator ever
    // sees the card.
    const copy = screen.getByText(/will be applied by the next run of this source/);
    expect(copy.textContent).toContain('The 2 changes');
    expect(copy.textContent).toContain('holding them back');
    expect(copy.textContent).not.toContain('stays waiting');
  });

  it('does not raise the backlog when there is none to raise', () => {
    renderControls(source({ requires_curation: false }));

    expect(screen.queryByText(/stays waiting/)).not.toBeInTheDocument();
    expect(screen.getByText(/reaches readers as soon as a run writes it/)).toBeInTheDocument();
  });

  it('agrees with the count when exactly one change is held', () => {
    renderControls(source({ requires_curation: false, waiting: { arrivals: 0, held: 1, contents: 0 } }));

    // "The 1 change … holding them back" put the article and the number on the same
    // job and a plural pronoun behind a singular count — in the file where every
    // other count-dependent word bends.
    const copy = screen.getByText(/will be applied by the next run of this source/);
    expect(copy.textContent).toContain('The change being held back');
    expect(copy.textContent).toContain('holding it back');
    expect(copy.textContent).not.toContain('The 1 change');
  });

  it('says nothing is waiting rather than showing an empty line', () => {
    renderControls(source());

    expect(screen.getByText('Nothing waiting.')).toBeInTheDocument();
    // Nothing to release, so no button to release it.
    expect(screen.queryByRole('button', { name: /Publish all waiting/ })).not.toBeInTheDocument();
  });

  it('counts the kinds separately, because they are different sentences', () => {
    renderControls(source({ waiting: { arrivals: 18, held: 1, contents: 3 } }));

    // "18 waiting" would be true of twelve paintings inside one museum too.
    expect(screen.getByText(/18 objects nobody has read/)).toBeInTheDocument();
    expect(screen.getByText(/3 visible objects holding unread contents/)).toBeInTheDocument();
    expect(screen.getByText(/1 visible object holding a change/)).toBeInTheDocument();
  });

  it('offers to publish only what a batch may publish, and says so in the dialog', () => {
    renderControls(source({ waiting: { arrivals: 18, held: 1, contents: 3 } }));

    fireEvent.click(screen.getByRole('button', { name: /Publish all waiting/ }));

    // 21, not 22: the held change is not part of what this releases.
    expect(screen.getByRole('button', { name: 'Publish 21' })).toBeInTheDocument();
    // Read off the dialog's own text rather than by node, because the sentences are
    // deliberately broken by a `<strong>` and by interpolations — asserting node by
    // node would pass while the emphasis moved and the meaning changed.
    const dialog = screen.getByRole('dialog').textContent ?? '';
    // The two kinds stay apart here for the same reason the panel keeps them apart:
    // a `contents` row is *already visible*, and saying 21 objects become visible
    // says it about three museums a reader is looking at right now.
    expect(dialog).toContain('18 objects nobody has read become visible to readers');
    expect(dialog).toContain('3 objects readers can already see');
    expect(dialog).toContain('do not become visible, because they are visible already');
    expect(dialog).toContain('will not be published here');
    expect(dialog).toContain('old value beside the new one');
  });

  it('puts what the batch did into the alert, wording and all', async () => {
    mockedPublishWaiting.mockResolvedValue({
      categoryId: 2,
      published: [{ id: 1, name: 'Museo Nacional del Prado', locationsPublished: 3,
        treasureLinksPublished: 0, treasuresPublished: 0, withdrawalsReleased: 2 }],
      refused: [{ id: 9, name: 'Rijksmuseum', error: 'holding a proposal from a different run' }],
      outOfScope: 1,
      heldLeftForReview: 1,
    });
    renderControls(source({ waiting: { arrivals: 0, held: 1, contents: 3 } }));

    fireEvent.click(screen.getByRole('button', { name: /Publish all waiting/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 3' }));

    // The one end-to-end case: the response reaches `noticeFor` and its whole line reaches
    // the alert, with the clauses in order. Every clause's own wording — the counts, the
    // plurals, the grouping, the `null` remainder — is pinned directly in
    // `curationGateNotice.test.ts`, which is why that module exists.
    const notice = await screen.findByText(/1 object published\./);
    expect(notice.textContent).toBe('1 object published. 3 points now visible. '
      + '2 replaced points in Museo Nacional del Prado no longer shown. '
      + 'Rijksmuseum refused — holding a proposal from a different run. '
      + '1 object outside your scope, left alone. '
      + '1 held change still waiting on its own card.');
  });

  it('closes the dialog when the batch fails, so the message is not behind it', async () => {
    mockedPublishWaiting.mockRejectedValue(new Error('gateway timeout'));
    renderControls(source({ waiting: { arrivals: 2, held: 0, contents: 0 } }));

    fireEvent.click(screen.getByRole('button', { name: /Publish all waiting/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 2' }));

    // The failure alert is a sibling of the dialog, so a dialog left open puts MUI's
    // backdrop over the one message that matters and `aria-hidden` over the tree it
    // lives in — with the publish button enabled again, which invites a second full
    // run over a source whose earlier objects are already committed.
    const alert = await screen.findByText(/The batch stopped before finishing/);
    expect(alert).toBeVisible();
    // Waited out rather than asserted immediately: MUI keeps the paper mounted for
    // its exit transition, so "still there" one tick after the click says nothing
    // about whether it was told to close.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refreshes the panel when the batch fails, because part of it committed', async () => {
    mockedPublishWaiting.mockRejectedValue(new Error('gateway timeout'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <CurationGateControls source={source({ waiting: { arrivals: 1272, held: 0, contents: 0 } })} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Publish all waiting/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1272' }));

    // Each object is its own transaction, so a timeout on object 301 leaves 300
    // published — which is what the alert says. Refreshing only on success left the
    // panel reading "1272 objects nobody has read" and offering to publish 1272 beside
    // a message asserting some of them are already visible, with the object and
    // region-locations caches stale in the same window.
    await screen.findByText(/The batch stopped before finishing/);
    const keys = invalidate.mock.calls.map(c => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain('["admin","sources"]');
    expect(keys).toContain('["region-locations"]');
    invalidate.mockRestore();
  });

  it('does not promise anything about held changes when there are none', () => {
    renderControls(source({ waiting: { arrivals: 2, held: 0, contents: 0 } }));

    fireEvent.click(screen.getByRole('button', { name: /Publish all waiting/ }));

    expect(screen.getByRole('button', { name: 'Publish 2' })).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent ?? '').not.toContain('will not be published here');
  });
});
