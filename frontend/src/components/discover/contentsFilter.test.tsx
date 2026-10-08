/**
 * The filter above a museum's works finds what the screen shows.
 *
 * HTML collapses a run of spaces, so a work stored as *St. John  on Patmos*
 * reads "St. John on Patmos" on the tile — and a reader who typed that got
 * nothing back, with nothing on screen to say why (#835). Both sides are folded
 * now, so a search survives whatever the row holds, and meets a dash typed as a
 * hyphen or a name pasted off a wrapped line the same way.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExperienceTreasure } from '../../api/experiences';
import { HoverProvider } from '../../hooks/useHoverContext';
import { ContentsSection } from './ContentsSection';
import { LocationsSection } from './LocationsSection';

// The places list is virtualised, and jsdom has no layout — without a height
// the virtualiser mounts no rows. The shim `contentsDisclosure.test.tsx` uses.
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const realResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return 600; },
  });
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
  globalThis.ResizeObserver = realResizeObserver;
});

function work(id: number, name: string, artists: string[] = []): ExperienceTreasure {
  return {
    id, external_id: `Q${id}`, name, treasure_type: 'painting', artists, artists_curated: false,
    year: null, image_url: null, sitelinks_count: 0, is_iconic: false, curated_fields: [], venue_count: 1, venues: null,
    image_credit: null, found_at: null, found_at_site: null, kind_ids: [2],
  };
}

/**
 * The three works the cases are about, padded past `CONTENTS_COLLAPSE_THRESHOLD`
 * (15): the filter box is offered only for a list that long, and such a list
 * starts shut.
 */
const WORKS = [
  work(3122, 'St. John  on Patmos', ['Hieronymus Bosch']),
  work(2, 'Boma–Badingilo'),
  work(3, 'Morning in a Pine Forest', ['Ivan Shishkin', 'Konstantin  Savitsky']),
  ...Array.from({ length: 14 }, (_, i) => work(100 + i, `Study ${i + 1}`)),
];

function renderSection(contents = WORKS) {
  return render(
    <HoverProvider>
      <ContentsSection
        experienceId={1}
        contents={contents}
        totalCount={contents.length}
        isAuthenticated
        viewedIds={new Set<number>()}
        onMarkViewed={vi.fn()}
        onUnmarkViewed={vi.fn()}
      />
    </HoverProvider>,
  );
}

/** Whether a tile for the work is on screen — a tile names its work twice, in a caption and an overlay. */
const shown = (name: string) => screen.queryAllByText(name).length > 0;

/** The filter box, once the section is opened. */
function filter() {
  fireEvent.keyDown(screen.getByRole('button', { name: /Notable works/ }), { key: 'Enter' });
  return screen.getByPlaceholderText('Filter works...');
}

/** A serial site's places, as the World Heritage Centre names them, padded past the threshold. */
function renderPlaces() {
  const names: (string | null)[] = ['marmalo  IV', 'Geoagiu  / Drumul Romanilor', 'Boma–Badingilo',
    ...Array.from({ length: 14 }, (_, i) => `Shelter ${i + 1}`), null];
  return render(
    <HoverProvider>
      <LocationsSection
        experienceId={1184}
        objectName="Rock Art of the Mediterranean Basin on the Iberian Peninsula"
        locations={names.map((name, i) => ({
          id: i + 1, name, latitude: 0, longitude: 0, ordinal: i,
          isVisited: false, visitedAt: null, notes: null, curatedFields: undefined,
          // The last one stands for a part its source left unnamed: Rillo II's real
          // reference with its name left out, read by the reference (#1268).
          externalRef: name === null ? '874-758' : null,
        }))}
        totalCount={names.length}
        isAuthenticated
        onMarkLocation={vi.fn()}
        onUnmarkLocation={vi.fn()}
        onMarkAll={vi.fn()}
        onUnmarkAll={vi.fn()}
      />
    </HoverProvider>,
  );
}

