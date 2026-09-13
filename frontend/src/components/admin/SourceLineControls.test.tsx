/**
 * Tests for the sitelinks line controls on a source's card.
 *
 * Two properties carry the risk here: a source with no line in its row
 * (`enter_sitelinks: null`) must render nothing rather than fields that
 * promise a change no run would ever read, and a stay line above the enter
 * line must never reach the server — the route rejects it, but a curator
 * should never see the round trip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SourceLineControls } from './SourceLineControls';
import { setSourceLine } from '../../api/admin';
import type { ExperienceSource } from '../../api/admin';

vi.mock('../../api/admin', async () => ({
  setSourceLine: vi.fn(),
}));

function source(overrides: Partial<ExperienceSource> = {}): ExperienceSource {
  return {
    id: 4,
    name: 'Places of worship',
    description: 'Sites of active worship, by Wikipedia presence',
    is_active: true,
    requires_curation: true,
    last_sync_at: null,
    last_sync_status: null,
    display_priority: 4,
    created_at: '2026-01-01T00:00:00Z',
    waiting: { arrivals: 0, held: 0, contents: 0 },
    enter_sitelinks: 22,
    stay_sitelinks: 18,
    ...overrides,
  };
}

const mockedSetSourceLine = setSourceLine as unknown as ReturnType<typeof vi.fn>;

function renderControls(s: ExperienceSource) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SourceLineControls source={s} />
    </QueryClientProvider>,
  );
}

describe('SourceLineControls', () => {
  beforeEach(() => {
    mockedSetSourceLine.mockReset();
  });

  it('renders nothing for a source that keeps its line in code', () => {
    const { container } = renderControls(source({ enter_sitelinks: null, stay_sitelinks: null }));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pair and saves a new one', async () => {
    mockedSetSourceLine.mockResolvedValue({
      sourceId: 4, name: 'Places of worship', enterSitelinks: 30, staySitelinks: 18,
    });
    renderControls(source());

    expect(screen.getByLabelText('Enter at')).toHaveValue(22);
    expect(screen.getByLabelText('Stay at or above')).toHaveValue(18);

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(mockedSetSourceLine).toHaveBeenCalledWith(
      4, { enterSitelinks: 30, staySitelinks: 18 },
    ));
  });

  it('refuses a stay line above the enter line before sending', () => {
    renderControls(source());

    fireEvent.change(screen.getByLabelText('Stay at or above'), { target: { value: '30' } });

    // Named rather than silent: a disabled button with no reason reads as broken.
    expect(screen.getByText(/stay line cannot be above the enter line/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save line' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));
    expect(mockedSetSourceLine).not.toHaveBeenCalled();
  });

  it('refuses a value below 1 before sending', () => {
    renderControls(source());

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '0' } });

    expect(screen.getByRole('button', { name: 'Save line' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));
    expect(mockedSetSourceLine).not.toHaveBeenCalled();
  });

  it('refuses a value above 1000 before sending', () => {
    renderControls(source());

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '1001' } });

    expect(screen.getByRole('button', { name: 'Save line' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));
    expect(mockedSetSourceLine).not.toHaveBeenCalled();
  });

  it('says what the two numbers mean and when a saved line takes effect', () => {
    renderControls(source());

    const copy = screen.getByText(/Wikipedia languages an item needs/);
    expect(copy.textContent).toContain('to enter this kind, and to stay once in');
    expect(copy.textContent).toContain('Applied by the next run');
    expect(copy.textContent).toContain('threshold explorer');
  });

  it('refetches the sources after a save, since the card reads the stored line', async () => {
    mockedSetSourceLine.mockResolvedValue({
      sourceId: 4, name: 'Places of worship', enterSitelinks: 30, staySitelinks: 18,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <SourceLineControls source={source()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));

    await waitFor(() => {
      const keys = invalidate.mock.calls.map(c => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
      expect(keys).toContain('["admin","sources"]');
    });
    invalidate.mockRestore();
  });

  it('says the line did not save when the server refuses it', async () => {
    mockedSetSourceLine.mockRejectedValue(new Error('conflict'));
    renderControls(source());

    // A resave of the unchanged pair is disabled (see the "changed" tests below),
    // so this has to edit a field before the button will do anything at all.
    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));

    const alert = await screen.findByText(/did not save/i);
    expect(alert).toBeInTheDocument();
  });

  it('disables Save line while the fields still equal the stored pair', () => {
    renderControls(source());

    // A resave of exactly what is already stored is not a request and not an audit
    // line — `WikidataCacheSection.tsx`'s TTL field gates its own save the same way.
    expect(screen.getByRole('button', { name: 'Save line' })).toBeDisabled();
  });

  it('enables Save line once a field differs from the stored pair', () => {
    renderControls(source());

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '30' } });

    expect(screen.getByRole('button', { name: 'Save line' })).toBeEnabled();
  });

  it('resyncs the fields when the stored pair changes under them', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <SourceLineControls source={source()} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Enter at')).toHaveValue(22);
    expect(screen.getByLabelText('Stay at or above')).toHaveValue(18);

    // Another admin's save, or a refetch correcting a stale value: the row under
    // this card changed, and the fields must not go on showing the old snapshot —
    // this is the property the fixed local state (`useState(String(...))`, never
    // resynced) was missing. `rerender` flushes the resulting effect inside its own
    // `act()`, so the update is visible by the time it returns.
    rerender(
      <QueryClientProvider client={client}>
        <SourceLineControls source={source({ enter_sitelinks: 30, stay_sitelinks: 25 })} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Enter at')).toHaveValue(30);
    expect(screen.getByLabelText('Stay at or above')).toHaveValue(25);
  });

  it('does not stomp an in-flight edit on a refetch that leaves the pair unchanged', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <SourceLineControls source={source()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '99' } });

    // A new `source` object with the *same* stored pair — the shape of the panel's
    // own `['admin', 'sources']` query settling again with nothing changed — must
    // leave the admin's unsaved keystroke alone.
    rerender(
      <QueryClientProvider client={client}>
        <SourceLineControls source={source()} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Enter at')).toHaveValue(99);
  });
});
