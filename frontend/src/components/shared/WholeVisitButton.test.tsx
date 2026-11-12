/**
 * A whole's own tick, on its card (#2120): "I was there, I don't remember
 * which part". It says whether it is pressed, and its press stays on it.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WholeVisitButton } from './WholeVisitButton';

describe("a whole's own tick", () => {
  it('ticks the whole when it is not ticked, without reaching the card under it', () => {
    const toggle = vi.fn();
    const card = vi.fn();
    render(<div onClick={card}><WholeVisitButton ticked={false} onToggle={toggle} /></div>);

    const button = screen.getByRole('button', { name: 'Visited, not sure which part' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(card).not.toHaveBeenCalled();
  });

  it('says it is pressed once the whole is ticked', () => {
    render(<WholeVisitButton ticked onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Visited, not sure which part' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe("a whole's own tick while a visit write is on its way", () => {
  it('waits for it', () => {
    render(<WholeVisitButton ticked={false} onToggle={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Visited, not sure which part' })).toBeDisabled();
  });
});
