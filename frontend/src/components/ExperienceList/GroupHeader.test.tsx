/**
 * An open group's type chips (#589).
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GroupHeader } from './GroupHeader';

const italy = { kindName: 'World Heritage Sites', experiences: new Array(61).fill({}) } as never;
const types = [{ type: 'cultural', count: 55 }, { type: 'natural', count: 6 }];

function renderHeader(expanded: boolean, activeType: string | null = null) {
  const onType = vi.fn();
  render(
    <GroupHeader group={italy} expanded={expanded} onToggle={() => {}} regionTotal={null} canAdd={false}
      onAdd={() => {}} types={types} activeType={activeType} onType={onType} allCount={61} kindId={1} />,
  );
  return { onType };
}

describe('GroupHeader', () => {
  it('offers the types of an open group, with all of it first', () => {
    const { onType } = renderHeader(true);
    const group = screen.getByRole('group', { name: 'Narrow World Heritage Sites to one type' });
    expect(group).toHaveTextContent('All 61');
    fireEvent.click(screen.getByRole('button', { name: /Natural 6/ }));
    expect(onType).toHaveBeenCalledWith('natural');
  });

  it('takes the chosen type back on a second press', () => {
    const { onType } = renderHeader(true, 'natural');
    fireEvent.click(screen.getByRole('button', { name: /Natural 6/ }));
    expect(onType).toHaveBeenCalledWith(null);
  });

  it('offers no chips on a closed group', () => {
    renderHeader(false);
    expect(screen.queryByRole('group')).toBeNull();
  });
});
