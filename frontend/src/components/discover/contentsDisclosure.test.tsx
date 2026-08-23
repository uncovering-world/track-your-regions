/**
 * Tests for the way into a museum's works.
 *
 * The grid inside was made keyboard-operable one round before this, and it made
 * no difference: the section is shut by default for anything past
 * `CONTENTS_COLLAPSE_THRESHOLD` — which is most museums, the Louvre included —
 * and the only thing that opened it was a `<div onClick>`. `Collapse` hides its
 * contents outright while shut, so the tiles were not tab stops either. A
 * capability nobody can reach is not a capability, and the vision doc had
 * already been written as though it were.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExperienceTreasure } from '../../api/experiences';
import { HoverProvider } from '../../hooks/useHoverContext';
import { ContentsSection, LocationsSection } from './ExperienceDetailPanel';

// The places list is virtualised, and jsdom has no layout — so without a height
// the virtualiser mounts no rows and any assertion about them passes against an
// empty list. Same shim `discoverListWindow.test.tsx` uses, and for the same
// reason.
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

function works(n: number): ExperienceTreasure[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    external_id: `Q${i + 1}`,
    name: `Work ${i + 1}`,
    treasure_type: 'painting',
    artist: null,
    year: null,
    image_url: null,
    sitelinks_count: 0,
  }));
}

/** Past `CONTENTS_COLLAPSE_THRESHOLD` (15), so the section starts shut — the Louvre's case. */
function renderSection(count = 20) {
  return render(
    <ContentsSection
      contents={works(count)}
      totalCount={count}
      isAuthenticated
      viewedIds={new Set<number>()}
      onMarkViewed={vi.fn()}
      onUnmarkViewed={vi.fn()}
    />,
  );
}

describe('the way into a museum\'s works', () => {
  it('is a control the keyboard can reach, and says whether it is open', () => {
    renderSection();

    const header = screen.getByRole('button', { name: /Notable Works/ });
    expect(header).toHaveAttribute('tabindex', '0');
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on Enter, which is the only way in without a pointer', () => {
    renderSection();
    const header = screen.getByRole('button', { name: /Notable Works/ });

    fireEvent.keyDown(header, { key: 'Enter' });

    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves a short holding open, since there is nothing to fold away', () => {
    renderSection(3);

    expect(screen.getByRole('button', { name: /Notable Works/ }))
      .toHaveAttribute('aria-expanded', 'true');
  });
});

/**
 * The same disclosure over the list of a serial site's places — and the sharper
 * of the two, since each row inside carries a visit checkbox. Locked shut to a
 * keyboard, a signed-in reader could not tick off a place they had stood in on
 * any site holding more than fifteen, which is every site whose list is worth
 * opening.
 */
describe('the way into a serial site\'s places', () => {
  function renderLocations(count = 20, visited = new Set<number>()) {
    return render(
      <HoverProvider>
      <LocationsSection
        experienceId={1}
        locations={Array.from({ length: count }, (_, i) => ({
          id: i + 1, name: `Place ${i + 1}`, latitude: 0, longitude: 0,
          ordinal: i,
          // The real field names, and no cast: `visited` was neither, so every row
          // arrived with `isVisited === undefined` and the label test below passed
          // on falsiness alone — its "already visited" half was unreachable. `as
          // never` also made the array assignable to anything, so a rename on the
          // interface would have gone through this file in silence.
          isVisited: visited.has(i + 1),
          visitedAt: null,
          notes: null,
        }))}
        totalCount={count}
        isAuthenticated
        onMarkLocation={vi.fn()}
        onUnmarkLocation={vi.fn()}
        onMarkAll={vi.fn()}
        onUnmarkAll={vi.fn()}
      />
      </HoverProvider>,
    );
  }

  it('is a control the keyboard can reach, and says whether it is open', () => {
    renderLocations();

    const header = screen.getByRole('button', { name: /Locations/ });
    expect(header).toHaveAttribute('tabindex', '0');
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on Enter, which is what puts the visit checkboxes in reach', () => {
    renderLocations();
    const header = screen.getByRole('button', { name: /Locations/ });

    fireEvent.keyDown(header, { key: 'Enter' });

    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('names each tick box, so a reader hears the place rather than "checkbox"', () => {
    renderLocations(3);

    // Unlabelled, thirty of these are announced identically and a reader has no
    // way to tell which place they are about to record.
    expect(screen.getByRole('checkbox', { name: /Place 1 — mark as visited/ }))
      .toBeInTheDocument();
  });

  it('names the other outcome once a place is recorded', () => {
    renderLocations(3, new Set([2]));

    expect(screen.getByRole('checkbox', { name: /Place 2 — mark as not visited/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Place 1 — mark as visited/ }))
      .toBeInTheDocument();
  });
});
