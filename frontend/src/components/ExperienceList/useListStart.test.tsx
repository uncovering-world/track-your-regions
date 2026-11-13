/**
 * Where Map mode's windowed list starts in its scroll container (#556):
 * measured again whenever what stands above the list changes size — the Undo
 * of an untick appearing, its chunk arriving, the line going — and once the
 * list itself is drawn. happy-dom has no layout and its ResizeObserver never
 * reports, so the spec holds the list's offset and reports the resize itself.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useListStart } from './useListStart';

let top = 0;
const observers: { callback: () => void; observed: Element[] }[] = [];
const realOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get: () => top });
  vi.stubGlobal('ResizeObserver', class {
    observed: Element[] = [];
    constructor(callback: () => void) { observers.push({ callback, observed: this.observed }); }
    observe(element: Element) { this.observed.push(element); }
    disconnect() { this.observed.length = 0; }
    unobserve() {}
  });
});
afterAll(() => {
  if (realOffsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', realOffsetTop);
  vi.unstubAllGlobals();
});

/** Something above changed size: every observer of it reports. */
function resized(element: Element) {
  act(() => observers.filter(o => o.observed.includes(element)).forEach(o => o.callback()));
}

function Harness({ listDrawn = true }: { listDrawn?: boolean }) {
  const { aboveRef, listRef, listStart } = useListStart<HTMLDivElement, HTMLUListElement>();
  return (
    <div>
      <div ref={aboveRef} data-testid="above" />
      {listDrawn && <ul ref={listRef} />}
      <output>{listStart}</output>
    </div>
  );
}

describe("where the list starts", () => {
  it('follows what stands above the list as it changes size', () => {
    top = 47;
    render(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('47');
    // The Undo line appears above the list: 47 px of curator box and its 30 px.
    top = 77;
    resized(screen.getByTestId('above'));
    expect(screen.getByRole('status').textContent).toBe('77');
    top = 47;
    resized(screen.getByTestId('above'));
    expect(screen.getByRole('status').textContent).toBe('47');
  });

  it('is measured once the list is drawn, after the region has loaded', () => {
    top = 30;
    const { rerender } = render(<Harness listDrawn={false} />);
    expect(screen.getByRole('status').textContent).toBe('0');
    rerender(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('30');
  });
});
