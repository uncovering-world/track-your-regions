/**
 * Tests for the review list: the sticky headings, the two-line row, the one pager, and the
 * keyboard.
 *
 * What is worth pinning is what a curator reads and presses, not the union that fills `rows`
 * — that is `queueRows.test.ts`'s claim. Fixtures build a `QueueRow` directly.
 */

import {
  describe, it, expect, vi,
} from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewQueueList } from './ReviewQueueList';
import type { QueueRow } from './queueRows';

const TODAY = '2026-09-07';

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    key: 'conflicts:1',
    kind: 'conflicts',
    id: 1,
    name: 'Aksum',
    placeKind: 'World Heritage',
    question: 'the source disagrees with an edit',
    askedAt: '2026-09-07T08:00:00Z',
    runId: 99,
    specific: 'criteria',
    subs: [],
    ...over,
  };
}

/** No ticks, and every way of ticking recorded — the selection a list test starts from. */
export function noSelection(keys: string[] = [], allMatching = false) {
  return {
    keys: new Set(keys),
    allMatching,
    toggle: vi.fn(),
    setLoaded: vi.fn(),
    selectAllMatching: vi.fn(),
    clear: vi.fn(),
  };
}

function renderList(rows: QueueRow[], over: Partial<Parameters<typeof ReviewQueueList>[0]> = {}) {
  const onSelect = vi.fn();
  const onMore = vi.fn();
  const selection = noSelection();
  const utils = render(
    <ReviewQueueList
      rows={rows}
      selected={rows[0]?.key ?? null}
      onSelect={onSelect}
      sort="date"
      today={TODAY}
      hasMore={false}
      loadingMore={false}
      onMore={onMore}
      total={rows.length}
      stale={false}
      selection={selection}
      {...over}
    />,
  );
  return { ...utils, onSelect, onMore, selection };
}

/**
 * The list with the page's half of the contract: a selection that actually moves.
 *
 * `renderList` holds `selected` still, which is right for what a row *draws*, but a
 * question about what the keyboard does to the focus needs the row under it to change.
 */
function Controlled({ rows, initial }: { rows: QueueRow[]; initial: string }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <ReviewQueueList
      rows={rows}
      selected={selected}
      onSelect={setSelected}
      sort="date"
      today={TODAY}
      hasMore={false}
      loadingMore={false}
      onMore={vi.fn()}
      total={rows.length}
      stale={false}
      selection={noSelection()}
    />
  );
}

