/**
 * A year as a person writes one, and the one thing the control must not lose.
 *
 * The era is the whole reason this field exists rather than a number box, so the
 * case worth pinning is the one that took it away: emptying the digits. Derived
 * from the sign of the value, BC vanished the moment the box was cleared —
 * `null` has no sign — and the ordinary correction, backspace and retype, put
 * the new number on the other side of zero. Overtyping a selection kept it,
 * which is what made it easy to miss.
 */

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { YearField } from './YearField';

/** The field as a caller holds it: controlled, so the era has to survive the round trip. */
function Harness({ start, onValue }: { start: number | null; onValue: (year: number | null) => void }) {
  const [year, setYear] = useState<number | null>(start);
  return (
    <YearField
      value={year}
      onChange={(next) => { setYear(next); onValue(next); }}
    />
  );
}

describe('YearField', () => {
  it('keeps BC when the digits are cleared and retyped', () => {
    // The Borghese Gladiator, stored as 100 BC, corrected to 150 BC — three
    // backspaces and three digits, which is how anyone would do it.
    const onValue = vi.fn();
    render(<Harness start={-100} onValue={onValue} />);

    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '150' } });

    expect(onValue).toHaveBeenLastCalledWith(-150);
  });

  it('lets a curator say BC before there is anything to sign', () => {
    const onValue = vi.fn();
    render(<Harness start={null} onValue={onValue} />);

    fireEvent.click(screen.getByRole('button', { name: 'BC' }));
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '450' } });

    expect(onValue).toHaveBeenLastCalledWith(-450);
  });

  it('re-signs the year already there when the era is switched', () => {
    const onValue = vi.fn();
    render(<Harness start={200} onValue={onValue} />);

    fireEvent.click(screen.getByRole('button', { name: 'BC' }));

    // "statue · 200" and "statue · 200 BC" are four hundred years apart.
    expect(onValue).toHaveBeenLastCalledWith(-200);
  });

  it('follows a value that arrives from outside', () => {
    // A caller reconciling a different work into the same instance: the era
    // held here must not outlive the work it belonged to.
    const { rerender } = render(<YearField value={-100} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'BC' })).toHaveAttribute('aria-pressed', 'true');

    rerender(<YearField value={1517} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'AD' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the digits without the sign the curator never typed', () => {
    render(<YearField value={-38000} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Year')).toHaveValue('38000');
  });
});
