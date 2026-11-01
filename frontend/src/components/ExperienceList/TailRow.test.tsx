/**
 * The row that ends a crowded kind's group (#2201): it says what the tail
 * holds, explains the word on hover, and opens and folds the tail.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TailRow } from './TailRow';
import { TAIL_FAILED, TAIL_ROW_REASON } from '../shared/tailNotice';

const folded = { kindId: 4, label: '51 shadowed churches', open: false, places: [], failed: false };

describe('TailRow', () => {
  it('opens the kind\'s tail on a click, and says it is folded', () => {
    const onToggle = vi.fn();
    render(<TailRow section={folded} onToggle={onToggle} />);
    const row = screen.getByRole('button', { name: /51 shadowed churches/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith(4);
  });

  it('says what shadowed means on hover, and adds no line when open', async () => {
    render(<TailRow section={{ ...folded, open: true }} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText(TAIL_ROW_REASON)).toBeNull();
    fireEvent.mouseOver(screen.getByText('51 shadowed churches'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TAIL_ROW_REASON);
  });

  it('shows it is loading while the open tail has not arrived', () => {
    render(<TailRow section={{ ...folded, open: true, places: undefined }} onToggle={vi.fn()} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('says the read failed instead of spinning for ever', () => {
    render(<TailRow section={{ ...folded, open: true, places: undefined, failed: true }} onToggle={vi.fn()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(TAIL_FAILED)).toBeInTheDocument();
  });
});