describe('ReviewQueueList', () => {
  it('groups rows by day in date order, each heading carrying its own count', () => {
    renderList([
      row({
        key: 'a', name: 'A', askedAt: '2026-09-05T10:00:00Z',
      }),
      row({
        key: 'b', name: 'B', askedAt: '2026-09-05T09:00:00Z',
      }),
      row({
        key: 'c', name: 'C', askedAt: '2026-09-04T09:00:00Z',
      }),
    ]);

    const satHeading = screen.getByText('Sat 5 Sep').closest('li') as HTMLElement;
    expect(satHeading).not.toBeNull();
    expect(satHeading.textContent).toContain('2');

    const friHeading = screen.getByText('Fri 4 Sep').closest('li') as HTMLElement;
    expect(friHeading).not.toBeNull();
    expect(friHeading.textContent).toContain('1');
  });

  it('sits a still-open question under "Still running", wherever it falls', () => {
    renderList([
      row({ key: 'a', name: 'A', askedAt: '2026-09-05T10:00:00Z' }),
      row({ key: 'b', name: 'B', askedAt: null }),
      row({ key: 'c', name: 'C', askedAt: '2026-09-04T09:00:00Z' }),
    ]);

    expect(screen.getByText('Still running')).toBeInTheDocument();
  });

  it('carries no count while a page of the list is still to come', () => {
    // A number beside "Sat 5 Sep" is read as that day's questions. A first page holds 25
    // of a backlog the toolbar says is 1,255 open, so a count here would be this page's
    // share of the day claiming to be the day. No number is the honest answer until every
    // page is loaded; the list's own label still says how much is on screen.
    renderList([
      row({ key: 'a', name: 'A', askedAt: '2026-09-05T10:00:00Z' }),
      row({ key: 'b', name: 'B', askedAt: '2026-09-05T09:00:00Z' }),
    ], { hasMore: true });

    const heading = screen.getByText('Sat 5 Sep').closest('li') as HTMLElement;
    expect(heading.textContent).toBe('Sat 5 Sep');
  });

  it('counts once every page is loaded, in question order too', () => {
    renderList([
      row({ key: 'a', name: 'A', kind: 'conflicts' }),
      row({ key: 'b', name: 'B', kind: 'refused', specific: 'below the line' }),
    ], { sort: 'question', hasMore: false });

    expect((screen.getByText('The source disagrees with an edit').closest('li') as HTMLElement)
      .textContent).toBe('The source disagrees with an edit1');
    expect((screen.getByText('Our own rule for this list turned these down').closest('li') as HTMLElement)
      .textContent).toBe('Our own rule for this list turned these down1');
  });

  it('drops the question-order count too while a page is still to come', () => {
    renderList([
      row({ key: 'a', name: 'A', kind: 'conflicts' }),
      row({ key: 'b', name: 'B', kind: 'refused', specific: 'below the line' }),
    ], { sort: 'question', hasMore: true });

    expect((screen.getByText('Our own rule for this list turned these down').closest('li') as HTMLElement)
      .textContent).toBe('Our own rule for this list turned these down');
  });

  it('counts the rows a heading actually opens, not every row that shares its key', () => {
    // A run still in flight sits under *Still running* wherever it falls, which splits
    // the day around it into two headings. Counted by key, both halves would claim the
    // day's whole total — two headings reading "Sat 5 Sep 2" over one row each.
    renderList([
      row({ key: 'a', name: 'A', askedAt: '2026-09-05T10:00:00Z' }),
      row({ key: 'b', name: 'B', askedAt: null }),
      row({ key: 'c', name: 'C', askedAt: '2026-09-05T09:00:00Z' }),
    ]);

    const days = screen.getAllByText('Sat 5 Sep').map(el => el.closest('li') as HTMLElement);
    expect(days).toHaveLength(2);
    days.forEach(heading => expect(heading.textContent).toBe('Sat 5 Sep1'));
  });

  it('groups rows by kind in question order, each heading carrying its own count', () => {
    renderList([
      row({
        key: 'a', name: 'A', kind: 'conflicts',
      }),
      row({
        key: 'b', name: 'B', kind: 'refused', placeKind: 'Art Museums', specific: 'below the line',
      }),
      row({
        key: 'c', name: 'C', kind: 'refused', placeKind: 'Art Museums', specific: 'below the line',
      }),
    ], { sort: 'question' });

    const conflictHeading = screen.getByText('The source disagrees with an edit').closest('li') as HTMLElement;
    expect(conflictHeading.textContent).toContain('1');

    const refusedHeading = screen.getByText('Our own rule for this list turned these down').closest('li') as HTMLElement;
    expect(refusedHeading.textContent).toContain('2');
  });

  it('names the kind, the question word and the specific on the second line', () => {
    renderList([row({
      key: 'a', name: 'Aksum', kind: 'waiting', placeKind: 'World Heritage', specific: 'criteria',
    })]);

    const rowButton = screen.getByRole('button', { name: /Aksum/ });
    expect(rowButton.textContent).toContain('World Heritage · holds a change: criteria');
  });

  it('reads an arrival as "new arrival" with nothing after it', () => {
    renderList([row({
      key: 'a', name: 'The Kelpies', kind: 'waiting', placeKind: 'Public Art & Monuments', specific: '', subs: ['arrival'],
    })]);

    const rowButton = screen.getByRole('button', { name: /The Kelpies/ });
    expect(rowButton.textContent).toContain('Public Art & Monuments · new arrival');
    expect(rowButton.textContent).not.toContain('new arrival:');
  });

  it('moves the selection to the next row on j, and back on k', () => {
    // The address catches up with `j`'s move before `k` is pressed — a rerender at the
    // new `selected`, the way the real address does once react-router's transition lands
    // — so "back" means back to the row the curator started on.
    const rows = [row({ key: 'a', name: 'A' }), row({ key: 'b', name: 'B' }), row({ key: 'c', name: 'C' })];
    const { container, onSelect, rerender } = renderList(rows, { selected: 'b' });
    const region = container.firstChild as HTMLElement;

    fireEvent.keyDown(region, { key: 'j' });
    expect(onSelect).toHaveBeenCalledWith('c');

    rerender(
      <ReviewQueueList
        rows={rows}
        selected="c"
        onSelect={onSelect}
        sort="date"
        today={TODAY}
        hasMore={false}
        loadingMore={false}
        onMore={vi.fn()}
        total={rows.length}
        stale={false}
        selection={noSelection()}
      />,
    );

    fireEvent.keyDown(region, { key: 'k' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
  });

  it('moves the same way on the arrow keys', () => {
    const rows = [row({ key: 'a', name: 'A' }), row({ key: 'b', name: 'B' }), row({ key: 'c', name: 'C' })];
    const { container, onSelect, rerender } = renderList(rows, { selected: 'b' });
    const region = container.firstChild as HTMLElement;

    fireEvent.keyDown(region, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('c');

    rerender(
      <ReviewQueueList
        rows={rows}
        selected="c"
        onSelect={onSelect}
        sort="date"
        today={TODAY}
        hasMore={false}
        loadingMore={false}
        onMore={vi.fn()}
        total={rows.length}
        stale={false}
        selection={noSelection()}
      />,
    );

    fireEvent.keyDown(region, { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
  });

  it('keeps moving on a second j fired before the address catches up', () => {
    // `selected` is `address.row`, and the write lands in a transition — this list can
    // still be holding the row from the *previous* URL for the length of it. Held-down
    // `j` fires a second keydown well inside that window, with `selected` unchanged:
    // reading the move from it a second time would ask for the same row again, which
    // `go` discards as the address it is already at — turning a held key into skipped
    // rows rather than a step through each one.
    const rows = [
      row({ key: 'a', name: 'A' }), row({ key: 'b', name: 'B' }),
      row({ key: 'c', name: 'C' }), row({ key: 'd', name: 'D' }),
    ];
    const { container, onSelect } = renderList(rows, { selected: 'a' });
    const region = container.firstChild as HTMLElement;

    fireEvent.keyDown(region, { key: 'j' });
    fireEvent.keyDown(region, { key: 'j' });

    expect(onSelect).toHaveBeenCalledTimes(2);
    const [first, second] = onSelect.mock.calls.map(call => call[0]);
    expect(first).toBe('b');
    expect(second).toBe('c');
    expect(second).not.toBe(first);
  });

  it('disarms the focus-follow flag once a j and a k net back to the address\'s own row', () => {
    // Same window as the test above — a second keydown fired before the address (`selected`)
    // has caught up with the first. Here the second press is `k`, and it lands the pending
    // move back on `b`, the row `selected` already names. The `[selected]` effect that would
    // otherwise clear the flag never runs while `selected` itself never changes, so the fix
    // has to clear the flag right at this move instead of merely skipping the arm — deciding
    // it against `selected` rather than the pending `from` does that.
    //
    // A rerender at the very same `b` cannot show the difference on its own: React skips an
    // effect whose dependency did not change, so nothing runs (and nothing focuses) whether
    // the flag was left dangling or not. What a dangling flag actually breaks is the *next*
    // selection change, if that one is not a keypress — the page moving on its own after an
    // answer is exactly that case, and it is where the bug pulled focus off the bench.
    const rows = [row({ key: 'a', name: 'A' }), row({ key: 'b', name: 'B' }), row({ key: 'c', name: 'C' })];
    const { container, rerender } = renderList(rows, { selected: 'b' });
    const region = container.firstChild as HTMLElement;
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    fireEvent.keyDown(region, { key: 'j' });
    fireEvent.keyDown(region, { key: 'k' });

    // The address catches up to `b` — the row it already named. Its own dependency is
    // unchanged, so this alone cannot run the effect either way.
    rerender(
      <ReviewQueueList
        rows={rows}
        selected="b"
        onSelect={vi.fn()}
        sort="date"
        today={TODAY}
        hasMore={false}
        loadingMore={false}
        onMore={vi.fn()}
        total={rows.length}
        stale={false}
        selection={noSelection()}
      />,
    );

    // The page then moves the selection on its own (not a keypress) — a stale flag would
    // wrongly follow it here.
    rerender(
      <ReviewQueueList
        rows={rows}
        selected="c"
        onSelect={vi.fn()}
        sort="date"
        today={TODAY}
        hasMore={false}
        loadingMore={false}
        onMore={vi.fn()}
        total={rows.length}
        stale={false}
        selection={noSelection()}
      />,
    );

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('refuses a key move while stale, before either ref is armed', () => {
    // `stale` means the rows on screen still answer the *previous* filter — a `j` here
    // must not touch `pending` or `focusNext` at all, or the next real move (once the new
    // filter's page answers, with `selected` unchanged) would compute from the stale move
    // instead of the row actually on screen, landing one row further than asked.
    const rows = [
      row({ key: 'a', name: 'A' }), row({ key: 'b', name: 'B' }),
      row({ key: 'c', name: 'C' }), row({ key: 'd', name: 'D' }),
    ];
    const { container, onSelect, rerender } = renderList(rows, { selected: 'b', stale: true });
    const region = container.firstChild as HTMLElement;

    fireEvent.keyDown(region, { key: 'j' });
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <ReviewQueueList
        rows={rows}
        selected="b"
        onSelect={onSelect}
        sort="date"
        today={TODAY}
        hasMore={false}
        loadingMore={false}
        onMore={vi.fn()}
        total={rows.length}
        stale={false}
        selection={noSelection()}
      />,
    );

    fireEvent.keyDown(region, { key: 'j' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('takes the focus with the selection, so Enter answers the row on screen', () => {
    // Without it the focus stays on the row the mouse last touched: five `j`s later the
    // selection is far down the list, Enter activates the old row's button, and the
    // curator is thrown back to a question they left behind. A screen reader is told
    // nothing at all in the meantime.
    const rows = [
      row({ key: 'a', name: 'Aksum' }),
      row({ key: 'b', name: 'Bagan' }),
      row({ key: 'c', name: 'Cologne Cathedral' }),
    ];
    const { container } = render(<Controlled rows={rows} initial="a" />);
    const region = container.firstChild as HTMLElement;

    const clicked = screen.getByRole('button', { name: /Aksum/ });
    fireEvent.click(clicked);
    // jsdom does not move the focus on a click the way a browser does; this is where the
    // browser would have left it.
    clicked.focus();

    fireEvent.keyDown(region, { key: 'j' });

    const moved = screen.getByRole('button', { name: /Bagan/ });
    expect(document.activeElement).toBe(moved);
    expect(moved).toHaveClass('Mui-selected');

    // And Enter now answers the row the curator is looking at, not the one they clicked.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(screen.getByRole('button', { name: /Bagan/ })).toHaveClass('Mui-selected');
    expect(clicked).not.toHaveClass('Mui-selected');
  });

  it('leaves the focus where it is when the page moves the selection itself', () => {
    // The page picks the next question after every answer and on the first load. Focus
    // following *there* would drag the caret out of the bench the curator is working in,
    // which is why only a key move arms it.
    const rows = [row({ key: 'a', name: 'Aksum' }), row({ key: 'b', name: 'Bagan' })];
    const { rerender } = renderList(rows, { selected: 'a' });
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    rerender(
      <ReviewQueueList
        rows={rows}
        selected="b"
        onSelect={vi.fn()}
        sort="date"
        today={TODAY}
        hasMore={false}
        loadingMore={false}
        onMore={vi.fn()}
        total={rows.length}
        stale={false}
        selection={noSelection()}
      />,
    );

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('gives the ul list items, and nothing else', () => {
    // `List` renders a `<ul>`: a `<div>` wrapper per row left the list with no list items
    // at all, and nested the heading's own `<li>` inside one of them.
    const { container } = renderList([
      row({ key: 'a', name: 'A', askedAt: '2026-09-05T10:00:00Z' }),
      row({ key: 'b', name: 'B', askedAt: '2026-09-05T09:00:00Z' }),
      row({ key: 'c', name: 'C', askedAt: '2026-09-04T09:00:00Z' }),
    ]);

    const list = container.querySelector('ul') as HTMLElement;
    const children = Array.from(list.children);
    // Two headings and three rows, each an `li` of its own.
    expect(children.map(el => el.tagName)).toEqual(['LI', 'LI', 'LI', 'LI', 'LI']);
    expect(list.querySelectorAll('li li')).toHaveLength(0);
  });

  it('ignores j and k typed into an input inside the list', () => {
    const rows = [row({ key: 'a', name: 'A' }), row({ key: 'b', name: 'B' })];
    const { container, onSelect } = renderList(rows, { selected: 'a' });
    const region = container.firstChild as HTMLElement;
    const input = document.createElement('input');
    region.appendChild(input);

    fireEvent.keyDown(input, { key: 'j' });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers Show more only when there is more, and calls onMore once', () => {
    const rows = [row({ key: 'a', name: 'A' })];
    const { onMore } = renderList(rows, { hasMore: true });

    const button = screen.getByRole('button', { name: 'Show more' });
    fireEvent.click(button);

    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('disables Show more while a page is already loading', () => {
    const rows = [row({ key: 'a', name: 'A' })];
    renderList(rows, { hasMore: true, loadingMore: true });

    expect(screen.getByRole('button', { name: 'Show more' })).toBeDisabled();
  });

  it('renders nothing under the last row once there is no more', () => {
    const rows = [row({ key: 'a', name: 'A' })];
    renderList(rows, { hasMore: false });

    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
