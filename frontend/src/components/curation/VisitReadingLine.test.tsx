/**
 * Jev's reading on an arriving place's card (#1768), on two of dry run 179's
 * arrivals: the Lupanar of Pompeii, read as a part of a larger place, and the
 * Darien scheme, an abandoned colony Jev is unsure about.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/curation', () => ({ suggestVisit: vi.fn() }));

import { suggestVisit } from '../../api/curation';
import { VisitReadingLine } from './VisitReadingLine';

const mockedSuggest = suggestVisit as unknown as ReturnType<typeof vi.fn>;

function renderLine(id: number, name: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <VisitReadingLine experienceId={id} name={name} />
    </QueryClientProvider>,
  );
}

beforeEach(() => mockedSuggest.mockReset());

describe("Jev's reading of an arriving place", () => {
  it('says what Jev reads the place as, with its confidence', async () => {
    mockedSuggest.mockResolvedValue({ configured: true, suggestion: { reading: 'part', confidence: 0.93 } });

    renderLine(20406, 'Lupanar');

    expect(await screen.findByText(/^\s*Jev reads it as a part of a larger place · 93 %$/)).toBeInTheDocument();
    expect(screen.getByText('What a visitor finds:')).toBeInTheDocument();
    expect(mockedSuggest).toHaveBeenCalledWith(20406);
  });

  it('says a reading under one half as leaning', async () => {
    mockedSuggest.mockResolvedValue({ configured: true, suggestion: { reading: 'not-a-place', confidence: 0.47 } });

    renderLine(20410, 'Darien scheme');

    expect(await screen.findByText(
      /Jev is unsure, leans to not one place: a culture, a kingdom or a group of sites · 47 %$/,
    )).toBeInTheDocument();
  });

  it('draws nothing where the deployment does not ask Jev or Jev could not read the place', async () => {
    mockedSuggest.mockResolvedValue({ configured: false, suggestion: null });

    const { container } = renderLine(20406, 'Lupanar');

    await waitFor(() => expect(mockedSuggest).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
