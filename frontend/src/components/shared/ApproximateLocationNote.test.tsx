import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApproximateLocationNote } from './ApproximateLocationNote';

describe('the note on a roughly placed point (#1912)', () => {
  it('says the reason in full on a card', () => {
    render(<ApproximateLocationNote reason="whole-minute" />);
    expect(screen.getByText(/nearest minute of arc/)).toBeTruthy();
  });

  it('says a short word on a row that the keyboard reaches, with the reason as its name', () => {
    render(<ApproximateLocationNote reason="shared" compact />);
    const word = screen.getByLabelText(/one point for several parts/);
    expect(word.textContent).toBe('approximate location');
    expect(word.getAttribute('tabindex')).toBe('0');
  });

  it('says nothing of an exact point', () => {
    const { container } = render(<ApproximateLocationNote reason={null} />);
    expect(container.textContent).toBe('');
  });
});
