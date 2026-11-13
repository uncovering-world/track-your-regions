/**
 * The review queue's map mode (#2477), as the page wires it: the toolbar's switch is a
 * push that keeps the filters and the open row, the map takes the list's column while
 * the card stays, a marker opens a card the way a row does, Back returns to the list, and
 * an answer on the map opens the nearest open question the map holds. What the map itself
 * draws is `queueMap/ReviewQueueMap.test.tsx`'s, and the walk's own rule `queueMapData.test.ts`'s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));

const { mockedFetch, mockedFetchMap } = vi.hoisted(() => ({ mockedFetch: vi.fn(), mockedFetchMap: vi.fn() }));

vi.mock('../../api/crowding', () => ({ fetchShadowedArrivals: vi.fn(async () => ({ groups: [] })) }));
vi.mock('../../api/reviewQueue', () => ({
  fetchReviewQueue: async (params: unknown) => shaped(await mockedFetch(params)),
  fetchReviewQueueMap: mockedFetchMap,
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
vi.mock('../../api/experiences', () => ({ fetchExperience: vi.fn() }));
// The map's own chunk, as the page hands it the address and the way to open a card.
vi.mock('./queueMap/LazyReviewQueueMap', () => ({
  LazyReviewQueueMap: ({
    address, placeName, onOpen, onShowList, step,
  }: ComponentProps<typeof import('./queueMap/ReviewQueueMap').ReviewQueueMap>) => (
    <div data-testid="the-map">
      {`open: ${address.row ?? 'none'}; kinds: ${address.kinds.join(',') || 'any'}; place 77: ${placeName(77) ?? '?'}`}
      {step && <p>{`walked to ${step.row}`}</p>}
      <button type="button" onClick={() => onOpen(`missing:${MISSING.id}`)}>open the missing place</button>
      <button type="button" onClick={onShowList}>show the list</button>
    </div>
  ),
}));

import { setExperienceState } from '../../api/curation';
import {
  shaped, renderQueue, at, navType, goBack, MISSING, CONFLICT,
} from './reviewQueueFixtures';

beforeEach(() => {
  mockedFetch.mockReset().mockResolvedValue({ missing: [MISSING], conflicts: [CONFLICT], limit: 25 });
  mockedFetchMap.mockReset().mockResolvedValue({ places: [], unplaced: 0 });
  vi.mocked(setExperienceState).mockReset().mockResolvedValue({ experienceId: 77 } as never);
});

/**
 * Four places gone from their source, listed 77, 78, 79, 80, and where they stand in Rome:
 * 77 at the Pantheon, 80 on the square behind it, 79 across the city at Santa Prassede, 78
 * at the Vatican. Answering 77 sends the list to 78, its next row, and the map to 80, the nearest.
 */
const site = (id: number) => ({ ...MISSING, id, name: `Site ${id}` });
const point = (placeId: number, lon: number, lat: number) => ({
  placeId, lon, lat, questions: [{ kind: 'missing', subs: [] }],
});
const ROME = {
  places: [
    point(77, 12.47685, 41.89861), point(78, 12.45332, 41.90219),
    point(79, 12.49845, 41.89622), point(80, 12.47778, 41.89778),
  ],
  unplaced: 0,
};

/** The list before the answer, and after it without 77; the map's read never refreshes. */
function answeringSite77() {
  mockedFetch.mockReset()
    .mockResolvedValueOnce({ missing: [site(77), site(78), site(79), site(80)], limit: 25 })
    .mockResolvedValue({ missing: [site(78), site(79), site(80)], limit: 25 });
  mockedFetchMap.mockResolvedValue(ROME);
}

