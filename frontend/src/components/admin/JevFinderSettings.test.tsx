/**
 * The AI Settings card that turns Jev's judging at finder time on and sets
 * what one search may spend (#1355): off and ten cents until an admin says
 * otherwise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/admin/ai', () => ({ getAISettings: vi.fn(), updateAISetting: vi.fn() }));

import { getAISettings, updateAISetting } from '../../api/admin/ai';
import { JevFinderSettings } from './JevFinderSettings';

const mockedGet = vi.mocked(getAISettings);
const mockedSave = vi.mocked(updateAISetting);

function renderCard(settings: Record<string, string>) {
  mockedGet.mockResolvedValue({ settings, models: [] } as never);
  render(<QueryClientProvider client={new QueryClient()}><JevFinderSettings /></QueryClientProvider>);
}

describe("Jev's judging at finder time", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedSave.mockReset();
    mockedSave.mockResolvedValue({ ok: true } as never);
  });

  it('is off with a ten-cent budget where nothing is set, and turns on', async () => {
    renderCard({});
    const toggle = await screen.findByRole('checkbox', { name: 'Judge new candidates when the search runs' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect((screen.getByLabelText('Budget for one search') as HTMLInputElement).value).toBe('0.1');

    fireEvent.click(toggle);

    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith('jev_finder_judges', 'on'));
  });

  it('saves a budget when the field is left, and not one outside the bounds', async () => {
    renderCard({ jev_finder_judges: 'on', jev_finder_budget_usd: '0.1' });
    const field = await screen.findByLabelText('Budget for one search');

    fireEvent.change(field, { target: { value: '7' } });
    fireEvent.blur(field);
    expect(screen.getByText('A number from 0 to 5')).toBeTruthy();
    expect(mockedSave).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '0.25' } });
    fireEvent.blur(field);
    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith('jev_finder_budget_usd', '0.25'));
  });
});
