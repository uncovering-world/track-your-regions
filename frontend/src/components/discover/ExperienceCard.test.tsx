/**
 * A Discover card (#2120): its name is a control a keyboard reaches and
 * opens the place with, and a whole visited in part is not drawn as done.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Experience } from '../../api/experiences';
import { ExperienceCard } from './ExperienceCard';

const arc = {
  id: 1093, name: 'Struve Geodetic Arc', kind_id: 1, kind_name: 'World Heritage Sites', type: 'cultural',
  location_count: 34, leaf_count: 34, kinds: [], cast_points: false, has_parts: true, treasure_count: 0, finds_count: 0,
  image_url: null, subtitle: null,
} as unknown as Experience;

describe('a Discover card', () => {
  it('opens the place from its name, a button the keyboard reaches', () => {
    const open = vi.fn();
    render(<ExperienceCard experience={arc} isVisited={false} onClick={open} showCheckbox />);

    const name = screen.getByRole('button', { name: 'Struve Geodetic Arc' });
    name.focus();
    expect(document.activeElement).toBe(name);
    fireEvent.click(name);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows a whole visited in part by its mark, not struck through as done', () => {
    render(<ExperienceCard experience={arc} isVisited isPartlyVisited onClick={() => {}} showCheckbox />);

    expect(screen.getByRole('img', { name: 'Partly visited' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(getComputedStyle(screen.getByText('Struve Geodetic Arc')).textDecoration).not.toContain('line-through');
  });
});

describe("a Discover card's checkbox while a visit write is on its way", () => {
  it('waits for it', () => {
    const museum = { ...arc, id: 1581, name: 'Maman', has_parts: false, location_count: 1 } as unknown as Experience;
    render(<ExperienceCard experience={museum} isVisited={false} onClick={() => {}} showCheckbox visitDisabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});

describe("a Discover card's count (ADR-0206)", () => {
  it("reads the count Map mode's row reads: the Struve Arc after one station", () => {
    render(<ExperienceCard experience={arc} isVisited isPartlyVisited progress={{ visited: 1, total: 34 }} onClick={() => {}} showCheckbox />);
    expect(screen.getByText('1 of 34')).toBeTruthy();
    expect(screen.queryByText('34')).toBeNull();
  });

  it('reads 0 of N where the traveller has not been, and N places to a visitor signed out', () => {
    const { unmount } = render(<ExperienceCard experience={arc} isVisited={false} onClick={() => {}} showCheckbox />);
    expect(screen.getByText('0 of 34')).toBeTruthy();
    unmount();
    render(<ExperienceCard experience={arc} isVisited={false} onClick={() => {}} showCheckbox={false} />);
    expect(screen.getByText('34 places')).toBeTruthy();
  });
});
