/**
 * Separating one kind of a place into a place of its own (ADR-0142): offered
 * only where a place holds more than one kind, and asked twice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));
vi.mock('../../api/curation', () => ({ separateKind: vi.fn() }));

import { separateKind } from '../../api/curation';
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

beforeEach(() => vi.clearAllMocks());

describe('KindSeparation', () => {
  it('offers nothing for a place of one kind', () => {
    const { container } = renderIt({ ...pantheon, kinds: pantheon.kinds!.slice(0, 1) } as Experience);
    expect(container).toBeEmptyDOMElement();
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
