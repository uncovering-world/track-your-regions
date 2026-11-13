/**
 * The trips chunk's loader (#2120): nothing is drawn, and nothing fetched,
 * until there is an untick to undo; then the chunk draws the line, for the
 * traveller whose untick it was and under the region the list showed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { LazyVisitRemovedLine } from './lazyVisitTrips';
import { clearRemovedVisits, noteRemovedVisits, removedVisitsOf, writeOrigin } from './visitRemovals';

vi.mock('./trips/visitTrips', () => ({
  default: (props: { part: string }) => <p>{`chunk: ${props.part}`}</p>,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));

afterEach(() => act(() => clearRemovedVisits()));

const client = new QueryClient();
const withTrips = { experienceId: 9461, markedAt: null, notes: null, rating: null, trips: [{ year: 2015, month: null, day: null }] };

describe('the Undo line through its lazy chunk', () => {
  it('draws nothing while no untick removed a trip, and nothing for one that removed none', () => {
    const { container } = render(<LazyVisitRemovedLine scope={6737} />);
    act(() => noteRemovedVisits([{ ...withTrips, trips: [] }], client, writeOrigin(7)));
    expect(container.textContent).toBe('');
  });

  it('draws the chunk once an untick removed a trip', async () => {
    render(<LazyVisitRemovedLine scope={6737} />);
    act(() => noteRemovedVisits([withTrips], client, writeOrigin(7)));
    expect(await screen.findByText('chunk: removed')).toBeTruthy();
  });

  it("draws nothing of another traveller's untick", () => {
    const { container } = render(<LazyVisitRemovedLine scope={6737} />);
    act(() => noteRemovedVisits([withTrips], client, writeOrigin(8)));
    expect(container.textContent).toBe('');
  });

  it('drops the removal when the list shows another region before the chunk has arrived', () => {
    const { rerender } = render(<LazyVisitRemovedLine scope={6737} />);
    act(() => noteRemovedVisits([withTrips], client, writeOrigin(7)));
    rerender(<LazyVisitRemovedLine scope={6738} />);
    expect(removedVisitsOf(7)).toBeNull();
  });
});
