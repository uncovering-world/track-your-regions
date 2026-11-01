/**
 * A search answer a crowded city leaves out of its region's list (ADR-0172,
 * #2201) is still a link, marked quietly "shadowed" with what it means on its tooltip.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ExperienceSearchResult } from '../api/experiences';
import { ExperienceSearchResults } from './ExperienceSearchResults';
import { TAIL_REASON } from './shared/tailNotice';

const LAZIO = { id: 7210, name: 'Lazio', world_view_id: 5, world_view_name: 'Administrative' };
const answer = (id: number, name: string, inTail: boolean) => ({
  id, name, kind_id: 4, kind_name: 'Places of worship', kinds: [], in_tail: inTail,
  source_membership: 'present', existence: 'extant', missing_since: null, regions: [LAZIO],
}) as unknown as ExperienceSearchResult;

describe('the search mark of a shadowed place', () => {
  it('marks a place the list leaves out, and only that one', () => {
    render(
      <ExperienceSearchResults
        results={[answer(1, "St. Peter's Basilica", false), answer(2, 'Santa Sabina', true)]}
        worldViewId={5}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByText('shadowed')).toHaveLength(1);
    expect(screen.getByText('Santa Sabina').parentElement).toHaveTextContent('shadowed');
  });

  it('says why on its tooltip', async () => {
    render(<ExperienceSearchResults results={[answer(2, 'Santa Sabina', true)]} worldViewId={5} onSelect={vi.fn()} />);
    fireEvent.mouseOver(screen.getByText('shadowed'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TAIL_REASON);
  });

  it('says it to a reader who reaches the answer by keyboard, without renaming the link', async () => {
    render(<ExperienceSearchResults results={[answer(2, 'Santa Sabina', true)]} worldViewId={5} onSelect={vi.fn()} />);
    const link = screen.getByRole('button', { name: /Santa Sabina/ });
    // A focus the keyboard moved, which is what opens a tooltip on focus.
    fireEvent.keyDown(document.body, { key: 'Tab' });
    link.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TAIL_REASON);
  });

  it('opens it like any other answer', () => {
    const onSelect = vi.fn();
    render(<ExperienceSearchResults results={[answer(2, 'Santa Sabina', true)]} worldViewId={5} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Santa Sabina'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), LAZIO);
  });
});
