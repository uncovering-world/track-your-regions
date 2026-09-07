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
    year: null, image_url: null, sitelinks_count: 0,
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
  fireEvent.keyDown(screen.getByRole('button', { name: /Notable Works/ }), { key: 'Enter' });
  return screen.getByPlaceholderText('Filter works...');
}

/** A serial site's places, as the World Heritage Centre names them, padded past the threshold. */
function renderPlaces() {
  const names = ['marmalo  IV', 'Geoagiu  / Drumul Romanilor', 'Boma–Badingilo',
    ...Array.from({ length: 14 }, (_, i) => `Shelter ${i + 1}`)];
  return render(
    <HoverProvider>
      <LocationsSection
        experienceId={1184}
        locations={names.map((name, i) => ({
          id: i + 1, name, latitude: 0, longitude: 0, ordinal: i,
          isVisited: false, visitedAt: null, notes: null, curatedFields: undefined,
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
    const box = screen.getByPlaceholderText('Filter locations...');

    fireEvent.change(box, { target: { value: 'marmalo IV' } });
    expect(shown('marmalo IV')).toBe(true);
    expect(shown('Boma–Badingilo')).toBe(false);

    fireEvent.change(box, { target: { value: 'boma-badingilo' } });
    expect(shown('Boma–Badingilo')).toBe(true);
    expect(shown('marmalo IV')).toBe(false);
  });
});
