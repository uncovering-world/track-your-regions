/**
 * Tests for the review feed's toolbar.
 *
 * What is worth pinning is that every control *acts* — a checkbox is the filter,
 * not a draft of one, so there is no Apply button to forget — and that the two
 * controls which look alike are not: picking a run filters the feed by it, while
 * *Set aside* on the same row hides the batch and leaves the filter alone. The
 * rest is what a curator can tell apart on screen: two roots called Europe, a
 * search that waits for the typing to stop, and a way back to a batch that has
 * been hidden.
 */

import {
  describe, it, expect, vi,
} from 'vitest';
import {
  render, screen, fireEvent, act,
} from '@testing-library/react';
import type { QueueFacets } from '../../../api/experiences';
import type { ReviewAddress } from '../../../utils/appUrl';
import { EMPTY_REVIEW } from '../../../utils/appUrl';
import { ReviewToolbar } from './ReviewToolbar';

/** A run's completion, built from local fields so the assertion holds in any zone. */
const RUN_98_AT = new Date(2026, 8, 5, 14, 32).toISOString();
const RUN_93_AT = new Date(2026, 8, 4, 9, 10).toISOString();

/**
 * The development catalogue's own shape, trimmed: three sources, the two roots
 * called Europe (world views 2 and 5) beside one Asia, and two runs.
 */
const FACETS: QueueFacets = {
  kind: [
    { kind: 'held', count: 1451 },
    { kind: 'refused', count: 118 },
    { kind: 'arrival', count: 52 },
    { kind: 'contents', count: 11 },
  ],
  source: [
    { id: 1, name: 'UNESCO World Heritage', count: 1200 },
    { id: 2, name: 'Art Museums', count: 340 },
    { id: 3, name: 'Public Art & Monuments', count: 93 },
  ],
  region: [
    { id: 6737, name: 'Europe', worldView: 'Administrative', count: 505 },
    { id: 1220, name: 'Europe', worldView: 'Wikivoyage Regions', count: 498 },
    { id: 5212, name: 'Asia', worldView: 'Administrative', count: 300 },
    { id: null, name: 'Unplaced', worldView: null, count: 28 },
  ],
  run: [
    {
      id: 98, sourceId: 1, completedAt: RUN_98_AT, count: 1255, setAside: false,
    },
    {
      id: 93, sourceId: 3, completedAt: RUN_93_AT, count: 93, setAside: false,
    },
  ],
  setAside: { batches: 0 },
};

function renderToolbar(over: {
  address?: Partial<ReviewAddress>;
  facets?: Partial<QueueFacets>;
  total?: number;
} = {}) {
  const onChange = vi.fn();
  const onSetAside = vi.fn();
  const onBringBack = vi.fn();
  render(
    <ReviewToolbar
      address={{ ...EMPTY_REVIEW, ...over.address }}
      facets={{ ...FACETS, ...over.facets }}
      total={over.total ?? 1633}
      onChange={onChange}
      onSetAside={onSetAside}
      onBringBack={onBringBack}
    />,
  );
  return { onChange, onSetAside, onBringBack };
}

/** Opens a chip's menu by the word the chip starts with — its picked values follow it. */
function openChip(name: string) {
  fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith(name) }));
}

/**
 * What one report asks of the address.
 *
 * A control with a *relative* change reports a function of the address rather than a
 * finished patch, so that a second tick in the same open menu builds on the first instead
 * of on the render behind both (`useReviewAddress`). A test asks what it would do by
 * resolving it against the address it would have been resolved against.
 */
function asked(
  onChange: ReturnType<typeof vi.fn>,
  address: ReviewAddress = EMPTY_REVIEW,
  call = -1,
): Partial<ReviewAddress> {
  const calls = onChange.mock.calls;
  const next = calls.at(call)?.[0] as
    Partial<ReviewAddress> | ((cur: ReviewAddress) => Partial<ReviewAddress>);
  return typeof next === 'function' ? next(address) : next;
}

