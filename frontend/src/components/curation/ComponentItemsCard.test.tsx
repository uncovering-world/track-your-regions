/**
 * The card for a serial site's candidate component items (#1272), on a
 * stretch of the Dacian frontier: the point named Bologa has the fort of
 * Bologa 20 m off under the same name and a tower 410 m off with a name half
 * alike; the point named Buciumi has its fort 35 m off.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ answerComponentItems: vi.fn(), suggestComponentItems: vi.fn() }));
vi.mock('../../api/admin', () => ({ findComponentItems: vi.fn() }));
const auth = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

import { answerComponentItems, suggestComponentItems } from '../../api/curation';
import { findComponentItems } from '../../api/admin';
import { ComponentItemsCard } from './ComponentItemsCard';

const mockedAnswer = answerComponentItems as unknown as ReturnType<typeof vi.fn>;
const mockedSuggest = suggestComponentItems as unknown as ReturnType<typeof vi.fn>;

const BOLOGA = { locationId: 501, pointName: 'Bologa', pointRef: '1591-005', latitude: 46.8853, longitude: 22.8752, basis: 'near', proposedAt: '2026-10-09T10:00:00.000Z' };
const BUCIUMI = { locationId: 502, pointName: 'Buciumi', pointRef: '1591-006', latitude: 47.0383, longitude: 23.0581, basis: 'near', proposedAt: '2026-10-09T10:00:00.000Z' };
const GILAU = { locationId: 503, pointName: 'Gilău', pointRef: '1591-007', latitude: 46.7497, longitude: 23.3906, basis: 'part_of', proposedAt: '2026-10-09T10:00:00.000Z' };

const DACIA = {
  id: 9850, external_id: '1591', name: 'Frontiers of the Roman Empire – Dacia', kind_id: 1, kind_name: 'World Heritage Sites',
  missing_since: null, source_membership: 'present', existence: 'extant', kind: 'component-items', proposed: null,
  component_items: [
    { ...BOLOGA, proposalId: 31, item: 'Q98501', label: 'Castrul Bologa', distanceM: 20, similarity: 1, exact: true, takenBack: false, itemLatitude: 46.8855, itemLongitude: 22.8753, registerCode: 'LMI CJ-I-s-A-07104', registerDisagrees: false },
    { ...BOLOGA, proposalId: 32, item: 'Q98502', label: 'Turnul Bologa', distanceM: 410, similarity: 0.52, exact: false, takenBack: false, itemLatitude: null, itemLongitude: null, registerCode: 'LMI CJ-II-m-B-07533', registerDisagrees: true },
    { ...BUCIUMI, proposalId: 33, item: 'Q98503', label: 'Castrul Buciumi', distanceM: 35, similarity: 0.61, exact: false, takenBack: false, itemLatitude: 47.0385, itemLongitude: 23.0583 },
    // The fort of Bologa proposed for Buciumi too, from an earlier pass.
    { ...BUCIUMI, proposalId: 34, item: 'Q98501', label: 'Castrul Bologa', distanceM: 900, similarity: 0.3, exact: false, takenBack: false, itemLatitude: null, itemLongitude: null },
    { ...GILAU, proposalId: 35, item: 'Q98504', label: 'Kastell Gilău', distanceM: 1334, similarity: 0.36, exact: false, takenBack: false, itemLatitude: null, itemLongitude: null },
  ],
  // Every place the site is made of: the three asked about, and Porolissum, which no question names.
  site_points: [
    { locationId: 501, name: 'Bologa', ref: '1591-005', latitude: 46.8853, longitude: 22.8752, imageUrl: null, imageCredit: null },
    {
      locationId: 502, name: 'Buciumi', ref: '1591-006', latitude: 47.0383, longitude: 23.0581,
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Castrul_Buciumi.jpg',
      imageCredit: { author: 'A photographer', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null },
    },
    { locationId: 503, name: 'Gilău', ref: '1591-007', latitude: 46.7497, longitude: 23.3906, imageUrl: null, imageCredit: null },
    { locationId: 504, name: 'Porolissum', ref: '1591-001', latitude: 47.1789, longitude: 23.1564, imageUrl: null, imageCredit: null },
  ],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ComponentItemsCard item={DACIA} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe("a site's candidate component items", () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
    mockedSuggest.mockResolvedValue({ configured: false, suggestions: [] });
  });

  it('lists the candidates under their points with why each was found, and saves nothing until something is answered', () => {
    renderCard();

    expect(screen.getByText('3 components of this site have no Wikidata item recording their reference. For each candidate found beside one, say whether it is the same place.')).toBeTruthy();
    expect(screen.getByText('near the point, of the site’s kind · 20 m away · the same name')).toBeTruthy();
    expect(screen.getByText('near the point, of the site’s kind · 410 m away · names 52 % alike')).toBeTruthy();
    expect(screen.getByText('same name, same spot')).toBeTruthy();
    // The register code under the candidate, and a word where its kind of entry is not the site's (#1340).
    expect(screen.getByText('LMI CJ-I-s-A-07104')).toBeTruthy();
    expect(screen.getByText('LMI CJ-II-m-B-07533 · another kind of entry than the site’s other candidates')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Castrul Bologa' })[0]).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q98501');
    // No map until a candidate is picked: the room it will take, with a prompt in it (#1691).
    expect(screen.getByText('Pick a candidate below to see it beside its component on the map.')).toBeTruthy();
    expect(screen.queryByText('the site’s other places')).toBeNull();
    expect(screen.queryByRole('button', { name: 'see both on the map' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Save answers' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads the candidate a curator picks, by a click or by Enter, and not the one the pointer crosses (#1691)', () => {
    renderCard();
    const row = (label: string) => screen.getByLabelText(`${label}: show on the map`);

    fireEvent.mouseEnter(row('Castrul Buciumi'));
    fireEvent.focus(row('Castrul Buciumi'));
    expect(screen.queryByText('the site’s other places')).toBeNull();

    fireEvent.click(row('Castrul Buciumi'));
    expect(screen.getAllByText('Castrul Buciumi').length).toBeGreaterThan(1);
    expect(row('Castrul Buciumi')).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByText('The candidate’s position is not read yet')).toBeNull();

    // The pointer moving over another row on its way to the map leaves the picked pair where it is.
    fireEvent.mouseEnter(row('Turnul Bologa'));
    expect(screen.queryByText('The candidate’s position is not read yet')).toBeNull();

    fireEvent.keyDown(row('Turnul Bologa'), { key: 'Enter' });
    expect(screen.getByText('The candidate’s position is not read yet')).toBeTruthy();
    expect(row('Castrul Buciumi')).not.toHaveAttribute('aria-current');
  });

  it("draws a component's own picture on its part-card, with the photographer under it (#1342)", () => {
    renderCard();
    const pictures = document.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0].getAttribute('src')).toContain('Castrul_Buciumi.jpg');
    expect(screen.getByText(/A photographer/)).toBeTruthy();
  });

  it("counts and sends only its own site's answers when it is drawn for another site (#1397)", async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9851, accepted: 1, refused: 0, pictured: 0 });
    const client = new QueryClient();
    const MANDELA = {
      ...DACIA, id: 9851, external_id: '1676', name: 'Nelson Mandela Legacy Sites',
      component_items: [{ ...BOLOGA, locationId: 601, pointName: 'Liliesleaf', pointRef: '1676-007', proposalId: 41, item: 'Q6547813', label: 'Liliesleaf Farm', distanceM: 71, similarity: 1, exact: false, takenBack: false, itemLatitude: null, itemLongitude: null }],
    } as unknown as ReviewQueueItem;
    const { rerender } = render(
      <QueryClientProvider client={client}><ComponentItemsCard item={DACIA} onDone={vi.fn()} /></QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Same place: Castrul Buciumi' }));
    expect(screen.getByRole('button', { name: 'Save 1 answer' })).toBeTruthy();

    rerender(<QueryClientProvider client={client}><ComponentItemsCard item={MANDELA} onDone={vi.fn()} /></QueryClientProvider>);
    expect((screen.getByRole('button', { name: 'Save answers' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Same place: Liliesleaf Farm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(9851, [{ proposalId: 41, answer: 'accepted' }]));
  });

  it('confirms every exact match at once and says what landed', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9850, accepted: 1, refused: 0, pictured: 1 });
    const onDone = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm the exact match' }));
    const [fortForBologa, fortForBuciumi] = screen.getAllByRole('button', { name: 'Same place: Castrul Bologa' });
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('true');
    expect(fortForBuciumi.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(9850, [{ proposalId: 31, answer: 'accepted' }]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Frontiers of the Roman Empire – Dacia: 1 item confirmed (1 with a picture)', 9850,
    ));
  });

  it('keeps one confirmation per point and one per item, and sends a turn-down beside it', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9850, accepted: 1, refused: 1, pictured: 0 });
    const onDone = renderCard();

    const [fortForBologa, fortForBuciumi] = screen.getAllByRole('button', { name: 'Same place: Castrul Bologa' });
    fireEvent.click(fortForBologa);
    // The same fort confirmed for Buciumi takes the confirmation off Bologa's: an item is one component.
    fireEvent.click(fortForBuciumi);
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('false');
    expect(fortForBuciumi.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(fortForBologa);
    // The tower confirmed takes the confirmation off the fort: a component is one item.
    fireEvent.click(screen.getByRole('button', { name: 'Same place: Turnul Bologa' }));
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Not it: Castrul Buciumi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 answers' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(9850, [
      { proposalId: 32, answer: 'accepted' }, { proposalId: 33, answer: 'refused' },
    ]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Frontiers of the Roman Empire – Dacia: 1 item confirmed, 1 candidate turned down', 9850,
    ));
  });
});

describe("searching one site's components again (#1429)", () => {
  beforeEach(() => {
    vi.mocked(findComponentItems).mockReset().mockResolvedValue({ started: true, message: 'Searching.' });
    mockedSuggest.mockResolvedValue({ configured: false, suggestions: [] });
  });

  it("offers an admin the search narrowed to this site, and says it is running", async () => {
    auth.isAdmin = true;
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Search this site again' }));

    await waitFor(() => expect(findComponentItems).toHaveBeenCalledWith(1, 9850));
    expect(await screen.findByText(/Searching this site's components/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search this site again' })).toBeDisabled();
  });

  it('offers it to no one the whole pass is not offered to', () => {
    auth.isAdmin = false;
    renderCard();
    expect(screen.queryByRole('button', { name: 'Search this site again' })).toBeNull();
  });
});

describe("Jev's judgement on the card (#1272)", () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestions: [
        { proposalId: 31, judgement: 'same', confidence: 0.93 },
        { proposalId: 32, judgement: 'other', confidence: 0.81 },
        // A margin of 42 points between its two options: a near coin toss, said as leaning.
        { proposalId: 33, judgement: 'same', confidence: 0.42 },
      ],
    });
  });

  it('says what Jev makes of each candidate, a low confidence as leaning, and chooses nothing for the curator', async () => {
    renderCard();

    expect(await screen.findByText('Jev says the same place · 93 %')).toBeTruthy();
    expect(screen.getByText('Jev says another place · 81 %')).toBeTruthy();
    expect(screen.getByText('Jev is unsure, leans the same place · 42 %')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Same place:/ }).every(b => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect((screen.getByRole('button', { name: 'Save answers' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms at one press only the candidates Jev calls the same place and is sure of', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 9850, accepted: 1, refused: 0, pictured: 0 });
    renderCard();

    // Buciumi's fort at 42 % is not sure enough; the tower is another place.
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm 1 candidate Jev is sure of' }));
    const [fortForBologa] = screen.getAllByRole('button', { name: 'Same place: Castrul Bologa' });
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Same place: Castrul Buciumi' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(9850, [{ proposalId: 31, answer: 'accepted' }]));
  });
});

describe('candidates that compete for a point or an item (#1272)', () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
  });

  it('are left out of the one-button confirmation, which counts only what it can keep', async () => {
    // Jev is sure of Gilău's fort (35) and of both candidates for Buciumi
    // (33, 34): those two compete for the point, so only Gilău's fort is
    // offered, and the button is done once it is confirmed.
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestions: [
        { proposalId: 35, judgement: 'same', confidence: 0.95 },
        { proposalId: 33, judgement: 'same', confidence: 0.92 },
        { proposalId: 34, judgement: 'same', confidence: 0.95 },
      ],
    });
    mockedAnswer.mockResolvedValue({ experienceId: 9850, accepted: 1, refused: 0, pictured: 0 });
    renderCard();

    const button = await screen.findByRole('button', { name: 'Confirm 1 candidate Jev is sure of' });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Same place: Kastell Gilău' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Same place: Castrul Buciumi' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('button', { name: 'Same place: Castrul Bologa' })
      .every(b => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the two one-button confirmations together (#1272)', () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
  });

  it('leave out a candidate that competes with one the other button would take, so neither undoes the other', async () => {
    // The fort of Bologa is the exact match for its point; Jev is sure of the
    // tower for the same point instead. Each would be uncontested on its own.
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestions: [{ proposalId: 32, judgement: 'same', confidence: 0.91 }],
    });
    renderCard();

    expect(await screen.findByText('Jev says the same place · 91 %')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Jev is sure of/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirm the exact match/ })).toBeNull();
  });
});

describe('a candidate a curator confirmed and took back (#1336)', () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
  });

  it('is marked, is left out of both one-button confirmations, and can still be confirmed by hand', async () => {
    // The fort of Bologa is the exact match for its point and Jev is sure of
    // it, and a curator took its confirmation back: the hasty batch that
    // confirmed it must not confirm it again, so neither button offers it.
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestions: [{ proposalId: 31, judgement: 'same', confidence: 0.97 }],
    });
    const takenBack = {
      ...DACIA,
      component_items: (DACIA.component_items ?? []).map(candidate =>
        candidate.proposalId === 31 ? { ...candidate, takenBack: true } : candidate),
    } as ReviewQueueItem;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ComponentItemsCard item={takenBack} onDone={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('taken back')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm the exact match/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Jev is sure of/ })).toBeNull();
    const [fortForBologa] = screen.getAllByRole('button', { name: 'Same place: Castrul Bologa' });
    fireEvent.click(fortForBologa);
    expect(fortForBologa.getAttribute('aria-pressed')).toBe('true');
  });
});
