/**
 * The card for a site whose components the World Heritage list placed only
 * roughly (#1853), on Echmiatsin: the Church of Saint Gayaneh on the point
 * three components share, with OpenStreetMap's church carrying its reference
 * 341 m off, and a component given to the whole minute with nothing to say
 * where else it stands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ editLocation: vi.fn(), suggestPointHints: vi.fn() }));
// The map, as the card hands it its focus: the hint picked, by its label.
vi.mock('./ComponentItemsMap', async (original) => ({
  ...(await original<typeof import('./ComponentItemsMap')>()),
  ComponentItemsMap: ({ focus }: { focus: { candidate: { label: string } | null } }) => (
    <div>{`map on ${focus.candidate?.label ?? 'no hint'}`}</div>
  ),
}));
vi.mock('../shared/PointPreviewDialog', () => ({
  PointPreviewDialog: ({ name }: { name: string }) => <div>{`placing ${name} by hand`}</div>,
}));

import { editLocation, suggestPointHints } from '../../api/curation';
import { ApproximatePointsCard, hintHref, hintsInOrder, minuteCell, reasonWords, type ApproximatePoint } from './ApproximatePointsCard';

const mockedEdit = editLocation as unknown as ReturnType<typeof vi.fn>;
const mockedSuggest = suggestPointHints as unknown as ReturnType<typeof vi.fn>;

const GAYANEH: ApproximatePoint = {
  locationId: 10741, name: 'Church Saint Gayaneh and surrounding buildings', ref: '1011-002',
  latitude: 40.1593055556, longitude: 44.2951388889, reason: 'shared',
  hints: [
    { source: 'osm-ref', ref: 'W194252618', label: 'Saint Gayane Church', latitude: 40.1587, longitude: 44.2925, metres: 341 },
    { source: 'candidate', ref: 'Q-gayane-fixture', label: 'Saint Gayane Church', latitude: 40.157494, longitude: 44.291922, metres: 340 },
  ],
};
const ROUNDED: ApproximatePoint = {
  locationId: 10750, name: 'A component given to the whole minute', ref: '1011-007',
  latitude: 40.15, longitude: 44.3, reason: 'whole-minute', hints: [],
};

const ECHMIATSIN = {
  id: 831, external_id: '1011', name: 'Cathedral and Churches of Echmiatsin and the Archaeological Site of Zvartnots',
  kind_id: 1, kind_name: 'World Heritage Sites', missing_since: null, source_membership: 'present', existence: 'extant',
  kind: 'approximate-points', proposed: null,
  approximate_points: [GAYANEH, ROUNDED],
  site_points: [],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApproximatePointsCard item={ECHMIATSIN} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

beforeEach(() => {
  mockedEdit.mockReset();
  mockedEdit.mockResolvedValue({ locationId: 1 });
  mockedSuggest.mockReset();
  mockedSuggest.mockResolvedValue({ configured: false, suggestions: [] });
});

describe('the card for components placed only roughly', () => {
  it('says why each point is rough, and what says where it stands', () => {
    renderCard();
    expect(screen.getByText(/on the same point as another component/)).toBeTruthy();
    expect(screen.getByText(/whole minute: it may stand anywhere in a cell of about 1\.4 × 1\.9 km/)).toBeTruthy();
    expect(screen.getByText(/OpenStreetMap, carrying its World Heritage reference/)).toBeTruthy();
    expect(screen.getByText(/Nothing says where else it stands/)).toBeTruthy();
  });

  it('moves the point to the hint picked, as a curator\'s placement', async () => {
    const onDone = renderCard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Move here' })[0]);
    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(10741, { latitude: 40.1587, longitude: 44.2925 }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      `${ECHMIATSIN.name}: ${GAYANEH.name} moved 341 m to Saint Gayane Church`, 831,
    ));
  });

  it("keeps the list's point by placing it where it stands", async () => {
    renderCard();
    fireEvent.click(screen.getAllByRole('button', { name: "Keep the list's point" })[1]);
    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(10750, { latitude: 40.15, longitude: 44.3 }));
  });

  it('opens the correction to place a point by hand', () => {
    renderCard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Place it by hand' })[1]);
    expect(screen.getByText('placing A component given to the whole minute by hand')).toBeTruthy();
  });
});

describe("the card's words and links", () => {
  it('draws the whole minute around a rounded point', () => {
    expect(minuteCell(ROUNDED)).toEqual({
      west: 44.3 - 0.5 / 60, east: 44.3 + 0.5 / 60, south: 40.15 - 0.5 / 60, north: 40.15 + 0.5 / 60,
    });
    expect(reasonWords(GAYANEH)).toMatch(/stands for neither/);
  });

  it("links a hint to its OpenStreetMap object or its Wikidata item", () => {
    expect(hintHref(GAYANEH.hints[0])).toBe('https://www.openstreetmap.org/way/194252618');
    expect(hintHref({ ...GAYANEH.hints[0], ref: 'R3284827' })).toBe('https://www.openstreetmap.org/relation/3284827');
    expect(hintHref({ ...GAYANEH.hints[1], ref: 'Q1450786' })).toBe('https://www.wikidata.org/wiki/Q1450786');
  });
});

describe("Jev's judgement of the hints (#1913)", () => {
  it('says what Jev makes of a hint beside it', async () => {
    mockedSuggest.mockResolvedValue({ configured: true, suggestions: [
      { locationId: 10741, source: 'osm-ref', ref: 'W194252618', judgement: 'same', confidence: 0.93 },
    ] });
    renderCard();
    expect(await screen.findByText('Jev says the same place · 93 %')).toBeTruthy();
  });

  it('moves a hint Jev is sure is another place after the rest, and keeps it', () => {
    const sure = { locationId: 10741, source: 'osm-ref' as const, ref: 'W194252618', judgement: 'other' as const, confidence: 0.95 };
    const ordered = hintsInOrder(GAYANEH, key => (key === '10741:osm-ref:W194252618' ? sure : undefined));
    expect(ordered.map(h => h.source)).toEqual(['candidate', 'osm-ref']);
    // Unsure, it stays where it was.
    const unsure = hintsInOrder(GAYANEH, () => ({ ...sure, confidence: 0.6 }));
    expect(unsure.map(h => h.source)).toEqual(['osm-ref', 'candidate']);
  });
});

describe('the hint picked on the map (#1913)', () => {
  it('stays the one picked when the judgements arrive and move another hint after it', async () => {
    let answer: (value: unknown) => void = () => {};
    mockedSuggest.mockReturnValue(new Promise(resolve => { answer = resolve; }));
    const candidate = { ...GAYANEH.hints[1], label: 'The candidate item' };
    const site = { ...ECHMIATSIN, approximate_points: [{ ...GAYANEH, hints: [GAYANEH.hints[0], candidate] }, ROUNDED] } as unknown as ReviewQueueItem;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApproximatePointsCard item={site} onDone={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Show on the map' })[1]);
    expect(screen.getByText('map on The candidate item')).toBeTruthy();

    // Jev is sure the church above it is another place, which moves the church last.
    answer({ configured: true, suggestions: [
      { locationId: 10741, source: 'osm-ref', ref: 'W194252618', judgement: 'other', confidence: 0.95 },
    ] });
    expect(await screen.findByText('Jev says another place · 95 %')).toBeTruthy();
    expect(screen.getByText('map on The candidate item')).toBeTruthy();
  });
});
