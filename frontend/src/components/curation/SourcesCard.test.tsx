/**
 * The card for two data sources that describe one place differently (#1246),
 * on Rila Monastery: UNESCO calls it "Rila Monastery", Wikidata "Monastery of
 * Saint John of Rila", each with its own photograph; the points stand 8 m apart
 * and only Wikidata has a description, so neither is asked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ chooseSourceViews: vi.fn() }));

import { chooseSourceViews } from '../../api/curation';
import { SourcesCard } from './SourcesCard';

const mockedChoose = chooseSourceViews as unknown as ReturnType<typeof vi.fn>;

const UNESCO = { kind_name: 'World Heritage Sites', source_name: 'UNESCO World Heritage Sites', latitude: null, longitude: null };
const WIKIDATA = { kind_name: 'Places of worship', source_name: 'Places of worship', latitude: null, longitude: null };

const RILA = {
  id: 450, external_id: '216', name: 'Rila Monastery', kind_id: 1, kind_name: 'World Heritage Sites',
  missing_since: null, source_membership: 'present', existence: 'extant', kind: 'sources', proposed: null,
  source_views: [
    {
      field: 'name',
      views: [
        { ...UNESCO, membership_id: 379, value: 'Rila Monastery', image_url: null, image_credit: null, shown: true },
        { ...WIKIDATA, membership_id: 3045, value: 'Monastery of Saint John of Rila', image_url: null, image_credit: null, shown: false },
      ],
    },
    {
      field: 'imageUrl',
      views: [
        { ...UNESCO, membership_id: 379, value: null, image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Klosterkirche%20des%20Rilaklosters.jpg', image_credit: null, shown: true },
        { ...WIKIDATA, membership_id: 3045, value: null, image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Rila%20Monastery%2C%20August%202013.jpg', image_credit: { author: 'Raggatt2000', license: 'CC BY-SA 3.0' }, shown: false },
      ],
    },
  ],
  quiet_fields: [
    { field: 'description', why: 'one_source', metres: null },
    { field: 'location', why: 'agree', metres: 8 },
  ],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourcesCard item={RILA} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('a place two sources describe differently', () => {
  beforeEach(() => mockedChoose.mockReset());

  it("shows each source's view side by side, readers' one chosen, and says what it does not ask", () => {
    renderCard();

    expect(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('button', { name: /Readers see this · keeping it/ })).toHaveLength(2);
    expect(screen.getByText('Not asked: description (only one source has it), where it is (the points are 8 m apart).')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep what readers see' })).toBeTruthy();
  });

  it("publishes Wikidata's name and keeps UNESCO's picture", async () => {
    mockedChoose.mockResolvedValue({ experienceId: 450, fields: ['name', 'imageUrl'], changed: ['name'] });
    const onDone = renderCard();

    fireEvent.click(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 change' }));

    await waitFor(() => expect(mockedChoose).toHaveBeenCalledWith(450, [
      { field: 'name', membershipId: 3045 }, { field: 'imageUrl', membershipId: 379 },
    ]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Rila Monastery: now shows name from the source you chose', 450,
    ));
  });
});
