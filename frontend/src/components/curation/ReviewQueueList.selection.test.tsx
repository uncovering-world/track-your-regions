/**
 * Tests for the ticks on the list (#852): the box on every row, the tri-state
 * box over the loaded rows and the line that offers all matching, and the two
 * keys. What a tick *means* is the page's, so the selection here is a stub
 * that records what the list asked of it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewQueueList } from './ReviewQueueList';
import type { QueueRow } from './queueRows';

function row(key: string, name: string): QueueRow {
  return {
    key, kind: 'waiting', id: Number(key.split(':')[1]), name, placeKind: 'Places of worship',
    question: '', askedAt: '2026-09-09T10:00:00Z', runId: 105, specific: '', subs: ['arrival'],
  };
}

const ROWS = [row('waiting:1', 'Chartres'), row('waiting:2', 'Reims'), row('waiting:3', 'Amiens')];

function selectionStub(keys: string[] = [], allMatching = false) {
  return {
    keys: new Set(keys), allMatching,
    toggle: vi.fn(), setLoaded: vi.fn(), selectAllMatching: vi.fn(), clear: vi.fn(),
  };
}

function renderList(selection = selectionStub(), over: Partial<Parameters<typeof ReviewQueueList>[0]> = {}) {
  render(
    <ReviewQueueList
      rows={ROWS}
      selected="waiting:1"
      onSelect={vi.fn()}
      sort="date"
      today="2026-09-09"
      hasMore={false}
      loadingMore={false}
      onMore={vi.fn()}
      total={ROWS.length}
      stale={false}
      selection={selection}
      {...over}
    />,
  );
  return selection;
}

describe('the ticks on the list', () => {
  it('draws a named box on every row, and a plain click toggles that row', () => {
    const selection = renderList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Reims' }));
    expect(selection.toggle).toHaveBeenCalledWith('waiting:2', false);
  });

  it('passes a shift-click on as a range', () => {
    const selection = renderList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Amiens' }), { shiftKey: true });
    expect(selection.toggle).toHaveBeenCalledWith('waiting:3', true);
  });

  it('keeps the box out of the row’s button, so the row is still one control', () => {
    renderList();
    const button = screen.getByRole('button', { name: /Reims/ });
    expect(button.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('shows the tri-state box indeterminate for some ticks', () => {
    renderList(selectionStub(['waiting:1']));
    const header = screen.getByRole('checkbox', { name: 'Select the 3 questions loaded' });
    // MUI marks the state on the input as data rather than the DOM property.
    expect(header.getAttribute('data-indeterminate')).toBe('true');
    expect(screen.getByText('1 of 3 loaded selected')).toBeInTheDocument();
  });

  it('shows the box checked once every loaded row is ticked, and a click on it clears them', () => {
    const all = renderList(selectionStub(ROWS.map(r => r.key)));
    const header = screen.getByRole('checkbox', { name: 'Select the 3 questions loaded' });
    expect(header.getAttribute('data-indeterminate')).toBe('false');
    expect((header as HTMLInputElement).checked).toBe(true);
    fireEvent.click(header);
    expect(all.setLoaded).toHaveBeenCalledWith(false);
  });

  it('ticks every loaded row from the header, and offers all matching only over a whole page', () => {
    const none = renderList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select the 3 questions loaded' }));
    expect(none.setLoaded).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull();
  });

  it('offers the rows the filters match past the page once the page is ticked', () => {
    const all = renderList(selectionStub(ROWS.map(r => r.key)), { total: 1078 });
    const offer = screen.getByRole('button', { name: 'Select all 1,078 matching' });
    fireEvent.click(offer);
    expect(all.selectAllMatching).toHaveBeenCalled();
  });

  it('says all matching are selected, and offers nothing more, once they are', () => {
    renderList(selectionStub(ROWS.map(r => r.key), true), { total: 1078 });
    expect(screen.getByText('All 1,078 matching selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull();
  });

  it('pins the group headings under the selection header rather than behind it', () => {
    // MUI's subheaders are sticky at top 0 by default; the header sits at
    // top 0 with an opaque background, so a heading at the same offset would
    // be drawn behind it and vanish as soon as its group scrolled.
    renderList();
    const heading = screen.getByText('Today').closest('li') as HTMLElement;
    expect(getComputedStyle(heading).top).toBe('40px');
  });

  it('ticks the open row on x and clears every tick on Escape', () => {
    const selection = renderList();
    const list = screen.getByRole('list').parentElement as HTMLElement;
    fireEvent.keyDown(list, { key: 'x' });
    expect(selection.toggle).toHaveBeenCalledWith('waiting:1');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(selection.clear).toHaveBeenCalled();
  });

  it('keeps the keys alive while a row box holds the focus', () => {
    // Clicking a box leaves focus on its native input; the guard that keeps
    // `j`/`k` out of a search field must not swallow Escape and x there.
    const selection = renderList();
    const box = screen.getByRole('checkbox', { name: 'Select Reims' });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(selection.clear).toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'x' });
    expect(selection.toggle).toHaveBeenCalledWith('waiting:1');
  });

  it('ticks the row the keyboard moved to, not the one the address still holds', () => {
    const selection = renderList();
    const list = screen.getByRole('list').parentElement as HTMLElement;
    fireEvent.keyDown(list, { key: 'j' });
    fireEvent.keyDown(list, { key: 'x' });
    expect(selection.toggle).toHaveBeenCalledWith('waiting:2');
  });
});
