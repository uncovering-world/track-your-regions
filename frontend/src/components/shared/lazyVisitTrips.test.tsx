/**
 * The trips chunk's loader (#2120): nothing is drawn, and nothing fetched,
 * until there is an untick to undo or a tick to date; then the chunk draws
 * the line, for the traveller whose write it was, the Undo under the region
 * the list showed and the date line under the one row it belongs to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { LazyVisitDateLine, LazyVisitRemovedLine } from './lazyVisitTrips';
import {
  clearRemovedVisits, forgetTraveller, handleTicks, noteRemovedVisits, noteTicked, removedVisitsOf, showDateLine, writeOrigin,
} from './visitRemovals';

vi.mock('./trips/visitTrips', () => ({
  default: (props: { part: string }) => <p>{`chunk: ${props.part}`}</p>,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));

afterEach(() => act(() => { clearRemovedVisits(); showDateLine(null); }));

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

describe('the date line through its lazy chunk', () => {
  it("draws the chunk under the row the tick was made on, a place's or a point's, and nowhere else", async () => {
    render(<><LazyVisitDateLine at={9461} /><LazyVisitDateLine at={9462} /><LazyVisitDateLine at={-8192} /></>);
    expect(screen.queryByText('chunk: offer')).toBeNull();
    act(() => showDateLine(9461, 7));
    expect(await screen.findAllByText('chunk: offer')).toHaveLength(1);
    act(() => showDateLine(-8192, 7));
    expect(await screen.findAllByText('chunk: offer')).toHaveLength(1);
    act(() => noteRemovedVisits([], client, writeOrigin(7)));
    expect(screen.queryByText('chunk: offer')).toBeNull();
  });

  it("draws nothing of another traveller's tick", () => {
    const { container } = render(<LazyVisitDateLine at={9461} />);
    act(() => showDateLine(9461, 8));
    expect(container.textContent).toBe('');
  });
});

describe("a tick's answer", () => {
  it('opens nothing when it arrives after the traveller who ticked was forgotten', () => {
    const opened = vi.fn();
    handleTicks(opened, () => {});
    const place = { experienceId: 9461, name: 'Uffizi', latitude: 43.77, longitude: 11.26 };
    const origin = writeOrigin(7);
    noteTicked(9461, [place], client, origin);
    expect(opened).toHaveBeenCalledTimes(1);
    act(() => forgetTraveller());
    noteTicked(9461, [place], client, origin);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
