/**
 * The Undo of an untick that took trips with its visits (#2120): one line,
 * read out once, a batch as one line with one Undo. It stays until the next
 * visit write or another region, and it is the traveller's own: driven here
 * by the real untick, tick and restore over a real query client, through the
 * shell's own loader, with only the requests and the signed-in traveller
 * stubbed.
 */
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVisitedExperiences } from '../../../hooks/useVisitedExperiences';
import { LazyVisitRemovedLine } from '../lazyVisitTrips';
import { clearRemovedVisits, forgetTraveller, noteRemovedVisits, writeOrigin } from '../visitRemovals';
import { useRestoreVisits } from './useTrips';
import { removedVisitsSentence } from './VisitRemovedLine';

const api = vi.hoisted(() => ({
  unmark: vi.fn(), mark: vi.fn(), restore: vi.fn(),
}));
const who = vi.hoisted(() => ({ user: { id: 7 } as { id: number } | null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: who.user !== null, user: who.user }) }));
vi.mock('../../../api/visited', () => ({
  fetchVisitedExperienceIds: async () => ({ visitedIds: [], partialIds: [], wholeTickedIds: [], total: 0 }),
  markExperienceVisited: api.mark,
  unmarkExperienceVisited: api.unmark,
}));
vi.mock('../../../api/trips', () => ({ restoreVisits: api.restore }));

const visit = (experienceId: number, trips: number) => ({
  experienceId, markedAt: null, notes: null, rating: null,
  trips: Array.from({ length: trips }, (_, i) => ({ year: 2015 + i, month: null, day: null })),
});

/** A promise the spec settles itself, so a write can be held on its way. */
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

/** A list as the shell draws it: the line through its loader, under the list's region. */
function List({ scope }: { scope: unknown }) {
  const { markVisited, unmarkVisited } = useVisitedExperiences();
  return (
    <>
      <button onClick={() => unmarkVisited(9461)}>Untick the Uffizi</button>
      <button onClick={() => markVisited(9462)}>Tick the Pitti Palace</button>
      <LazyVisitRemovedLine scope={scope} />
    </>
  );
}

/** The Undo's request as a traveller's screen would send it. */
let restoreAs: ReturnType<typeof useRestoreVisits>;
function UndoButton() {
  restoreAs = useRestoreVisits();
  return null;
}

let client: QueryClient;
const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;

/** Untick the Uffizi, whose visit held two trips, and wait for its line and the untick's end. */
async function untick() {
  api.unmark.mockResolvedValue({ removed: [visit(9461, 2)] });
  fireEvent.click(screen.getByRole('button', { name: 'Untick the Uffizi' }));
  const line = await screen.findByRole('status');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled());
  return line;
}

type ActGlobal = { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeAll(async () => {
  // The chunk arrives once, as in a tab that has fetched it already: the line
  // then draws in the same pass as the store's change.
  const warm = new QueryClient();
  act(() => noteRemovedVisits([visit(1, 1)], warm, writeOrigin(7)));
  const { unmount } = render(<QueryClientProvider client={warm}><LazyVisitRemovedLine scope={0} /></QueryClientProvider>);
  await screen.findByRole('status');
  unmount();
  act(() => clearRemovedVisits());
});

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.unmark.mockReset(); api.mark.mockReset(); api.restore.mockReset();
  who.user = { id: 7 };
});
afterEach(() => act(() => clearRemovedVisits()));

describe('the line an untick with trips leaves', () => {
  it('names the trips of one visit, one trip in the singular', () => {
    expect(removedVisitsSentence([visit(9461, 2)])).toBe('Visit removed, with its 2 trips');
    expect(removedVisitsSentence([visit(9461, 1)])).toBe('Visit removed, with its trip');
  });

  it('reads a batch as one line', () => {
    expect(removedVisitsSentence([visit(1, 2), visit(2, 0), visit(3, 3)])).toBe('3 visits removed, with their 5 trips');
  });

  it('appears while the untick that left it is still on its way, and stays', async () => {
    // Outside act, as in the browser: the store's change draws the line in a
    // microtask, while the untick is still counted as a pending write.
    const actGlobal = globalThis as ActGlobal;
    const actEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;
    actGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      render(wrap(<List scope={6737} />));
      api.unmark.mockResolvedValue({ removed: [visit(9461, 2)] });
      screen.getByRole('button', { name: 'Untick the Uffizi' }).click();
      await waitFor(() => expect(client.isMutating()).toBe(0));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(screen.getByRole('status').textContent).toContain('Visit removed, with its 2 trips');
      expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    } finally {
      actGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });

  it('survives the mount, unmount and remount of strict mode', async () => {
    render(<StrictMode>{wrap(<List scope={6737} />)}</StrictMode>);
    expect((await untick()).textContent).toContain('Visit removed, with its 2 trips');
  });

  it('goes with the next visit write', async () => {
    render(wrap(<List scope={6737} />));
    await untick();
    const tick = held<{ ticked: [] }>();
    api.mark.mockReturnValue(tick.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Tick the Pitti Palace' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await act(async () => tick.resolve({ ticked: [] }));
  });

  it('goes when the list shows another region', async () => {
    const { rerender } = render(wrap(<List scope={6737} />));
    await untick();
    rerender(wrap(<List scope={6738} />));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays while its Undo puts every visit back, held, and goes once that is done', async () => {
    render(wrap(<List scope={6737} />));
    await untick();
    const restore = held<{ restored: number }>();
    api.restore.mockReturnValue(restore.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled());
    expect(api.restore).toHaveBeenCalledWith([visit(9461, 2)]);
    await act(async () => restore.resolve({ restored: 1 }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('stays, says the visits were not put back, and offers its Undo again when that fails', async () => {
    render(wrap(<List scope={6737} />));
    await untick();
    expect(screen.queryByRole('alert')).toBeNull();
    api.restore.mockRejectedValue(new Error('Network error'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.getByRole('alert').textContent).toBe('Your visits were not put back. Try again.');
  });

  it('is offered to no other traveller, and its Undo sends nothing for one', async () => {
    const { rerender } = render(wrap(<><List scope={6737} /><UndoButton /></>));
    await untick();
    who.user = { id: 8 };
    rerender(wrap(<><List scope={6737} /><UndoButton /></>));
    expect(screen.queryByRole('status')).toBeNull();
    api.restore.mockResolvedValue({ restored: 1 });
    await act(async () => { await restoreAs.mutateAsync().catch(() => undefined); });
    expect(api.restore).not.toHaveBeenCalled();
  });

  it('keeps nothing of an untick that answers after the traveller signed out', async () => {
    render(wrap(<List scope={6737} />));
    const untickAnswer = held<{ removed: ReturnType<typeof visit>[] }>();
    api.unmark.mockReturnValue(untickAnswer.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Untick the Uffizi' }));
    await waitFor(() => expect(api.unmark).toHaveBeenCalled());
    act(() => forgetTraveller());
    await act(async () => untickAnswer.resolve({ removed: [visit(9461, 2)] }));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
