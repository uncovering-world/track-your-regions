/**
 * Separating one kind of a place into a place of its own (ADR-0144): offered
 * only where a place holds more than one kind, or is a component of a serial
 * site (ADR-0213 decision 6), and asked twice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));
vi.mock('../../api/curation', () => ({ separateKind: vi.fn() }));
vi.mock('../../api/parts', () => ({ fetchPlaceParts: vi.fn() }));

import { separateKind } from '../../api/curation';
import { fetchPlaceParts, type PlaceParts } from '../../api/parts';
import type { Experience } from '../../api/experiences';
import { KindSeparation } from './KindSeparation';

// The Pantheon as one place of Places of worship and Archaeology.
const pantheon = {
  id: 9710,
  kinds: [
    { kind_id: 4, kind_name: 'Places of worship', kind_priority: 4, type: null, source_id: 4, external_id: 'Q99309', source_membership: 'present' },
    { kind_id: 5, kind_name: 'Archaeology', kind_priority: 5, type: null, source_id: 5, external_id: 'Q99309', source_membership: 'present' },
  ],
} as unknown as Experience;

const renderIt = (experience: Experience, onSeparated = vi.fn()) => render(
  <QueryClientProvider client={new QueryClient()}>
    <KindSeparation experience={experience} regionId={null} onSeparated={onSeparated} />
  </QueryClientProvider>,
);

/** The place's *Part of* rows: the wholes given, each named by UNESCO's list or by a curator alone. */
const partOf = (...wholes: Array<{ name: string; listed: boolean }>): PlaceParts => ({
  experienceId: 9710, name: 'Pantheon', in_kind: true, merged_onto: false, parts: [],
  wholes: wholes.map(whole => ({
    place: { id: 9720, name: whole.name, subtitle: null, kind_name: 'World Heritage Sites', waiting: false,
      image_url: null, image_credit: null, longitude: null, latitude: null },
    in_scope: true, standing: true, statement: false, curator: null,
    list: whole.listed ? { reference: '91-001', name: null } : null,
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPlaceParts).mockResolvedValue(partOf());
});

describe('KindSeparation', () => {
  const ofOneKind = { ...pantheon, kinds: pantheon.kinds!.slice(0, 1) } as Experience;

  it('offers nothing for a place of one kind', async () => {
    const { container } = renderIt(ofOneKind);
    await waitFor(() => expect(fetchPlaceParts).toHaveBeenCalledWith(9710));
    expect(container).toBeEmptyDOMElement();
  });

  it('offers nothing for a place of one kind that only a curator made a part', async () => {
    vi.mocked(fetchPlaceParts).mockResolvedValue(partOf({ name: 'Campus Martius', listed: false }));
    const { container } = renderIt(ofOneKind);
    await waitFor(() => expect(fetchPlaceParts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the only kind of a component of a serial site, which stays the site\'s part', async () => {
    vi.mocked(fetchPlaceParts).mockResolvedValue(partOf({ name: 'Historic Centre of Rome', listed: true }));
    vi.mocked(separateKind).mockResolvedValue({ separationId: 1, originalId: 9710, separatedId: 9711 });
    renderIt(ofOneKind);
    fireEvent.click(await screen.findByRole('button', { name: 'Separate Places of worship' }));
    expect(screen.getByText(/This place stays a part of Historic Centre of Rome and keeps its visits\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Separate' }));
    await waitFor(() => expect(separateKind).toHaveBeenCalledWith(9710, 4));
  });

  it('does not ask for the parts of a place of two kinds', () => {
    renderIt(pantheon);
    expect(fetchPlaceParts).not.toHaveBeenCalled();
  });

  it('separates a kind only once the curator confirms, then closes the dialog', async () => {
    vi.mocked(separateKind).mockResolvedValue({ separationId: 1, originalId: 9710, separatedId: 9711 });
    const onSeparated = vi.fn();
    renderIt(pantheon, onSeparated);
    fireEvent.click(screen.getByRole('button', { name: 'Separate Archaeology' }));
    expect(separateKind).not.toHaveBeenCalled();
    expect(screen.getByText(/Archaeology becomes a place of its own/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Separate' }));
    await waitFor(() => expect(onSeparated).toHaveBeenCalled());
    expect(separateKind).toHaveBeenCalledWith(9710, 5);
  });
});