describe('the review queue’s map mode', () => {
  it('switches to the map as a push that keeps the filters and the open row, and Back returns to the list', async () => {
    renderQueue(`/review?kind=conflict,missing&row=conflicts:${CONFLICT.id}`);
    await screen.findByRole('checkbox', { name: `Select ${CONFLICT.name}` });

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));

    await waitFor(() => expect(at()).toBe(`/review?kind=conflict,missing&row=conflicts:${CONFLICT.id}&view=map`));
    expect(navType()).toBe('PUSH');
    expect(screen.getByTestId('the-map'))
      .toHaveTextContent(`open: conflicts:${CONFLICT.id}; kinds: conflict,missing; place 77: ${MISSING.name}`);
    // The map takes the list's column; the card stays.
    expect(screen.queryByRole('checkbox', { name: `Select ${CONFLICT.name}` })).toBeNull();
    expect(screen.getByText(CONFLICT.name)).toBeInTheDocument();
    // The queue's tab stays the one open.
    expect(screen.getByRole('tab', { name: /Questions/ })).toHaveAttribute('aria-selected', 'true');

    goBack();
    await waitFor(() => expect(at()).toBe(`/review?kind=conflict,missing&row=conflicts:${CONFLICT.id}`));
    expect(screen.queryByTestId('the-map')).toBeNull();
    expect(await screen.findByRole('checkbox', { name: `Select ${CONFLICT.name}` })).toBeInTheDocument();
  });

  it('clears the list’s ticks on the way to the map, whose card is one question at a time', async () => {
    renderQueue('/review?kind=conflict,missing');
    const box = await screen.findByRole('checkbox', { name: `Select ${CONFLICT.name}` });
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    await screen.findByTestId('the-map');
    goBack();
    expect(await screen.findByRole('checkbox', { name: `Select ${CONFLICT.name}` })).not.toBeChecked();
  });

  it('clears the ticks when Back returns to the map, as the switch does', async () => {
    renderQueue('/review?kind=conflict,missing&view=map');
    await screen.findByTestId('the-map');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const box = await screen.findByRole('checkbox', { name: `Select ${CONFLICT.name}` });
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());

    goBack();
    await screen.findByTestId('the-map');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(await screen.findByRole('checkbox', { name: `Select ${CONFLICT.name}` })).not.toBeChecked();
  });

  it('opens a marker’s question on the card, as a push', async () => {
    renderQueue('/review?view=map');
    // The first question opens by itself, as on the list, and as a correction of the page's.
    await waitFor(() => expect(at()).toBe(`/review?row=conflicts:${CONFLICT.id}&view=map`));
    expect(navType()).toBe('REPLACE');
    mockedFetch.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'open the missing place' }));

    await waitFor(() => expect(at()).toBe(`/review?row=missing:${MISSING.id}&view=map`));
    expect(navType()).toBe('PUSH');
    expect(await screen.findByText(MISSING.name)).toBeInTheDocument();
    expect(screen.queryByText(CONFLICT.name)).toBeNull();
    // The question is on the loaded list already: opening it reads nothing again.
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('opens a link to the map on the map, and its way to the list keeps the row', async () => {
    renderQueue(`/review?row=conflicts:${CONFLICT.id}&view=map`);

    expect(await screen.findByTestId('the-map')).toHaveTextContent(`open: conflicts:${CONFLICT.id}`);
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'show the list' }));
    await waitFor(() => expect(at()).toBe(`/review?row=conflicts:${CONFLICT.id}`));
    expect(navType()).toBe('PUSH');
  });

  it('opens the nearest open question on the map after an answer, by replace, whatever the list’s order', async () => {
    answeringSite77();
    renderQueue('/review?row=missing:77&view=map');
    expect(await screen.findByRole('heading', { name: /Site 77/ })).toBeInTheDocument();
    await waitFor(() => expect(mockedFetchMap).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // Site 80 stands about 115 m away, while the list's next row, 78, is across the Tiber.
    // The map's read still holds 77, the question just answered, and the walk passes it by.
    expect(await screen.findByRole('heading', { name: /Site 80/ })).toBeInTheDocument();
    await waitFor(() => expect(at()).toBe('/review?row=missing:80&view=map'));
    expect(navType()).toBe('REPLACE');
    expect(screen.getByText('walked to missing:80')).toBeInTheDocument();

    // A marker opened since, and Back to 80, is not the walk: its line does not come back.
    fireEvent.click(screen.getByRole('button', { name: 'open the missing place' }));
    await waitFor(() => expect(screen.queryByText('walked to missing:80')).toBeNull());
    goBack();
    await waitFor(() => expect(at()).toBe('/review?row=missing:80&view=map'));
    expect(screen.queryByText(/walked to/)).toBeNull();
  });

  it('moves on by the list’s order in the list, and reads no map', async () => {
    answeringSite77();
    renderQueue('/review?row=missing:77');
    expect(await screen.findByRole('heading', { name: /Site 77/ })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    expect(await screen.findByRole('heading', { name: /Site 78/ })).toBeInTheDocument();
    await waitFor(() => expect(at()).toBe('/review?row=missing:78'));
    expect(navType()).toBe('REPLACE');
    expect(mockedFetchMap).not.toHaveBeenCalled();
  });
});
