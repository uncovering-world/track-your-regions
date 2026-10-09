/**
 * The location picker's place search runs when the curator asks — Enter or
 * *Find* — and never as they type: Nominatim's usage policy forbids
 * auto-complete over its API (#1308). jsdom has no WebGL, so the picker opens
 * on its search.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api/geocode', () => ({ searchPlaces: vi.fn(), aiGeocode: vi.fn() }));

import { LocationPicker } from './LocationPicker';
import { searchPlaces } from '../../api/geocode';

const mockedSearch = vi.mocked(searchPlaces);
const JAM = { lat: 34.3964, lng: 64.5161, display_name: 'Minaret of Jam, Ghor, Afghanistan', type: 'tower', wikidataId: 'Q209371' };

beforeEach(() => { mockedSearch.mockReset(); });

const searchBox = () => screen.getByPlaceholderText('Search for a place...');

describe('LocationPicker search', () => {
  it('searches on Enter, never while the name is typed', async () => {
    mockedSearch.mockResolvedValue([JAM]);
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);

    fireEvent.change(searchBox(), { target: { value: 'Minaret of Jam' } });
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    expect(mockedSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    expect(await screen.findByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
    fireEvent.click(await screen.findByText(JAM.display_name));

    expect(mockedSearch).toHaveBeenCalledWith('Minaret of Jam', 5);
    expect(onChange).toHaveBeenCalledWith({ lat: JAM.lat, lng: JAM.lng });
    // A place chosen is not a search that found nothing.
    expect(screen.queryByText(/No places found/)).not.toBeInTheDocument();
  });

  it('searches on Find and says when nothing was found, with no credit beside nothing', async () => {
    mockedSearch.mockResolvedValue([]);
    render(<LocationPicker value={null} onChange={vi.fn()} />);

    fireEvent.change(searchBox(), { target: { value: 'Atlantis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByText('No places found for "Atlantis".')).toBeInTheDocument();
    expect(screen.queryByText(/© OpenStreetMap contributors/)).not.toBeInTheDocument();
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
  });

  it('says a search that got no answer failed, rather than that nothing was found', async () => {
    mockedSearch.mockRejectedValue(new Error('Nominatim request failed'));
    render(<LocationPicker value={null} onChange={vi.fn()} />);

    fireEvent.change(searchBox(), { target: { value: 'Minaret of Jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByText(/did not answer/)).toBeInTheDocument();
    expect(screen.queryByText(/No places found/)).not.toBeInTheDocument();
  });
});
