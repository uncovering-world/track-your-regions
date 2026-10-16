/**
 * The feed of every curator's acts (#611), as an admin narrows it.
 *
 * Rows as the development database holds them: the admin published Kinkaku-ji, a curator
 * overrode Villa Farnesina's admission, and the catalogue merged Cologne Cathedral on its
 * own. What is pinned is who acted on each row, and that each filter reaches the read
 * and sends the list back to its first page, and that the curator menu holds everyone
 * the log names.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurationActivityPanel } from './CurationActivityPanel';
import { getCurationActivity } from '../../api/admin';

vi.mock('../../api/admin', async () => ({
  getCurationActivity: vi.fn(),
}));
vi.mock('../../api/worldViews', async () => ({ fetchWorldViews: vi.fn().mockResolvedValue([]) }));
vi.mock('../../hooks/useAuth', async () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));

const mockedFeed = getCurationActivity as unknown as ReturnType<typeof vi.fn>;

const entry = (id: number, over: Record<string, unknown>) => ({
  id, created_at: '2026-10-14T09:00:00Z', details: null, region_id: null, region_name: null, ...over,
});

beforeEach(() => {
  mockedFeed.mockReset().mockResolvedValue({
    total: 120, limit: 50, offset: 0,
    // Everyone the log names: the admin, a curator, and one whose scope was revoked.
    curators: [{ id: 1, name: 'Administrator' }, { id: 7, name: 'A curator' }, { id: 12, name: 'A former curator' }],
    activity: [
      entry(3, {
        action: 'merged', experience_id: 9713, experience_name: 'Cologne Cathedral', curator_id: null, curator_name: null,
      }),
      entry(2, {
        action: 'admission_overridden', experience_id: 6287, experience_name: 'Villa Farnesina',
        region_id: 6967, region_name: 'Lazio', curator_id: 7, curator_name: 'A curator',
      }),
      entry(1, {
        action: 'published', experience_id: 9711, experience_name: 'Kinkaku-ji', curator_id: 1, curator_name: 'Administrator',
      }),
    ],
  });
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurationActivityPanel />
    </QueryClientProvider>,
  );
}

const lastAsked = () => mockedFeed.mock.calls.at(-1)![0];

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('the curation activity feed (#611)', () => {
  it('names who acted on every row, the catalogue for its own merge', async () => {
    renderPanel();
    const villa = (await screen.findByText('Villa Farnesina')).closest('tr')!;
    expect(within(villa).getByText('A curator')).toBeInTheDocument();
    expect(within(villa).getByText('Lazio')).toBeInTheDocument();
    expect(within(screen.getByText('Cologne Cathedral').closest('tr')!).getByText('The catalogue')).toBeInTheDocument();
    expect(within(screen.getByText('Kinkaku-ji').closest('tr')!).getByText('Administrator')).toBeInTheDocument();
    expect(lastAsked()).toMatchObject({ limit: 50, offset: 0 });
  });

  it('offers every curator the log names, one whose scope was revoked included', async () => {
    renderPanel();
    await screen.findByText('Villa Farnesina');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Curator' }));
    expect(await screen.findByRole('option', { name: 'A former curator' })).toBeInTheDocument();
  });

  it('asks for one action and one curator, an admin among them, back at the first page', async () => {
    renderPanel();
    await screen.findByText('Villa Farnesina');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(lastAsked()).toMatchObject({ offset: 50 }));

    await pick('Action', 'Published');
    await waitFor(() => expect(lastAsked()).toMatchObject({ action: 'published', offset: 0 }));

    await pick('Curator', 'Administrator');
    await waitFor(() => expect(lastAsked()).toMatchObject({ action: 'published', curatorId: 1, offset: 0 }));
  });

  it('reads the days picked as whole local days', async () => {
    renderPanel();
    await screen.findByText('Villa Farnesina');
    // A year half typed is no day: nothing is asked for it.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '0202-10-12' } });
    await waitFor(() => expect(mockedFeed).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-12' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-14' } });

    await waitFor(() => expect(lastAsked()).toMatchObject({
      since: new Date(2026, 9, 12).toISOString(),
      before: new Date(2026, 9, 15).toISOString(),
    }));
  });

  it('says when the filters match nothing', async () => {
    mockedFeed.mockResolvedValue({ total: 0, limit: 50, offset: 0, activity: [], curators: [] });
    renderPanel();
    expect(await screen.findByText('No curation activity matches these filters.')).toBeInTheDocument();
  });
});
