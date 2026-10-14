/**
 * The location picker's place search runs when the curator asks — Enter or
 * *Find* — and never as they type: Nominatim's usage policy forbids
 * auto-complete over its API (#1308). Its coordinate field keeps what is typed
 * until the edit ends (#831). happy-dom has no WebGL, so the picker opens on its
 * search.
 */

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api/geocode', () => ({ searchPlaces: vi.fn(), aiGeocode: vi.fn() }));

import { LocationPicker } from './LocationPicker';
import { searchPlaces } from '../../api/geocode';
import { formatCoordinates } from '../../utils/coordinateParser';

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

type Coords = { lat: number; lng: number } | null;

/** The picker under a parent that holds its value, as both of its callers do. */
function HeldPicker({ onChange }: { onChange: (coords: Coords) => void }) {
  const [value, setValue] = useState<Coords>(null);
  return <LocationPicker value={value} onChange={(coords) => { setValue(coords); onChange(coords); }} />;
}

const coordField = () => screen.getByPlaceholderText(/e\.g\. 48\.8566, 2\.3522/) as HTMLInputElement;

/** One keystroke at a time, each appended to whatever the field holds by then. */
function typeInto(field: HTMLInputElement, text: string) {
  for (const char of text) {
    fireEvent.change(field, { target: { value: field.value + char } });
  }
}

describe('LocationPicker coordinates', () => {
  // A coordinate parses long before it is finished: "49.0545, 3." already
  // reads as 3°E, and "-1.2921, 3" as 3°E too.
  it.each([
    ['49.0545, 3.9520', { lat: 49.0545, lng: 3.952 }],
    ['-1.2921, 36.8219', { lat: -1.2921, lng: 36.8219 }],
  ])('keeps %s as it is typed and reformats it once the field is left', (typed, coords) => {
    const onChange = vi.fn();
    render(<HeldPicker onChange={onChange} />);
    fireEvent.click(screen.getByText('Coordinates'));

    typeInto(coordField(), typed);
    expect(coordField().value).toBe(typed);
    expect(onChange).toHaveBeenLastCalledWith(coords);

    fireEvent.blur(coordField());
    expect(coordField().value).toBe(formatCoordinates(coords.lat, coords.lng));
    expect(onChange).toHaveBeenLastCalledWith(coords);
  });

  it('reformats a typed coordinate on Enter', () => {
    render(<HeldPicker onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Coordinates'));

    typeInto(coordField(), '49.0545, 3.9520');
    fireEvent.keyDown(coordField(), { key: 'Enter' });
    expect(coordField().value).toBe('49.0545°N, 3.9520°E');
  });

  it('takes a value moved from elsewhere mid-edit — a pin dragged does not blur the field', () => {
    const { rerender } = render(<LocationPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Coordinates'));

    typeInto(coordField(), '49.0545, 3.9');
    rerender(<LocationPicker value={{ lat: 49.052, lng: 3.949 }} onChange={vi.fn()} />);
    expect(coordField().value).toBe('49.0520°N, 3.9490°E');
  });

  it('shows the standing pin again in a field emptied and left', () => {
    const onChange = vi.fn();
    render(<HeldPicker onChange={onChange} />);
    fireEvent.click(screen.getByText('Coordinates'));

    typeInto(coordField(), '49.0545, 3.9520');
    fireEvent.blur(coordField());
    fireEvent.change(coordField(), { target: { value: '' } });
    fireEvent.blur(coordField());
    expect(coordField().value).toBe('49.0545°N, 3.9520°E');
    expect(onChange).toHaveBeenLastCalledWith({ lat: 49.0545, lng: 3.952 });
  });

  it('leaves a coordinate that does not parse as typed, with the reason', () => {
    render(<HeldPicker onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Coordinates'));

    typeInto(coordField(), '49.0545, east');
    fireEvent.blur(coordField());
    expect(coordField().value).toBe('49.0545, east');
    expect(screen.getByText(/Could not parse coordinates/)).toBeInTheDocument();
  });
});
