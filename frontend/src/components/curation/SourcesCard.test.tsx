/**
 * The card for two data sources that describe one place differently (#1246),
 * on Rila Monastery: UNESCO calls it "Rila Monastery", Wikidata "Monastery of
 * Saint John of Rila", each with its own photograph; the points stand 8 m apart
 * and only Wikidata has a subtitle, so neither is asked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ chooseSourceViews: vi.fn(), suggestSourceViews: vi.fn() }));
vi.mock('../shared/PointPreviewDialog', () => ({
  PointPreviewDialog: ({ open, name, pins, movedTo }: {
    open: boolean; name: string; movedTo?: unknown;
    pins?: readonly { label: string; action?: { label: string; onPick: () => void } }[];
  }) => (
    open
      ? (
        <div data-testid="the-map-dialog" data-name={name} data-pins={pins?.map(pin => pin.label).join(' | ')} data-moved={String(movedTo !== undefined)}>
          {pins?.map(pin => pin.action && (
            <button key={pin.label} onClick={pin.action.onPick}>{pin.action.label}: {pin.label}</button>
          ))}
        </div>
      )
      : null
  ),
}));

import { chooseSourceViews, suggestSourceViews } from '../../api/curation';
import { SourcesCard } from './SourcesCard';

const mockedChoose = chooseSourceViews as unknown as ReturnType<typeof vi.fn>;
const mockedSuggest = suggestSourceViews as unknown as ReturnType<typeof vi.fn>;

const UNESCO = {
  kind_name: 'World Heritage Sites', source_name: 'UNESCO World Heritage Sites', latitude: null, longitude: null,
  external_id: '216', component: false, source_page: 'https://whc.unesco.org/en/list/216',
};
const WIKIDATA = {
  kind_name: 'Places of worship', source_name: 'Places of worship', latitude: null, longitude: null,
  external_id: 'Q207945', component: false, source_page: 'https://whc.unesco.org/en/list/216',
};

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
    { field: 'subtitle', why: 'one_source', metres: null },
    { field: 'location', why: 'agree', metres: 8 },
  ],
} as unknown as ReviewQueueItem;

/**
 * The Statue of Liberty (#1975): the World Heritage list resolves its site to
 * Liberty Island, Public art reads the statue, and each links its own article.
 */
const LIBERTY = {
  ...RILA, id: 382, external_id: '307', name: 'Statue of Liberty',
  source_views: [{
    field: 'wikipediaUrl',
    views: [
      { ...UNESCO, external_id: '307', source_page: 'https://whc.unesco.org/en/list/307', membership_id: 327, value: 'https://en.wikipedia.org/wiki/Liberty_Island', image_url: null, image_credit: null, shown: true },
      { ...WIKIDATA, external_id: 'Q9202', source_page: 'https://whc.unesco.org/en/list/307', kind_name: 'Public art', source_name: 'Public art', membership_id: 542, value: 'https://en.wikipedia.org/wiki/Statue_of_Liberty', image_url: null, image_credit: null, shown: false },
    ],
  }],
  quiet_fields: [],
} as unknown as ReviewQueueItem;

/**
 * Component 1209-002 of the Tequila landscape (#2158), on dev 2026-10-30: the
 * World Heritage list's record names it "Zona nucleo 02, …" and gives its
 * point to the whole minute, written 20.6833305556; Archaeology reads
 * Guachimontones' item 2,377 m away.
 */
