import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Virtualizer, type Virtualizer as ReactVirtualizer } from '@tanstack/react-virtual';
import { VirtualRow } from './VirtualRow';

/**
 * A row's height is filed under the key of the row at its `data-index` when the
 * virtualiser reads it (#1914), so a row that moves to another index is measured
 * again under the new one — and only then: a re-render at the same index forces
 * no layout, which is what keeps a hover cheap.
 */

/** happy-dom has no ResizeObserver; this one only remembers what is watched. */
class FakeResizeObserver {
  static readonly observed = new Set<Element>();
  observe(target: Element) { FakeResizeObserver.observed.add(target); }
  unobserve(target: Element) { FakeResizeObserver.observed.delete(target); }
  disconnect() { FakeResizeObserver.observed.clear(); }
}
const windowWithRO = window as unknown as { ResizeObserver?: unknown };
let hadRO: unknown;
beforeAll(() => { hadRO = windowWithRO.ResizeObserver; windowWithRO.ResizeObserver = FakeResizeObserver; });
afterAll(() => { windowWithRO.ResizeObserver = hadRO; });

/** A real virtualiser over a 600 px scroller, keyed by the rows' identities. */
function realVirtualizer(initialKeys: string[]) {
  let keys = initialKeys;
  const scroller = document.createElement('div');
  document.body.appendChild(scroller);
  const virtualizer = new Virtualizer<HTMLDivElement, Element>({
    count: keys.length,
    getScrollElement: () => scroller,
    estimateSize: () => 50,
    getItemKey: (i) => keys[i],
    observeElementRect: (_, cb) => { cb({ width: 300, height: 600 }); },
    observeElementOffset: (_, cb) => { cb(0, false); },
    scrollToFn: () => {},
  });
  virtualizer._willUpdate();
  virtualizer.getVirtualItems();
  const reorder = (next: string[]) => {
    keys = next;
    virtualizer.setOptions({ ...virtualizer.options, count: next.length, getItemKey: (i) => keys[i] });
    virtualizer.getVirtualItems();
  };
  return { virtualizer: virtualizer as unknown as ReactVirtualizer<HTMLDivElement, Element>, reorder, raw: virtualizer };
}

const rows = (virtualizer: ReactVirtualizer<HTMLDivElement, Element>, order: string[]) => (
  <>
    {order.map((key, i) => <VirtualRow key={key} virtualizer={virtualizer} index={i} start={i * 50}>{key}</VirtualRow>)}
  </>
);
const rowNamed = (container: HTMLElement, key: string) =>
  [...container.querySelectorAll('li')].find(li => li.textContent === key)!;

describe('VirtualRow', () => {
  it('measures the element once on mount and again when its index changes', () => {
    const measureElement = vi.fn();
    const virtualizer = { measureElement, elementsCache: new Map() } as unknown as ReactVirtualizer<HTMLDivElement, Element>;
    const { rerender, container } = render(<VirtualRow virtualizer={virtualizer} index={3} start={120}>row</VirtualRow>);
    const li = container.querySelector('li');
    expect(measureElement).toHaveBeenCalledTimes(1);
    expect(measureElement).toHaveBeenLastCalledWith(li);
    expect(li?.dataset.index).toBe('3');

    rerender(<VirtualRow virtualizer={virtualizer} index={3} start={160}>row</VirtualRow>);
    expect(measureElement).toHaveBeenCalledTimes(1);

    rerender(<VirtualRow virtualizer={virtualizer} index={4} start={200}>row</VirtualRow>);
    expect(li?.dataset.index).toBe('4');
    expect(measureElement).toHaveBeenCalledTimes(2);
    expect(measureElement).toHaveBeenLastCalledWith(li);
  });

  it('keeps a row watched after a report was filed under the row that took its index', () => {
    // Places of worship's header and its first row; then a card opens above
    // the groups and every row moves down by one.
    const { virtualizer, reorder, raw } = realVirtualizer(['h:worship', 'e:1']);
    const { rerender, container } = render(rows(virtualizer, ['h:worship', 'e:1']));
    const header = rowNamed(container, 'h:worship');
    expect(FakeResizeObserver.observed.has(header)).toBe(true);
    expect(raw.elementsCache.get('h:worship')).toBe(header);

    // The virtualiser already holds the new order while the header's
    // `data-index` still says 0: a ResizeObserver report for the header is
    // filed under the card's key, and the cache now holds the header there.
    reorder(['c:card', 'h:worship', 'e:1']);
    (raw as unknown as { _measureElement(node: Element, entry: undefined): void })._measureElement(header, undefined);
    expect(raw.elementsCache.get('c:card')).toBe(header);

    rerender(rows(virtualizer, ['c:card', 'h:worship', 'e:1']));
    const card = rowNamed(container, 'c:card');
    expect(header.dataset.index).toBe('1');
    expect(raw.elementsCache.get('h:worship')).toBe(header);
    expect(raw.elementsCache.get('c:card')).toBe(card);
    // The card's own measurement found the header under its key and stopped
    // watching it; the header's re-measure must watch it again, or the next
    // re-wrap of its chips goes unreported.
    expect(FakeResizeObserver.observed.has(header)).toBe(true);
    expect(FakeResizeObserver.observed.has(card)).toBe(true);
    expect(FakeResizeObserver.observed.has(rowNamed(container, 'e:1'))).toBe(true);
  });
});
