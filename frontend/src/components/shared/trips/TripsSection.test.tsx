/**
 * A place's trips on its card (#2120), as the mock's scenario E on the
 * Uffizi: newest first, a date changed in its own line, a trip added from
 * quick choices, a trip removed with an Undo in its place, every control
 * held while a visit write is on its way; nothing typed or removed lost to a
 * write that fails, and nothing of one place or traveller on the next.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LazyTripsSection } from '../lazyVisitTrips';
import { TripsSection } from './TripsSection';

const add = vi.fn();
const change = vi.fn();
const remove = vi.fn();
let visited = true;
let pending = false;
let failed = false;
const trip = (id: number, year: number | null, month: number | null = null, day: number | null = null) =>
  ({ id, year, month, day, createdAt: null });
let trips = [trip(2, 2022, 3), trip(1, 2015), trip(3, null)];

const who = vi.hoisted(() => ({ user: { id: 7 } }));
vi.mock('./useTrips', () => ({
  useTrips: (experienceId: number) => ({ trips: { experienceId, visited, trips }, add, change, remove, failed }),
  useRestoreVisits: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/useVisitedExperiences', () => ({ useVisitWritePending: () => pending }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: who.user }) }));

type Done = { onSuccess?: () => void; onError?: () => void };
/** A write the server takes: its answer arrives, and the caller's onSuccess runs. */
const succeeds = (_body: unknown, options?: Done) => options?.onSuccess?.();
/** A write the server refuses. */
const fails = (_body: unknown, options?: Done) => options?.onError?.();

beforeEach(() => {
  add.mockReset(); change.mockReset(); remove.mockReset();
  add.mockImplementation(succeeds); change.mockImplementation(succeeds); remove.mockImplementation(succeeds);
  visited = true; pending = false; failed = false; who.user = { id: 7 };
  trips = [trip(2, 2022, 3), trip(1, 2015), trip(3, null)];
});

const march2022 = new Date(2022, 2, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

describe("a place's trips on its card", () => {
  it('lists them newest first, an undated trip last, and says only the traveller sees them', () => {
    render(<TripsSection experienceId={9461} />);
    const section = screen.getByRole('region', { name: 'Your trips' });
    expect(within(section).getAllByText(/2015|Date not remembered|2022/).map(n => n.textContent))
      .toEqual([march2022, '2015', 'Date not remembered']);
    expect(screen.getByText('Only you see these dates.')).toBeTruthy();
  });

  it('shows nothing while the place itself is not visited', () => {
    visited = false;
    const { container } = render(<TripsSection experienceId={9461} />);
    expect(container.textContent).toBe('');
  });

  it("changes a trip's date in its own line, and saves no date on I don't remember", () => {
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change the date of 2015' }));
    fireEvent.click(screen.getByRole('button', { name: "I don't remember" }));
    expect(change).toHaveBeenCalledWith({ tripId: 1, date: { year: null, month: null, day: null } }, expect.anything());
  });

  it('saves a changed date as the selects hold it', () => {
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change the date of 2015' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(change).toHaveBeenCalledWith({ tripId: 1, date: { year: 2015, month: null, day: null } }, expect.anything());
  });

  it('removes a trip with an Undo in its place, which adds it again', () => {
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: `Remove the trip of ${march2022}` }));
    expect(remove).toHaveBeenCalledWith(2, expect.anything());
    expect(screen.getByRole('status').textContent).toContain(`The ${march2022} trip is removed`);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ year: 2022, month: 3, day: null }), expect.anything());
  });

  it('offers no Undo for a removal that failed', () => {
    remove.mockImplementation(fails);
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: `Remove the trip of ${march2022}` }));
    expect(remove).toHaveBeenCalledWith(2, expect.anything());
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('forgets a removed trip and an open date once the place is unticked, so a later visit starts afresh', () => {
    const { rerender } = render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: `Remove the trip of ${march2022}` }));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change the date of 2015' }));
    expect(screen.queryByRole('button', { name: 'Add a trip' })).toBeNull();
    visited = false; trips = [];
    rerender(<TripsSection experienceId={9461} />);
    visited = true; trips = [trip(4, 2024)];
    rerender(<TripsSection experienceId={9461} />);
    expect(screen.getByRole('region', { name: 'Your trips' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a trip' })).toBeTruthy();
  });

  it("keeps a removed trip's Undo, and the trip, when adding it back fails", () => {
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: `Remove the trip of ${march2022}` }));
    add.mockImplementation(fails);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(add).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain(`The ${march2022} trip is removed`);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it('takes the Undo away once the trip is back', () => {
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: `Remove the trip of ${march2022}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a changed date open when saving it fails, and closes it once saved', () => {
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change the date of 2015' }));
    change.mockImplementation(fails);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    change.mockImplementation(succeeds);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('says in words that a trip write failed, and nothing while none has', () => {
    const { rerender } = render(<TripsSection experienceId={9461} />);
    expect(screen.queryByRole('alert')).toBeNull();
    failed = true;
    rerender(<TripsSection experienceId={9461} />);
    expect(screen.getByRole('alert').textContent).toBe('Your trips were not changed. Try again.');
  });

  it('keeps the quick choices open when adding a trip fails', () => {
    add.mockImplementation(fails);
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a trip' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'When were you here?' })).getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('group', { name: 'When were you here?' })).toBeTruthy();
  });

  it("offers no removed trip's Undo on the next place a card steps to", async () => {
    const { rerender } = render(<LazyTripsSection experienceId={9461} />);
    fireEvent.click(await screen.findByRole('button', { name: `Remove the trip of ${march2022}` }));
    expect(screen.getByRole('status')).toBeTruthy();
    rerender(<LazyTripsSection experienceId={9462} />);
    expect(await screen.findByRole('region', { name: 'Your trips' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it("offers no removed trip's Undo to another traveller", async () => {
    const { rerender } = render(<LazyTripsSection experienceId={9461} />);
    fireEvent.click(await screen.findByRole('button', { name: `Remove the trip of ${march2022}` }));
    who.user = { id: 8 };
    rerender(<LazyTripsSection experienceId={9461} />);
    expect(await screen.findByRole('region', { name: 'Your trips' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it("adds a trip from the quick choices: today, or one whose date is not remembered", () => {
    const now = new Date();
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a trip' }));
    const choices = screen.getByRole('group', { name: 'When were you here?' });
    fireEvent.click(within(choices).getByRole('button', { name: 'Today' }));
    expect(add).toHaveBeenCalledWith({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }, expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Add a trip' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'When were you here?' })).getByRole('button', { name: "I don't remember" }));
    expect(add).toHaveBeenLastCalledWith({ year: null, month: null, day: null }, expect.anything());
  });

  it('opens a year alone from "A year…", with no month or day', () => {
    render(<TripsSection experienceId={9461} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a trip' }));
    fireEvent.click(screen.getByRole('button', { name: 'A year…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(add).toHaveBeenCalledWith({ year: new Date().getFullYear(), month: null, day: null }, expect.anything());
  });

  it('holds every control while a visit write is on its way', () => {
    pending = true;
    render(<TripsSection experienceId={9461} />);
    expect(screen.getByRole('button', { name: 'Add a trip' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change the date of 2015' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove the trip of 2015' })).toBeDisabled();
  });
});