describe('the works filter', () => {
  it('finds a work by the name the screen shows, whatever the row holds', () => {
    renderSection();
    fireEvent.change(filter(), { target: { value: 'John on Patmos' } });
    expect(shown('St. John on Patmos')).toBe(true);
    expect(shown('Boma–Badingilo')).toBe(false);
  });

  it('meets a dash typed as a hyphen, and a maker pasted with two spaces', () => {
    renderSection();
    fireEvent.change(filter(), { target: { value: 'boma-badingilo' } });
    expect(shown('Boma–Badingilo')).toBe(true);
    expect(shown('Morning in a Pine Forest')).toBe(false);

    fireEvent.change(filter(), { target: { value: 'Konstantin Savitsky' } });
    expect(shown('Morning in a Pine Forest')).toBe(true);
  });

  it('reads a filter of nothing but spaces as no filter', () => {
    // Past `CONTENTS_INITIAL_SHOW` (20), so the "Show all" control is in play:
    // a filter of spaces must neither narrow the list nor hide the control.
    const many = [...WORKS, ...Array.from({ length: 6 }, (_, i) => work(200 + i, `Sketch ${i + 1}`))];
    renderSection(many);
    fireEvent.change(filter(), { target: { value: '   ' } });
    expect(shown('St. John on Patmos')).toBe(true);
    expect(shown('Boma–Badingilo')).toBe(true);
    expect(screen.getByRole('button', { name: `Show all ${many.length} works` })).toBeInTheDocument();
  });
});

describe('the places filter of a serial site', () => {
  it('finds a place by the name the screen shows, and a dash typed as a hyphen', () => {
    renderPlaces();
    fireEvent.keyDown(screen.getByRole('button', { name: /Locations/ }), { key: 'Enter' });
    const box = screen.getByPlaceholderText('Find a place');

    fireEvent.change(box, { target: { value: 'marmalo IV' } });
    expect(shown('marmalo IV')).toBe(true);
    expect(shown('Boma–Badingilo')).toBe(false);

    fireEvent.change(box, { target: { value: 'boma-badingilo' } });
    expect(shown('Boma–Badingilo')).toBe(true);
    expect(shown('marmalo IV')).toBe(false);
  });

  it('finds a part the source left unnamed by the reference the row reads (#1268)', () => {
    renderPlaces();
    fireEvent.keyDown(screen.getByRole('button', { name: /Locations/ }), { key: 'Enter' });

    fireEvent.change(screen.getByPlaceholderText('Find a place'), { target: { value: '874-758' } });

    expect(shown('874-758')).toBe(true);
    expect(shown('marmalo IV')).toBe(false);
  });
});

describe('the places of a long serial site in groups (#1271)', () => {
  // Rock Art of the Mediterranean Basin, as the list in Comunidad Valenciana
  // reads it: four parts there, the rest in Aragón and Murcia.
  function renderGrouped() {
    const part = (id: number, name: string, regionPath: string, inRegion: boolean, hasPicture = false) => ({
      id, name, latitude: 0, longitude: 0, ordinal: id, isVisited: false, visitedAt: null, notes: null,
      curatedFields: undefined, externalRef: null, regionPath, inRegion, hasPicture,
    });
    const locations = [
      part(1, 'Pinós', 'Europe > Spain > Comunidad Valenciana', true, true),
      part(2, "L'Arc", 'Europe > Spain > Comunidad Valenciana', true),
      part(3, 'Cova dels Cavalls', 'Europe > Spain > Comunidad Valenciana', true, true),
      part(4, 'Coves de la Saltadora', 'Europe > Spain > Comunidad Valenciana', true),
      ...Array.from({ length: 10 }, (_, i) => part(10 + i, `Aragón shelter ${i + 1}`, 'Europe > Spain > Aragón', false, i === 0)),
      ...Array.from({ length: 4 }, (_, i) => part(30 + i, `Murcia shelter ${i + 1}`, 'Europe > Spain > Región de Murcia', false)),
    ];
    render(
      <HoverProvider>
        <LocationsSection
          experienceId={1184}
          objectName="Rock Art of the Mediterranean Basin on the Iberian Peninsula"
          locations={locations}
          totalCount={locations.length}
          isAuthenticated={false}
          onMarkLocation={vi.fn()}
          onUnmarkLocation={vi.fn()}
          onMarkAll={vi.fn()}
          onUnmarkAll={vi.fn()}
        />
      </HoverProvider>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Locations/ }), { key: 'Enter' });
  }

  it('opens the parts in the region and folds the rest by community, with counts', () => {
    renderGrouped();
    expect(shown('Pinós')).toBe(true);
    expect(screen.getByRole('button', { name: /Aragón\s*10 · 1 with a photo/ })).toHaveAttribute('aria-expanded', 'false');
    expect(shown('Aragón shelter 1')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Aragón/ }));
    expect(shown('Aragón shelter 1')).toBe(true);
  });

  it('keeps only the parts with a photo of their own, in every group, when asked', () => {
    renderGrouped();
    fireEvent.click(screen.getByRole('button', { name: 'With a photo · 3' }));
    expect(shown('Pinós')).toBe(true);
    expect(shown('Aragón shelter 1')).toBe(true);
    expect(shown("L'Arc")).toBe(false);
    expect(shown('Murcia shelter 1')).toBe(false);
  });
});