const GUACHIMONTONES = {
  ...RILA, id: 35451, external_id: 'part:7546', name: 'Zona nucleo 02, Zona arqueológica Los Guachimontones de Teuchitlán',
  part_of: {
    name: 'Agave Landscape and Ancient Industrial Facilities of Tequila', unesco_id: '1209',
    unesco_url: 'https://whc.unesco.org/en/list/1209', component_ref: '1209-002',
  },
  source_views: [{
    field: 'location',
    metres: 2377,
    views: [
      {
        ...UNESCO, external_id: '1209-002', component: true, source_page: 'https://whc.unesco.org/en/list/1209',
        membership_id: 119240, value: null, image_url: null, image_credit: null,
        latitude: 20.6833305556, longitude: -103.816666667, shown: true,
      },
      {
        ...WIKIDATA, kind_name: 'Archaeology', source_name: 'Archaeology', external_id: 'Q2989048', source_page: null,
        membership_id: 124564, value: null, image_url: null, image_credit: null,
        latitude: 20.6951491, longitude: -103.8357192, shown: false,
      },
    ],
  }],
  quiet_fields: [],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn(), item = RILA) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourcesCard item={item} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('a place two sources describe differently', () => {
  beforeEach(() => {
    mockedChoose.mockReset();
    mockedSuggest.mockReset();
    mockedSuggest.mockResolvedValue({ configured: false, suggestions: [] });
  });

  it("shows each source's view side by side, readers' one chosen, and says what it does not ask", () => {
    renderCard();

    expect(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('button', { name: /Readers see this · keeping it/ })).toHaveLength(2);
    expect(screen.getByText('Not asked: subtitle (only one source has it), where it is (the points are 8 m apart).')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep what readers see' })).toBeTruthy();
  });

  it("links each column's record: the item a Wikidata kind reads and the site's page (#2158)", () => {
    renderCard();

    // Each row's columns name their records: the name row and the picture row.
    const items = screen.getAllByRole('link', { name: 'Q207945' });
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q207945');
    expect(screen.getAllByRole('link', { name: '216' })[0]).toHaveAttribute('href', 'https://whc.unesco.org/en/list/216');
  });

  it('folds two kinds that give one value into one column, naming the item once and choosing both (#2212)', async () => {
    // The Golden Gate in Vladimir on dev, 2026-11-01: the World Heritage list's
    // component calls it "The Golden Gate"; Monuments & memorials and Public art
    // read one item, Q775020, and both say "Golden Gate".
    const view = (over: object) => ({ value: null, image_url: null, image_credit: null, latitude: null, longitude: null, shown: false, ...over });
    const golden = {
      ...RILA, id: 11713, external_id: 'component:13771', name: 'Golden Gate',
      source_views: [{
        field: 'name',
        views: [
          view({ ...UNESCO, external_id: '633-002', component: true, membership_id: 501, value: 'The Golden Gate', shown: false }),
          view({ ...WIKIDATA, kind_name: 'Monuments & memorials', source_name: 'Monuments & memorials', external_id: 'Q775020', membership_id: 502, value: 'Golden Gate', shown: true }),
          view({ ...WIKIDATA, kind_name: 'Public art', source_name: 'Public art', external_id: 'Q775020', membership_id: 503, value: 'Golden Gate' }),
        ],
      }],
      quiet_fields: [],
    } as unknown as ReviewQueueItem;
    mockedChoose.mockResolvedValue({ changed: [] });
    renderCard(vi.fn(), golden);

    // Two columns, not three: the two kinds that give "Golden Gate" head one, the item named once.
    expect(screen.getAllByRole('button', { name: /Golden Gate/ })).toHaveLength(2);
    expect(screen.getByText('MONUMENTS & MEMORIALS')).toBeInTheDocument();
    expect(screen.getByText('PUBLIC ART')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Q775020' })).toHaveLength(1);
    // The folded column holds the view readers see, so it starts chosen.
    expect(screen.getByRole('button', { name: /^Golden Gate/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Keep what readers see' }));
    await waitFor(() => expect(mockedChoose).toHaveBeenCalledWith(11713, [{ field: 'name', membershipId: 502 }]));
  });

  it('folds two records that link one article, and keeps the other apart (#2212)', () => {
    // The Piazza del Duomo in Pisa: the World Heritage record and Squares &
    // streets' item link the Piazza dei Miracoli, Places of worship's the cathedral.
    const view = (over: object) => ({ value: null, image_url: null, image_credit: null, latitude: null, longitude: null, shown: false, ...over });
    const miracoli = 'https://en.wikipedia.org/wiki/Piazza_dei_Miracoli';
    const pisa = {
      ...RILA, id: 613, external_id: '395', name: 'Piazza del Duomo, Pisa',
      source_views: [{
        field: 'wikipediaUrl',
        views: [
          view({ ...UNESCO, external_id: '395', source_page: 'https://whc.unesco.org/en/list/395', membership_id: 601, value: miracoli, shown: true }),
          view({ ...WIKIDATA, external_id: 'Q1754247', membership_id: 602, value: 'https://en.wikipedia.org/wiki/Pisa_Cathedral' }),
          view({ ...WIKIDATA, kind_name: 'Squares & streets', source_name: 'Squares & streets', external_id: 'Q750245', membership_id: 603, value: miracoli }),
        ],
      }],
      quiet_fields: [],
    } as unknown as ReviewQueueItem;
    renderCard(vi.fn(), pisa);

    expect(screen.getAllByRole('button', { name: /Piazza dei Miracoli|Pisa Cathedral/ })).toHaveLength(2);
    // One link to read each article, not one per source.
    expect(screen.getAllByRole('link', { name: /^read / })).toHaveLength(2);
    // The Miracoli column names both records it comes from.
    expect(screen.getByRole('link', { name: '395' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Q750245' })).toBeInTheDocument();
  });

  it("names the property a component belongs to and tells its record from the property's (#2158)", () => {
    renderCard(vi.fn(), GUACHIMONTONES);

    const property = screen.getByRole('link', { name: 'Agave Landscape and Ancient Industrial Facilities of Tequila' });
    expect(property).toHaveAttribute('href', 'https://whc.unesco.org/en/list/1209');
    expect(property.parentElement?.textContent).toMatch(/^Component 1209-002 of Agave Landscape and Ancient Industrial Facilities of Tequila · the list of its parts/);
    // The table of the property's parts, where the component's row is (#2183): the
    // property's page names no component. The card says what its row is read from.
    expect(screen.getByRole('link', { name: 'the list of its parts' })).toHaveAttribute('href', 'https://whc.unesco.org/en/list/1209/maps/');
    expect(screen.getByText(/Reference 1209-002, the name and the point the card shows are the catalogue’s; the list’s country and area for it are in the table of parts\./)).toBeInTheDocument();
    const record = screen.getByRole('link', { name: 'component 1209-002' });
    expect(record).toHaveAttribute('href', 'https://whc.unesco.org/en/list/1209/maps/');
    expect(record.parentElement?.textContent).toMatch(/^The list's record of component 1209-002,\s+not of the whole property$/);
    expect(screen.getByRole('link', { name: 'Q2989048' })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q2989048');
  });

  it('says how far apart the points stand and which one is given only to the whole minute (#2158)', () => {
    renderCard(vi.fn(), GUACHIMONTONES);

    expect(screen.getByText('2.4 km apart')).toBeTruthy();
    const rough = screen.getAllByText(/^Given only to the whole minute: anywhere in a cell of about 1\.7 × 1\.9 km$/);
    expect(rough).toHaveLength(1);
    expect(screen.getByRole('button', { name: /20\.68333, -103\.81667/ })).toContainElement(rough[0]);
  });

  it("shows each source's point on one map, labelled with the source and never as a move (#2202)", () => {
    renderCard(vi.fn(), GUACHIMONTONES);
    fireEvent.click(screen.getByRole('button', { name: 'see both points on the map' }));

    const dialog = screen.getByTestId('the-map-dialog');
    expect(dialog.dataset.name).toBe('Zona nucleo 02, Zona arqueológica Los Guachimontones de Teuchitlán: where each source puts it');
    expect(dialog.dataset.pins).toBe('UNESCO World Heritage Sites · readers see | Archaeology');
    expect(dialog.dataset.moved).toBe('false');
  });

  it("answers the point from the map: a pin's keep is that source's choice, sent with the other choices as they stand", async () => {
    // Rila asked about its name and its point: Wikidata's name chosen on the
    // tile first, then Wikidata's point kept from the map — the pin readers do
    // not see yet, so a keep that ignored the pin would send UNESCO's 379 and
    // fail — and one call carries both, the name choice as it stands beside
    // the pin's point.
    const twoFields = {
      ...RILA,
      source_views: [RILA.source_views![0], {
        field: 'location',
        metres: 8,
        views: [
          { ...UNESCO, membership_id: 379, value: null, image_url: null, image_credit: null, latitude: 42.1333, longitude: 23.3400, shown: true },
          { ...WIKIDATA, membership_id: 3045, value: null, image_url: null, image_credit: null, latitude: 42.1334, longitude: 23.3401, shown: false },
        ],
      }],
      quiet_fields: [],
    } as unknown as ReviewQueueItem;
    mockedChoose.mockResolvedValue({ changed: ['name', 'location'] });
    const onDone = renderCard(vi.fn(), twoFields);
    fireEvent.click(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }));
    fireEvent.click(screen.getByRole('button', { name: 'see both points on the map' }));
    fireEvent.click(screen.getByRole('button', { name: 'keep this point: Places of worship' }));

    await waitFor(() => expect(mockedChoose).toHaveBeenCalledWith(450, [
      { field: 'name', membershipId: 3045 },
      { field: 'location', membershipId: 3045 },
    ]));
    // The card's outcome line, and the dialog gone with the card.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Rila Monastery: now shows name, where it is from the source you chose', 450));
    expect(screen.queryByTestId('the-map-dialog')).toBeNull();
  });

  it('counts the points where more than two sources place the place', () => {
    const field = GUACHIMONTONES.source_views![0];
    const three = {
      ...GUACHIMONTONES,
      source_views: [{
        ...field,
        views: [...field.views, {
          ...WIKIDATA, kind_name: 'Monuments & memorials', source_name: 'Monuments & memorials', external_id: 'Q2989048',
          source_page: null, membership_id: 130001, value: null, image_url: null, image_credit: null,
          latitude: 20.69, longitude: -103.83, shown: false,
        }],
      }],
    } as unknown as ReviewQueueItem;
    renderCard(vi.fn(), three);
    fireEvent.click(screen.getByRole('button', { name: 'see all 3 points on the map' }));

    expect(screen.getByTestId('the-map-dialog').dataset.pins)
      .toBe('UNESCO World Heritage Sites · readers see | Archaeology | Monuments & memorials');
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

  it("shows Jev's suggestion beside the view it picks, and chooses nothing for the curator", async () => {
    mockedSuggest.mockResolvedValue({ configured: true, suggestions: [{ field: 'name', membershipId: 379, confidence: 0.96 }] });
    renderCard();

    expect(await screen.findByText('Jev suggests this · 96 %')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Keep what readers see' })).toBeTruthy();
  });

  it('offers the article each source links, by its title, with a way to read each (#1975)', async () => {
    mockedChoose.mockResolvedValue({ experienceId: 382, fields: ['wikipediaUrl'], changed: ['wikipediaUrl'] });
    renderCard(vi.fn(), LIBERTY);

    expect(screen.getByText('Wikipedia article')).toBeTruthy();
    const statue = screen.getByRole('link', { name: 'read Statue of Liberty' });
    expect(statue.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Statue_of_Liberty');
    expect(screen.getByRole('link', { name: 'read Liberty Island' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Statue of Liberty/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 change' }));
    await waitFor(() => expect(mockedChoose).toHaveBeenCalledWith(382, [{ field: 'wikipediaUrl', membershipId: 542 }]));
  });
});
