/**
 * The review page's two tabs (#2282): the queue's questions and the crowded
 * cities, each with its count, the tab open being the address's `view`, and
 * the question asked before the crowded cities' tab is left with answers
 * staged. What the crowded cities' tab draws is `CrowdedCities.test.tsx`'s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));

const { mockedFetch } = vi.hoisted(() => ({ mockedFetch: vi.fn() }));

vi.mock('../../api/crowding', () => ({ fetchShadowedArrivals: vi.fn() }));
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
vi.mock('../../api/experiences', () => ({ fetchExperience: vi.fn() }));
// The tab's own chunk, as the page hands it its address and its staging.
vi.mock('./crowding/LazyCrowdedCities', () => ({
  LazyCrowdedCities: ({ selected, onSelect, onStagings }: ComponentProps<typeof import('./crowding/CrowdedCities').CrowdedCities>) => (
    <div data-testid="crowded-cities">
      {`open: ${selected ?? 'none'}`}
      <button type="button" onClick={() => onSelect('7-9-square', { replace: true })}>open the first group</button>
      <button
        type="button"
        onClick={() => onStagings(new Map([['7-9-square', new Map([[14, { answer: 'list', name: 'Schloßplatz', standing: 'new', crowded: true }]])]]))}
      >
        stage an answer
      </button>
    </div>
  ),
}));

import { fetchShadowedArrivals } from '../../api/crowding';
import { shaped, renderQueue, at, navType, goBack, MISSING, CONFLICT } from './reviewQueueFixtures';
import { BERLIN_SQUARES, ROME_CHURCHES } from './crowding/crowdingFixtures';

const mockedArrivals = vi.mocked(fetchShadowedArrivals);

beforeEach(() => {
  mockedFetch.mockReset().mockResolvedValue({ missing: [MISSING], conflicts: [CONFLICT], limit: 25 });
  mockedArrivals.mockReset().mockResolvedValue({ groups: [BERLIN_SQUARES, ROME_CHURCHES] });
});

describe('the review page’s tabs', () => {
  it('opens on the questions, and says how much waits under each tab', async () => {
    renderQueue();

    expect(await screen.findByRole('tab', { name: 'Questions 2' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('tab', { name: 'Crowded cities 14' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTestId('crowded-cities')).toBeNull();
  });

  it('opens the crowded cities as a push, and Back returns to the question the curator had open', async () => {
    renderQueue();
    await waitFor(() => expect(at()).toBe(`/review?row=conflicts:${CONFLICT.id}`));

    fireEvent.click(screen.getByRole('tab', { name: /Crowded cities/ }));
    await waitFor(() => expect(at()).toBe(`/review?row=conflicts:${CONFLICT.id}&view=crowded`));
    expect(navType()).toBe('PUSH');
    expect(screen.getByTestId('crowded-cities')).toHaveTextContent('open: none');
    // The queue's list is not drawn under the other tab.
    expect(screen.queryByRole('button', { name: /Clear all/ })).toBeNull();

    // The tab picks its first group as a correction of its own.
    fireEvent.click(screen.getByRole('button', { name: 'open the first group' }));
    await waitFor(() => expect(at()).toBe(`/review?row=conflicts:${CONFLICT.id}&view=crowded&crowd=7-9-square`));
    expect(navType()).toBe('REPLACE');

    goBack();
    await waitFor(() => expect(at()).toBe(`/review?row=conflicts:${CONFLICT.id}`));
    expect(screen.getByRole('tab', { name: /Questions/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens a link to a crowded city’s group on its tab, and leaves the queue’s selection alone there', async () => {
    renderQueue('/review?view=crowded&crowd=7-9-square');

    expect(await screen.findByTestId('crowded-cities')).toHaveTextContent('open: 7-9-square');
    expect(screen.getByRole('tab', { name: /Crowded cities/ })).toHaveAttribute('aria-selected', 'true');
    await screen.findByRole('tab', { name: 'Questions 2' });
    // The queue was read for its count, and its first row was not written into this tab's address.
    expect(at()).toBe('/review?view=crowded&crowd=7-9-square');
  });

  it('opens a link to a group whose type is two words', async () => {
    renderQueue('/review?view=crowded&crowd=21-4-holy+site');
    expect(await screen.findByTestId('crowded-cities')).toHaveTextContent('open: 21-4-holy site');
  });

  it('reads a tab it does not know as the questions', async () => {
    renderQueue('/review?view=nonsense');
    expect(await screen.findByRole('tab', { name: /Questions/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('crowded-cities')).toBeNull();
  });

  it('asks before leaving the crowded cities with answers staged', async () => {
    renderQueue('/review?view=crowded&crowd=7-9-square');
    fireEvent.click(await screen.findByRole('button', { name: 'stage an answer' }));

    fireEvent.click(screen.getByRole('tab', { name: /Questions/ }));
    expect(screen.getByRole('dialog', { name: '1 answer not applied' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay and apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(at()).toBe('/review?view=crowded&crowd=7-9-square');

    fireEvent.click(screen.getByRole('tab', { name: /Questions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard 1 answer' }));
    await waitFor(() => expect(['/review', `/review?row=conflicts:${CONFLICT.id}`]).toContain(at()));
    expect(screen.queryByTestId('crowded-cities')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Discarded: back on the tab, nothing is staged, so leaving it again asks nothing.
    fireEvent.click(screen.getByRole('tab', { name: /Crowded cities/ }));
    await screen.findByTestId('crowded-cities');
    fireEvent.click(screen.getByRole('tab', { name: /Questions/ }));
    await waitFor(() => expect(screen.queryByTestId('crowded-cities')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
