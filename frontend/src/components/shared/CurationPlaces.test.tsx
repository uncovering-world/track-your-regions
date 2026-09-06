/**
 * The Location field of the curate dialog: what it says, and as what it opens.
 *
 * The case worth pinning first is the single place, because it is the common one
 * (1178 of 1671 objects) and the one no other surface had a row for. The dialog is
 * stubbed — it has its own test — so what is asserted is the wiring: which place
 * opens, under which object, with the region whose batch draws it, and where the
 * outcome line lands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/experiences', () => ({
  fetchExperienceLocations: vi.fn(),
}));

vi.mock('./PointPreviewDialog', () => ({
  PointPreviewDialog: ({ name, correction }: {
    name: string;
    correction?: {
      place: { locationId: number; objectName: string; regionId?: number | null; unseen?: string };
      onDone: (m: string) => void;
    };
  }) => (
    <div role="dialog">
      <span>{`opened ${name}`}</span>
      {correction && <span>{`unseen=${String(correction.place.unseen)}`}</span>}
      {correction && (
        <button onClick={() => correction.onDone(
          `fixed ${correction.place.locationId} of ${correction.place.objectName} in region ${correction.place.regionId}`,
        )}>
          fix
        </button>
      )}
    </div>
  ),
}));

import { CurationPlaces } from './CurationPlaces';
import { fetchExperienceLocations, type ExperienceLocation } from '../../api/experiences';

const mockedLocations = fetchExperienceLocations as unknown as ReturnType<typeof vi.fn>;

function place(over: Partial<ExperienceLocation> = {}): ExperienceLocation {
  return {
    id: 9001, experience_id: 6205, name: null, external_ref: null, ordinal: 0,
    latitude: 51.5194, longitude: -0.127, created_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function answer(...locations: ExperienceLocation[]) {
  mockedLocations.mockResolvedValue({
    experienceId: 6205, experienceName: 'British Museum', locations, totalLocations: locations.length,
  });
}

function renderPlaces(regionId: number | null = 4, countryNames: string[] | null = ['United Kingdom']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurationPlaces experienceId={6205} experienceName="British Museum" regionId={regionId} countryNames={countryNames} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedLocations.mockReset();
});

describe('CurationPlaces', () => {
  it('reads a museum\'s one place as a Location field, and opens it to correct', async () => {
    answer(place());
    renderPlaces();

    // The coordinate and the country, as a value beside the name field. Waited for
    // by value: the field is labelled "Location" while it loads too.
    expect(await screen.findByDisplayValue('51.5194, -0.1270 · United Kingdom')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveValue('51.5194, -0.1270 · United Kingdom');
    // The one place of a museum is the museum: its door reads the object's name,
    // not "Location 1" off an ordinal the source happened to give.
    fireEvent.click(screen.getByRole('button', { name: 'Move or rename British Museum' }));
    expect(screen.getByText('opened British Museum')).toBeInTheDocument();

    // The correction names this place of this object, and the region whose batch
    // draws its pin, so the marker moves on the map the dialog was opened from.
    fireEvent.click(screen.getByRole('button', { name: 'fix' }));
    expect(await screen.findByText('fixed 9001 of British Museum in region 4')).toBeInTheDocument();
  });

  it('says on the field when the one place has been corrected', async () => {
    answer(place({ curated_fields: ['location'] }));
    renderPlaces();

    expect(await screen.findByText('pin corrected')).toBeInTheDocument();
  });

  it('folds a serial site\'s parts behind a count, and says on a row when one is corrected', async () => {
    answer(
      place({ id: 1, name: 'See', ordinal: 0, curated_fields: ['location'] }),
      place({ id: 2, name: 'Riesi', ordinal: 1 }),
      place({ id: 3, name: 'Port', ordinal: 2 }),
    );
    renderPlaces();

    expect(await screen.findByLabelText('Places')).toHaveValue('3 places · as the source lists them');
    expect(screen.queryByRole('button', { name: 'Riesi' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show places' }));
    expect(screen.getByRole('button', { name: 'Riesi' })).toBeInTheDocument();
    expect(screen.getByText('— 51.5194, -0.1270 · pin corrected')).toBeInTheDocument();
  });

  it('caps a long list, says so, and lifts the cap on request', async () => {
    answer(...Array.from({ length: 30 }, (_, i) => place({ id: i + 1, name: `Part ${i + 1}`, ordinal: i })));
    renderPlaces();

    expect(await screen.findByLabelText('Places')).toHaveValue('30 places · as the source lists them');
    fireEvent.click(screen.getByRole('button', { name: 'Show places' }));
    expect(screen.getByText('showing 25 of 30 places')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Part 30' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all 30 places' }));
    expect(screen.getByRole('button', { name: 'Part 30' })).toBeInTheDocument();
    expect(screen.queryByText(/showing 25 of/)).toBeNull();
  });

  it('says an unread place is one readers are not sent to yet, and hands the reason to the form', async () => {
    answer(place({ curation_state: 'pending' }));
    renderPlaces();

    expect(await screen.findByText(/Unread: readers are sent here once it is published/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move or rename British Museum' }));
    // Publishing, not the withdrawn card's "false alarm", is what would show it.
    expect(screen.getByText('unseen=unread')).toBeInTheDocument();
  });

  it('says an object whose every place is gone has none readers can be sent to', async () => {
    // The read offers what readers can be sent to, so an object whose only place
    // the source withdrew answers with no rows — and "0 places" behind a disclosure
    // that opens onto nothing would be the wrong thing to say about it.
    answer();
    renderPlaces();

    expect(await screen.findByDisplayValue('No place readers can be sent to')).toBeInTheDocument();
    expect(screen.getByText(/The review page is where that is answered/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move or rename/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show places' })).toBeNull();
  });

  it('says when the places could not be listed, rather than showing none', async () => {
    mockedLocations.mockRejectedValue(new Error('Experience not found'));
    renderPlaces();

    expect(await screen.findByText('Could not list its places: Experience not found')).toBeInTheDocument();
  });
});
