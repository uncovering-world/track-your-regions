/**
 * What windowing and the hover store must hold for Discover's card list.
 *
 * Two failures are being pinned. The unwindowed list mounted every card the
 * response held — up to 683 `ExperienceCard`s, each with an image, a chip row
 * and a control — so opening a large region froze the tab. And hover as state
 * in the view re-rendered the map's owner and every card per pointer move;
 * `hoverStore.test.tsx` states the invariant generically, this pins it on the
 * surface: a hover re-renders the row it names and the row it left, and no
 * other, while the list component itself renders no more for it.
 *
 * The card is mocked to a counter: what is being asserted is who re-renders,
 * not what a card looks like — and the fast version and the slow one render
 * identical output, which is exactly how the slow one went unnoticed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Experience } from '../../api/experiences';
import { HoverProvider, useHoverActions } from '../../hooks/useHoverContext';
import { DiscoverExperienceList, DiscoverExperienceRow } from './DiscoverExperienceList';

// jsdom has no layout and no ResizeObserver, so without these the virtualiser
// reads a 0-height scroll container (`offsetHeight`, via its `getRect`) and
// mounts nothing — which would let every assertion below pass vacuously
// against an empty list. A `li` is a row (84 px, the row estimate); anything
// else is the 600 px scroll container.
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realResizeObserver = globalThis.ResizeObserver;
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
const realCancelAnimationFrame = globalThis.cancelAnimationFrame;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.tagName === 'LI' ? 84 : 600; },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() { return 400; },
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Synchronous, so the virtualiser's scroll-verify chain (`scrollToIndex`
  // re-checks the offset over up to ten animation frames) runs to completion
  // inside the act() that triggered it. Left asynchronous, jsdom fires the
  // leftover frames after the test has unmounted the list, where virtual-core
  // dereferences its nulled `targetWindow` — an unhandled error that failed
  // the CI run while every test in it passed, and raced too tightly to show
  // locally.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(performance.now()); return 0; }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});
afterAll(() => {
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
  if (realOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth);
  globalThis.ResizeObserver = realResizeObserver;
  globalThis.requestAnimationFrame = realRequestAnimationFrame;
  globalThis.cancelAnimationFrame = realCancelAnimationFrame;
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: undefined }),
}));

const cardRenders: Record<number, number> = {};

vi.mock('./ExperienceCard', () => ({
  ExperienceCard: ({ experience, isHovered }: { experience: Experience; isHovered?: boolean }) => {
    cardRenders[experience.id] = (cardRenders[experience.id] ?? 0) + 1;
    return <span data-testid={`card-${experience.id}`}>{isHovered ? 'on' : 'off'}</span>;
  },
}));

const experienceOf = (id: number): Experience => ({
  id,
  name: `Experience ${id}`,
  longitude: 0,
  latitude: 0,
} as Experience);

let actions: ReturnType<typeof useHoverActions>;
function GrabActions() {
  actions = useHoverActions();
  return null;
}

function renderList(count: number) {
  for (const key of Object.keys(cardRenders)) delete cardRenders[Number(key)];
  const experiences = Array.from({ length: count }, (_, i) => experienceOf(i + 1));
  const noop = () => {};
  return render(
    <HoverProvider>
      <GrabActions />
      <DiscoverExperienceList
        activeView={{ regionId: 1, regionName: 'Europe', categoryId: 1, categoryName: 'UNESCO World Heritage Sites' }}
        experiences={experiences}
        filteredExperiences={experiences}
        isLoading={false}
        search=""
        setSearch={noop}
        shortSourceName="UNESCO"
        rejectedCount={0}
        hasCuratorScope={false}
        isAuthenticated={false}
        visitedIds={new Set()}
        selectedExperienceId={null}
        onBack={noop}
        onSelectExperience={noop}
        onCardMouseEnter={noop}
        onCardMouseLeave={noop}
        onVisitedToggle={noop}
        onCurate={noop}
        onAdd={noop}
      />
    </HoverProvider>,
  );
}

describe('the windowed Discover card list', () => {
  it('mounts the window, not the region: 683 experiences, a handful of rows', () => {
    // 683 is the largest region on the live database. Before windowing every
    // one of them mounted; the window plus `overscan` is what may now.
    const { container } = renderList(683);
    const rows = container.querySelectorAll('li');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(30);
  });

  it('memoises the row, so a hover elsewhere cannot re-render it', () => {
    // The subscription makes a hover cheap; the memo is what keeps the list's
    // own renders from reaching every mounted row's card. Unwrap it and every
    // test here still passes while the hover reaches everything again — which
    // is how the map-mode list regressed once (`hoverIsolation.test.tsx`).
    const isMemo = (component: unknown) =>
      (component as { $$typeof: symbol }).$$typeof === Symbol.for('react.memo');
    expect(isMemo(DiscoverExperienceRow)).toBe(true);
  });

  it('re-renders only the row a marker hover names, and the row it leaves', () => {
    renderList(20);
    const first = screen.getByTestId('card-1');
    expect(first.textContent).toBe('off');
    const before = { ...cardRenders };

    act(() => { actions.setHoveredFromMarker(1); });
    expect(screen.getByTestId('card-1').textContent).toBe('on');
    expect(cardRenders[1]).toBe(before[1] + 1);
    expect(cardRenders[2]).toBe(before[2]);

    // The pointer moves on: the row left and the row entered, and no other.
    act(() => { actions.setHoveredFromMarker(2); });
    expect(screen.getByTestId('card-1').textContent).toBe('off');
    expect(screen.getByTestId('card-2').textContent).toBe('on');
    expect(cardRenders[1]).toBe(before[1] + 2);
    expect(cardRenders[2]).toBe(before[2] + 1);
    expect(cardRenders[3]).toBe(before[3]);
  });
});