describe('ReviewToolbar', () => {
  it('turns a source on from its own row, with no Apply in the way', () => {
    const { onChange } = renderToolbar();

    openChip('Source');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Public Art & Monuments/ }));

    expect(asked(onChange)).toEqual({ sourceIds: [3] });
  });

  it('turns the same source off again', () => {
    const address = { ...EMPTY_REVIEW, sourceIds: [3] };
    const { onChange } = renderToolbar({ address });

    openChip('Source');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Public Art & Monuments/ }));

    expect(asked(onChange, address)).toEqual({ sourceIds: [] });
  });

  it('offers the three sub-kinds waiting groups as rows of their own', () => {
    const { onChange } = renderToolbar();

    openChip('Question');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /New arrivals/ }));

    // The address carries the API's own word, not the row's label.
    expect(asked(onChange)).toEqual({ kinds: ['arrival'] });
  });

  it('shows a facet count of zero rather than hiding the row', () => {
    renderToolbar();

    openChip('Question');
    // Nothing is missing from the source in this fixture; the row still says so.
    expect(screen.getByRole('menuitemcheckbox', { name: /Gone from the source 0/ })).toBeInTheDocument();
  });

  it('keeps a picked source in its own menu when its count falls to zero', () => {
    // The same rule one chip along, and the one where it decides something: the
    // server offers every source counted or not, so a source a curator picked
    // whose count under the other chips is zero is a dimmed row rather than a
    // missing one. Were it dropped, the chip would carry a filter with no way
    // to untick it from the control that set it.
    const address = { ...EMPTY_REVIEW, sourceIds: [2] };
    const { onChange } = renderToolbar({
      address,
      facets: {
        source: [
          { id: 1, name: 'UNESCO World Heritage', count: 1200 },
          { id: 2, name: 'Art Museums', count: 0 },
          { id: 3, name: 'Public Art & Monuments', count: 93 },
        ],
      },
    });

    openChip('Source');
    const picked = screen.getByRole('menuitemcheckbox', { name: /Art Museums 0/ });
    expect(picked).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(picked);
    expect(asked(onChange, address)).toEqual({ sourceIds: [] });
  });

  it('names the world view only where a root name repeats', () => {
    renderToolbar();

    openChip('Region');
    expect(screen.getByRole('menuitemcheckbox', { name: /Europe · Administrative/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /Europe · Wikivoyage Regions/ })).toBeInTheDocument();
    // One Asia, so its name identifies it and the world view would be noise.
    expect(screen.getByRole('menuitemcheckbox', { name: /^Asia/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: /Asia · Administrative/ })).toBeNull();
  });

  it('picks one region at a time, the unplaced bucket included', () => {
    const { onChange } = renderToolbar();

    openChip('Region');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Unplaced/ }));

    expect(asked(onChange)).toEqual({ regionId: 'none' });
  });

  it('clears the region a second pick of the same root asks for', () => {
    const address = { ...EMPTY_REVIEW, regionId: 6737 };
    const { onChange } = renderToolbar({ address });

    openChip('Region');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Europe · Administrative/ }));

    expect(asked(onChange, address)).toEqual({ regionId: null });
  });

  it('filters by a run when the run itself is picked', () => {
    const { onChange, onSetAside } = renderToolbar();

    openChip('Run');
    fireEvent.click(screen.getByRole('menuitem', {
      name: (accessible: string) => accessible.includes('run 98') && !accessible.includes('Set aside'),
    }));

    expect(onChange).toHaveBeenCalledWith({ runId: 98 });
    expect(onSetAside).not.toHaveBeenCalled();
  });

  it('sets a run aside without filtering the feed by it', () => {
    const { onChange, onSetAside } = renderToolbar();

    openChip('Run');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set aside run 98' }));

    expect(onSetAside).toHaveBeenCalledWith(98);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reaches Set aside with the arrows, and runs it with Enter', () => {
    const { onChange, onSetAside } = renderToolbar();

    openChip('Run');
    // A menu swallows Tab and its arrows move between items, so the action has
    // to be an item of its own. MUI puts the focus on the first item as the
    // menu opens — run 98's filter row — and one arrow reaches its Set aside.
    expect(document.activeElement?.textContent).toContain('run 98');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });

    const focused = document.activeElement as HTMLElement;
    expect(focused).toHaveAttribute('aria-label', 'Set aside run 98');

    fireEvent.keyDown(focused, { key: 'Enter' });
    expect(onSetAside).toHaveBeenCalledWith(98);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says nothing about set-aside batches when there are none', () => {
    renderToolbar();

    expect(screen.queryByRole('button', { name: /set aside/ })).toBeNull();
  });

  it('names a hidden batch, and brings it back', () => {
    const { onBringBack } = renderToolbar({
      facets: {
        run: [{ ...FACETS.run[0], setAside: true }, FACETS.run[1]],
        setAside: { batches: 1 },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /1 batch set aside/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Bring back.*run 98/ }));

    expect(onBringBack).toHaveBeenCalledWith(98);
  });

  it('brings a hidden batch back from the keyboard too', () => {
    const { onBringBack } = renderToolbar({
      facets: {
        run: [{ ...FACETS.run[0], setAside: true }, FACETS.run[1]],
        setAside: { batches: 1 },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /1 batch set aside/ }));

    // The row is the action here, and it is the first item the menu focuses.
    const focused = document.activeElement as HTMLElement;
    expect(focused.textContent).toContain('Bring back');
    fireEvent.keyDown(focused, { key: 'Enter' });

    expect(onBringBack).toHaveBeenCalledWith(98);
  });

  it('reports the search once the typing settles', () => {
    vi.useFakeTimers();
    try {
      const { onChange } = renderToolbar();

      fireEvent.change(screen.getByLabelText('Find an object by name'), {
        target: { value: 'memorial' },
      });
      expect(onChange).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(300); });

      expect(onChange).toHaveBeenCalledWith({ q: 'memorial' });
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an emptied search box as an empty search', () => {
    vi.useFakeTimers();
    try {
      const { onChange } = renderToolbar({ address: { q: 'memorial' } });

      fireEvent.change(screen.getByLabelText('Find an object by name'), { target: { value: '' } });
      act(() => { vi.advanceTimersByTime(300); });

      expect(onChange).toHaveBeenCalledWith({ q: '' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report a search Clear all has just cleared', () => {
    vi.useFakeTimers();
    try {
      const rest = { facets: FACETS, total: 1633, onSetAside: vi.fn(), onBringBack: vi.fn() };
      const typed = vi.fn();
      const { rerender } = render(
        <ReviewToolbar address={EMPTY_REVIEW} onChange={typed} {...rest} />,
      );

      fireEvent.change(screen.getByLabelText('Find an object by name'), {
        target: { value: 'memorial' },
      });
      act(() => { vi.advanceTimersByTime(300); });
      expect(typed).toHaveBeenCalledWith({ q: 'memorial' });

      // The page followed, and hands down a fresh callback on every render —
      // which is what re-runs the debounce effect while it still holds the old
      // text.
      const cleared = vi.fn();
      rerender(
        <ReviewToolbar address={{ ...EMPTY_REVIEW, q: 'memorial' }} onChange={cleared} {...rest} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
      expect(cleared).toHaveBeenCalledWith({
        q: '', sourceIds: [], kinds: [], regionId: null, runId: null,
      });

      const after = vi.fn();
      rerender(<ReviewToolbar address={EMPTY_REVIEW} onChange={after} {...rest} />);
      act(() => { vi.advanceTimersByTime(300); });

      expect(after).not.toHaveBeenCalled();
      expect(cleared).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the menu open so a second value can be picked, and keeps the first with it', () => {
    // The menu stays open on a tick, and the address behind it moves in a transition — so
    // a second tick is reported while the toolbar is still rendered at the address before
    // the first. Reported as an absolute array, the second reads `[]` and asks for
    // `source=2` alone, silently dropping the source the curator picked a moment earlier.
    const { onChange } = renderToolbar();

    openChip('Source');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Public Art & Monuments/ }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Art Museums/ }));

    expect(onChange).toHaveBeenCalledTimes(2);
    const first = asked(onChange, EMPTY_REVIEW, 0);
    expect(first).toEqual({ sourceIds: [3] });
    // The second, resolved against what the first asked for, as `go` resolves it.
    expect(asked(onChange, { ...EMPTY_REVIEW, ...first })).toEqual({ sourceIds: [3, 2] });
  });

  it('shows a set-aside batch when its own run is picked as the filter', () => {
    // The run facet is counted before the set-aside rows are dropped — it has to be, or a
    // hidden batch would have no chip to come back from — so this row offers a count over
    // a list the feed then hides. Picking it must turn the rows on in the same gesture,
    // or the curator gets "Nothing matches" against the 1,255 they just clicked.
    const { onChange } = renderToolbar({
      facets: {
        run: [{ ...FACETS.run[0], setAside: true }, FACETS.run[1]],
        setAside: { batches: 1 },
      },
    });

    openChip('Run');
    fireEvent.click(screen.getByRole('menuitem', {
      name: (accessible: string) => accessible.includes('run 98') && !accessible.includes('Bring'),
    }));

    expect(asked(onChange)).toEqual({ runId: 98, showAside: true });
  });

  it('leaves the set-aside rows alone when the run picked is not one of them', () => {
    const { onChange } = renderToolbar();

    openChip('Run');
    fireEvent.click(screen.getByRole('menuitem', {
      name: (accessible: string) => accessible.includes('run 93') && !accessible.includes('Set aside'),
    }));

    expect(asked(onChange)).toEqual({ runId: 93 });
  });

  it('keeps a trailing space in the box while the address holds the trimmed search', () => {
    // `q` is trimmed and capped on the way into the address, so the box and the address
    // differ by design the moment a space is typed. Compared against half that rule, the
    // follow-the-address effect rewrites the box under the caret and the next word arrives
    // as `CologneCathedral`.
    vi.useFakeTimers();
    try {
      const rest = { facets: FACETS, total: 1633, onSetAside: vi.fn(), onBringBack: vi.fn() };
      const onChange = vi.fn();
      const { rerender } = render(
        <ReviewToolbar address={EMPTY_REVIEW} onChange={onChange} {...rest} />,
      );

      const box = screen.getByLabelText('Find an object by name') as HTMLInputElement;
      fireEvent.change(box, { target: { value: 'Cologne ' } });
      act(() => { vi.advanceTimersByTime(300); });
      expect(onChange).toHaveBeenCalledWith({ q: 'Cologne ' });

      // The page wrote it, and the address answers with what it stored.
      rerender(
        <ReviewToolbar address={{ ...EMPTY_REVIEW, q: 'Cologne' }} onChange={onChange} {...rest} />,
      );
      expect(box.value).toBe('Cologne ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a pasted search longer than the cap in the box', () => {
    // The same defect at the other end of the same rule: the address caps `q` at 100
    // characters, so a 101-character paste would be truncated back into the box.
    vi.useFakeTimers();
    try {
      const rest = { facets: FACETS, total: 1633, onSetAside: vi.fn(), onBringBack: vi.fn() };
      const onChange = vi.fn();
      const long = 'x'.repeat(101);
      const { rerender } = render(
        <ReviewToolbar address={EMPTY_REVIEW} onChange={onChange} {...rest} />,
      );

      const box = screen.getByLabelText('Find an object by name') as HTMLInputElement;
      fireEvent.change(box, { target: { value: long } });
      act(() => { vi.advanceTimersByTime(300); });

      rerender(
        <ReviewToolbar
          address={{ ...EMPTY_REVIEW, q: 'x'.repeat(100) }}
          onChange={onChange}
          {...rest}
        />,
      );
      expect(box.value).toBe(long);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says a counted list is empty rather than still counting', () => {
    renderToolbar({ facets: { source: [] } });

    openChip('Source');
    expect(screen.getByRole('menuitem', { name: 'Nothing to filter by' })).toBeInTheDocument();
  });

  it('changes the order, and asks for nothing when the order is already that', () => {
    const { onChange } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'By question' }));
    expect(onChange).toHaveBeenCalledWith({ sort: 'question' });

    // MUI answers a click on the selected button with null; the order has no
    // "neither" state, so nothing is asked for.
    fireEvent.click(screen.getByRole('button', { name: 'Newest first' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('offers Clear all only once something is on', () => {
    renderToolbar();

    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('clears every filter and the search together', () => {
    const { onChange } = renderToolbar({ address: { sourceIds: [3], q: 'memorial', runId: 98 } });

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith({
      q: '', sourceIds: [], kinds: [], regionId: null, runId: null,
    });
  });

  it('states the total the way a curator reads a number', () => {
    renderToolbar({ total: 1633 });

    expect(screen.getByText('1,633 open')).toBeInTheDocument();
  });

  it('claims no count at all before the facets arrive', () => {
    render(
      <ReviewToolbar
        address={EMPTY_REVIEW}
        facets={undefined}
        total={0}
        onChange={vi.fn()}
        onSetAside={vi.fn()}
        onBringBack={vi.fn()}
      />,
    );

    openChip('Source');
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0);
    expect(screen.getByRole('menuitem', { name: /Counting/ })).toBeInTheDocument();
  });
});
