/**
 * Tests for the sitelinks line controls on a source's card.
 *
 * Two properties carry the risk here: a source with no line in its row
 * (`enter_sitelinks: null`) must render nothing rather than fields that
 * promise a change no run would ever read, and a stay line above the enter
 * line must never reach the server — the route rejects it, but a curator
 * should never see the round trip.
 *
 * A third since ADR-0058: a source may have two doors. Archaeology admits the
 * site a traveller stands on and the famous find a museum holds, and a find is
 * written up in fewer languages than its museum, so its row carries a second,
 * lower pair. The card has to offer both pairs where they exist and neither
 * where they do not — a finds line invented for a one-door source would be read
 * by no run, which is the same empty promise the first property guards against.
 * Half a pair is the exception, and it is shown *because* it is broken: a row
 * with one finds column is one whose run refuses to start, and this card is the
 * only place an admin can repair it.
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
    find_enter_sitelinks: null,
    find_stay_sitelinks: null,
    ...overrides,
  };
}

/** Archaeology: one source, two doors — the museums' line and the finds' lower one. */
function twoDoors(overrides: Partial<ExperienceSource> = {}): ExperienceSource {
  return source({
    id: 5, name: 'Archaeology', display_priority: 5,
    find_enter_sitelinks: 18, find_stay_sitelinks: 15,
    ...overrides,
  });
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

  it('still draws the card for a row left holding only a stay number', () => {
    // As broken as half a finds pair, and for the same reason: the run reads the
    // main pair first and refuses to start without the enter number. Hidden, the
    // panel would say this source keeps its line in code while its run refuses to
    // start, and no save could reach it.
    renderControls(source({ enter_sitelinks: null, stay_sitelinks: 18 }));

    expect(screen.getByLabelText('Enter at')).toHaveValue(null);
    expect(screen.getByLabelText('Stay at or above')).toHaveValue(18);
    expect(screen.getByRole('button', { name: 'Save line' })).toBeDisabled();
  });

  it('still draws the card for a row that states a finds line and no main one', () => {
    // Not a state any source is in: the run reads the main pair first and
    // refuses to start without it (`parseSourceLine`). Which is the reason the
    // card shows up — keyed on the main column alone it would vanish for the
    // one row an admin actually has to see and fix, and "no line at all" is the
    // only thing there is nothing to show for.
    renderControls(source({
      enter_sitelinks: null, stay_sitelinks: null,
      find_enter_sitelinks: 18, find_stay_sitelinks: 15,
    }));

    expect(screen.getByLabelText('Finds enter')).toHaveValue(18);
    expect(screen.getByLabelText('Enter at')).toHaveValue(null);
    expect(screen.getAllByText(/whole number from 1 to 1000/)).not.toHaveLength(0);
  });

  it('shows half a finds pair, because half a pair is what the save repairs', () => {
    // The run reads the finds pair in full or refuses to start (ADR-0058
    // decision 5), so a single stored column — a hand edit of `api_config` — is
    // a source whose own run will not start. Hiding both fields for it would
    // leave the admin nothing to fix it with while the card said the source had
    // no second door at all.
    renderControls(source({ find_enter_sitelinks: 18, find_stay_sitelinks: null }));

    expect(screen.getByLabelText('Finds enter')).toHaveValue(18);
    expect(screen.getByLabelText('Finds stay')).toHaveValue(null);
    // And the empty partner holds the save until it is filled, so the only save
    // on offer is the one that makes the pair a door again.
    expect(screen.getByRole('button', { name: 'Save line' })).toBeDisabled();
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

  it('shows one pair for a one-door source, and sends one pair', async () => {
    // The keys matter as much as the fields: the route writes whichever keys
    // the body carries, so a fourth key sent here would give a source a finds
    // line its own run never reads.
    mockedSetSourceLine.mockResolvedValue({
      sourceId: 4, name: 'Places of worship', enterSitelinks: 30, staySitelinks: 18,
    });
    renderControls(source());

    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    expect(screen.queryByLabelText('Finds enter')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(mockedSetSourceLine).toHaveBeenCalledWith(
      4, { enterSitelinks: 30, staySitelinks: 18 },
    ));
  });

  it('shows both pairs for a two-door source, and sends all four', async () => {
    mockedSetSourceLine.mockResolvedValue({
      sourceId: 5, name: 'Archaeology',
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 20, findStaySitelinks: 15,
    });
    renderControls(twoDoors());

    expect(screen.getAllByRole('spinbutton')).toHaveLength(4);
    expect(screen.getByLabelText('Finds enter')).toHaveValue(18);
    expect(screen.getByLabelText('Finds stay')).toHaveValue(15);

    fireEvent.change(screen.getByLabelText('Finds enter'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));

    // All four, not the edited pair alone: the route merges what it is given,
    // and a body naming one pair would leave the other where it was — which is
    // right for a source that has no finds line and wrong as a save button.
    await waitFor(() => expect(mockedSetSourceLine).toHaveBeenCalledWith(5, {
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 20, findStaySitelinks: 15,
    }));
  });

  it('refuses a finds stay above the finds enter before sending', () => {
    renderControls(twoDoors());

    fireEvent.change(screen.getByLabelText('Finds stay'), { target: { value: '19' } });

    expect(screen.getByText(/finds stay line cannot be above the finds enter line/i))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save line' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));
    expect(mockedSetSourceLine).not.toHaveBeenCalled();
  });

  it('saves a two-door source on a change to its first pair alone', async () => {
    // The finds pair is untouched here, and still travels: leaving it out would
    // be a different request from the one the admin can see on the card.
    mockedSetSourceLine.mockResolvedValue({
      sourceId: 5, name: 'Archaeology',
      enterSitelinks: 30, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
    });
    renderControls(twoDoors());

    fireEvent.change(screen.getByLabelText('Enter at'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(mockedSetSourceLine).toHaveBeenCalledWith(5, {
      enterSitelinks: 30, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
    }));
  });

  it('resyncs the finds pair when the stored one changes under it', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <SourceLineControls source={twoDoors()} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Finds enter')).toHaveValue(18);

    rerender(
      <QueryClientProvider client={client}>
        <SourceLineControls source={twoDoors({ find_enter_sitelinks: 12, find_stay_sitelinks: 10 })} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Finds enter')).toHaveValue(12);
    expect(screen.getByLabelText('Finds stay')).toHaveValue(10);
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
    // And says nothing about finds on a source that has none.
    expect(copy.textContent).not.toContain('finds');
  });

  it('says what the second pair is, on a source that has one', () => {
    renderControls(twoDoors());

    const copy = screen.getByText(/Wikipedia languages an item needs/);
    expect(copy.textContent).toContain(
      'The second pair is the same question asked of the finds this kind admits,'
      + ' which are written up in fewer languages than the museums holding them.',
    );
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
