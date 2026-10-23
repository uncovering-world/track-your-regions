/**
 * A place's identifiers in its curation dialog (#1896): what each row says,
 * where it links, and what a curator's click sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlaceIdentifier } from '../../api/curation';

vi.mock('../../api/curation', () => ({
  fetchPlaceIdentifiers: vi.fn(),
  settlePlaceIdentifier: vi.fn(),
}));
import { fetchPlaceIdentifiers, settlePlaceIdentifier } from '../../api/curation';
import { PlaceIdentifiers, identifierHref } from './PlaceIdentifiers';

const BELEM_PART = 40369;

const row = (over: Partial<PlaceIdentifier> = {}): PlaceIdentifier => ({
  scheme: 'wikidata', value: 'Q215003', identifies: false, claimsIdentity: true, basis: ['point'],
  verdict: null, note: null, others: [{ id: 40590, name: 'Belém Tower', identifies: false }], ...over,
});

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(fetchPlaceIdentifiers).mockReset();
  vi.mocked(settlePlaceIdentifier).mockReset();
});

describe('PlaceIdentifiers', () => {
  it('links an identifier to the page that names it', () => {
    expect(identifierHref('wikidata', 'Q215003')).toBe('https://www.wikidata.org/wiki/Q215003');
    // A component's reference opens its site's page: the Centre has no page per component.
    expect(identifierHref('whc', '263-001')).toBe('https://whc.unesco.org/en/list/263');
    expect(identifierHref('osm', 'way/123')).toBe('https://www.openstreetmap.org/way/123');
    expect(identifierHref('osm', 'nope')).toBeNull();
  });

  it('says who else claims a value, and that two places that are one thing are merged', async () => {
    vi.mocked(fetchPlaceIdentifiers).mockResolvedValue({ experienceId: BELEM_PART, identifiers: [row()] });
    renderWith(<PlaceIdentifiers experienceId={BELEM_PART} />);

    expect(await screen.findByText('also claimed by another place')).toBeInTheDocument();
    expect(screen.getByText(/Also held by Belém Tower \(#40590\)/)).toBeInTheDocument();
    expect(screen.getByText(/merged, not corrected here/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Q215003' })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q215003');
  });

  it("sends the curator's word with its note", async () => {
    vi.mocked(fetchPlaceIdentifiers).mockResolvedValue({
      experienceId: BELEM_PART, identifiers: [row({ identifies: true, others: [] })],
    });
    vi.mocked(settlePlaceIdentifier).mockResolvedValue({
      experienceId: BELEM_PART, scheme: 'wikidata', value: 'Q215003', verdict: 'removed', identifies: false,
    });
    renderWith(<PlaceIdentifiers experienceId={BELEM_PART} />);
    await screen.findByText('identifies this place');

    // No word stands yet, so there is nothing to take back.
    expect(screen.queryByText('Let the sources decide')).toBeNull();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Names the square, not the tower' } });
    fireEvent.click(screen.getByText('Take it off this place'));

    await waitFor(() => expect(settlePlaceIdentifier).toHaveBeenCalledWith(BELEM_PART, {
      scheme: 'wikidata', value: 'Q215003', verdict: 'removed', note: 'Names the square, not the tower',
    }));
  });

  it('offers the way back once a word stands, and the add form only when asked', async () => {
    vi.mocked(fetchPlaceIdentifiers).mockResolvedValue({
      experienceId: BELEM_PART,
      identifiers: [row({ verdict: 'removed', identifies: false, claimsIdentity: false, basis: [], others: [] })],
    });
    renderWith(<PlaceIdentifiers experienceId={BELEM_PART} />);

    expect(await screen.findByText('taken off')).toBeInTheDocument();
    expect(screen.getByText('Let the sources decide')).toBeInTheDocument();
    // The scheme select stands beside the dialog's own only once a curator asks for it.
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByText('Name an identifier the sources missed'));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
